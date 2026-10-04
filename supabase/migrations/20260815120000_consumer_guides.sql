SET lock_timeout = '10s';
SET statement_timeout = '120s';

-- Consumer and professional guides.
--
-- Guides were previously a hardcoded TypeScript array with no lifecycle, no versioning,
-- no author and no review date — the only content type on the site without them, while
-- research_articles next door had the full stack. These tables close that gap.
--
-- Access posture matches every other agentic table in this schema: RLS on, and all
-- privileges revoked from PUBLIC/anon/authenticated. Reads happen through server-side
-- code holding the owner role, so an unpublished draft can never be reached by an
-- anonymous request even if a route forgets to filter on status.

CREATE TABLE IF NOT EXISTS public.consumer_guides (
  id                 BIGSERIAL PRIMARY KEY,
  slug               TEXT NOT NULL UNIQUE,

  -- Two fields, two jobs. The H1 is never derived by splitting the SEO title.
  title              TEXT NOT NULL,
  seo_title          TEXT NOT NULL,
  description        TEXT NOT NULL,

  -- Editorial order. primary_category drives the chart, the CTA and the sidebar order;
  -- related_categories keeps its authored sequence rather than a global sort.
  primary_category   TEXT NOT NULL,
  related_categories TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  family             TEXT NOT NULL,

  -- Bank/CU employees and consultants are one paying reader, not two.
  audience           TEXT NOT NULL DEFAULT 'consumer',
  -- A tier gates the whole guide, never a section of it.
  access_tier        TEXT NOT NULL DEFAULT 'public',
  featured           BOOLEAN NOT NULL DEFAULT FALSE,

  status             TEXT NOT NULL DEFAULT 'draft',

  -- True when the guide makes regulatory claims. Those cannot publish without a
  -- recorded approval; see the status constraint below.
  carries_regulatory_content BOOLEAN NOT NULL DEFAULT FALSE,
  regulatory_approved_by     TEXT,
  regulatory_approved_at     TIMESTAMPTZ,

  author             TEXT NOT NULL DEFAULT 'Fee Insight Research',
  -- When the ADVICE was last reviewed. Deliberately distinct from the fee-crawl date,
  -- which the pages previously showed to readers as though it meant this.
  reviewed_at        TIMESTAMPTZ,
  published_at       TIMESTAMPTZ,
  methodology_href   TEXT,
  related_slugs      TEXT[] NOT NULL DEFAULT '{}'::TEXT[],

  -- Provenance, matching the research_articles pattern.
  generated_by       TEXT,
  agent_run_id       INTEGER REFERENCES public.agent_runs(id) ON DELETE SET NULL,

  -- Set when a benchmark move makes the prose worth re-checking (D-4).
  stale_since        TIMESTAMPTZ,
  stale_reason       TEXT,

  view_count         INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT consumer_guides_audience_check
    CHECK (audience IN ('consumer', 'professional')),
  CONSTRAINT consumer_guides_access_tier_check
    CHECK (access_tier IN ('public', 'registered', 'pro')),
  CONSTRAINT consumer_guides_status_check
    CHECK (status IN ('draft', 'in_review', 'regulatory_review', 'published', 'archived')),
  CONSTRAINT consumer_guides_slug_format_check
    CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT consumer_guides_primary_not_in_related_check
    CHECK (NOT (primary_category = ANY (related_categories))),

  -- Consumer fee guides are public, permanently. Encoded here so no admin action,
  -- migration or agent can quietly gate consumer education behind the paywall.
  CONSTRAINT consumer_guides_consumer_is_public_check
    CHECK (audience <> 'consumer' OR access_tier = 'public'),

  -- A published guide must carry the metadata the page renders and the schema claims.
  CONSTRAINT consumer_guides_published_metadata_check
    CHECK (
      status <> 'published'
      OR (published_at IS NOT NULL AND reviewed_at IS NOT NULL)
    ),

  -- The regulatory gate. A guide carrying regulatory content cannot reach 'published'
  -- without a named approver and an approval timestamp, and approval is never partial.
  CONSTRAINT consumer_guides_regulatory_approval_check
    CHECK (
      (regulatory_approved_by IS NULL) = (regulatory_approved_at IS NULL)
    ),
  CONSTRAINT consumer_guides_regulatory_gate_check
    CHECK (
      status <> 'published'
      OR carries_regulatory_content = FALSE
      OR regulatory_approved_at IS NOT NULL
    )
);

ALTER TABLE public.consumer_guides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.consumer_guides FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.consumer_guides_id_seq FROM PUBLIC, anon, authenticated;

-- The public index reads published guides ordered by recency.
CREATE INDEX IF NOT EXISTS consumer_guides_status_published_idx
  ON public.consumer_guides (status, published_at DESC NULLS LAST);

-- The audience/tier split drives which set a reader sees.
CREATE INDEX IF NOT EXISTS consumer_guides_audience_tier_idx
  ON public.consumer_guides (audience, access_tier, featured);

-- "Which guide explains this fee?" — powers the link from /fees/[category].
CREATE INDEX IF NOT EXISTS consumer_guides_primary_category_idx
  ON public.consumer_guides (primary_category);
CREATE INDEX IF NOT EXISTS consumer_guides_related_categories_idx
  ON public.consumer_guides USING GIN (related_categories);

-- Admin triage: what is waiting on a human, and what has gone stale.
CREATE INDEX IF NOT EXISTS consumer_guides_review_queue_idx
  ON public.consumer_guides (status, updated_at DESC)
  WHERE status IN ('draft', 'in_review', 'regulatory_review');
CREATE INDEX IF NOT EXISTS consumer_guides_stale_idx
  ON public.consumer_guides (stale_since DESC)
  WHERE stale_since IS NOT NULL;

-- Index the FK so deleting an agent run does not sequential-scan this table.
CREATE INDEX IF NOT EXISTS consumer_guides_agent_run_idx
  ON public.consumer_guides (agent_run_id)
  WHERE agent_run_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.consumer_guide_sections (
  id         BIGSERIAL PRIMARY KEY,
  guide_id   BIGINT NOT NULL REFERENCES public.consumer_guides(id) ON DELETE CASCADE,
  -- Stable slug anchor. Never positional — section order may change, and the FAQ
  -- structured data references these fragments.
  anchor     TEXT NOT NULL,
  heading    TEXT NOT NULL,
  position   INTEGER NOT NULL,
  -- GuideBlock[] — paragraph, list, callout, benchmark, comparison.
  blocks     JSONB NOT NULL DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT consumer_guide_sections_anchor_format_check
    CHECK (anchor ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT consumer_guide_sections_blocks_array_check
    CHECK (jsonb_typeof(blocks) = 'array'),
  CONSTRAINT consumer_guide_sections_position_check
    CHECK (position >= 0),
  CONSTRAINT consumer_guide_sections_anchor_unique
    UNIQUE (guide_id, anchor)
);

ALTER TABLE public.consumer_guide_sections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.consumer_guide_sections FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.consumer_guide_sections_id_seq FROM PUBLIC, anon, authenticated;

-- Sections are always read in order for one guide.
CREATE INDEX IF NOT EXISTS consumer_guide_sections_guide_position_idx
  ON public.consumer_guide_sections (guide_id, position);

-- Version history. Guides make financial claims, so every publish is recoverable and
-- attributable, and a regulatory approval is captured on the revision it approved.
CREATE TABLE IF NOT EXISTS public.consumer_guide_revisions (
  id           BIGSERIAL PRIMARY KEY,
  guide_id     BIGINT NOT NULL REFERENCES public.consumer_guides(id) ON DELETE CASCADE,
  -- Full guide + sections at the moment of publish.
  snapshot     JSONB NOT NULL,
  changed_by   TEXT NOT NULL,
  change_note  TEXT,
  agent_run_id INTEGER REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  regulatory_approved_by TEXT,
  regulatory_approved_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT consumer_guide_revisions_snapshot_object_check
    CHECK (jsonb_typeof(snapshot) = 'object')
);

ALTER TABLE public.consumer_guide_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.consumer_guide_revisions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.consumer_guide_revisions_id_seq FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS consumer_guide_revisions_guide_idx
  ON public.consumer_guide_revisions (guide_id, created_at DESC);

CREATE INDEX IF NOT EXISTS consumer_guide_revisions_agent_run_idx
  ON public.consumer_guide_revisions (agent_run_id)
  WHERE agent_run_id IS NOT NULL;

COMMENT ON TABLE public.consumer_guides IS
  'Consumer and professional fee guides. Consumer guides are permanently public; the paying tier is served by separate professional guides, never by gating part of a consumer guide.';
COMMENT ON COLUMN public.consumer_guides.reviewed_at IS
  'When the advice was last reviewed by a human. Distinct from the fee-crawl date, which describes the data rather than the guidance.';
COMMENT ON COLUMN public.consumer_guides.carries_regulatory_content IS
  'True when the guide states regulatory facts (Reg E, Reg DD, CFPB, state unclaimed property). Publishing one requires a recorded approval.';
COMMENT ON COLUMN public.consumer_guides.stale_since IS
  'Set when a benchmark move makes the surrounding prose worth re-checking. Token-bound figures stay correct on their own; the argument around them can still age.';
COMMENT ON CONSTRAINT consumer_guides_consumer_is_public_check ON public.consumer_guides IS
  'Consumer fee guides are public permanently. Encoded in the schema so no admin action or agent can gate consumer education behind the paywall.';
COMMENT ON CONSTRAINT consumer_guides_regulatory_gate_check ON public.consumer_guides IS
  'A guide carrying regulatory content cannot be published without a recorded approval from a named approver on the Hamilton admin surface.';
COMMENT ON TABLE public.consumer_guide_sections IS
  'Ordered guide sections. blocks is a GuideBlock[] — paragraph, list, callout, benchmark, comparison. Dollar figures are {{category.stat}} tokens, never literals.';
COMMENT ON TABLE public.consumer_guide_revisions IS
  'Publish-time snapshots. Answers "who approved this regulatory statement, and when" from the record rather than from memory.';
