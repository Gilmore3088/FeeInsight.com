# Sample 02 — Storage & management proposal

Proposal only. **No migration file has been added to `supabase/migrations/`** — moving
guides into Postgres is a product decision, and this document is the design for it.

## Why move at all

Guides are the only content type on the site with no storage, no lifecycle and no
management surface. `research_articles` — the comparable long-form type — already has all
three, and the pattern is proven in this repo:

| | `research_articles` | guides (today) |
| --- | --- | --- |
| Table | ✅ | ❌ hardcoded TS array |
| Data-store module | ✅ `src/lib/data-store/articles.ts` | ❌ |
| Draft → published → archived | ✅ `status` | ❌ |
| Provenance | ✅ `generated_by`, `conversation_id` | ❌ |
| Freshness | ✅ `published_at`, `updated_at` | ❌ shows the *crawl* date instead |
| Engagement | ✅ `view_count` | ❌ |
| Admin surface | ✅ `/admin/research/articles` | ❌ |

Editing a guide is currently a code change, a PR, CI and a deploy. No compliance reviewer,
content lead or Hamilton operator can touch consumer-facing financial advice.

## Proposed schema

Mirrors `research_articles` conventions so the existing admin patterns transfer directly.

```sql
-- PROPOSAL — not applied.

CREATE TABLE consumer_guides (
  id                BIGGENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug              TEXT NOT NULL UNIQUE,
  title             TEXT NOT NULL,              -- H1
  seo_title         TEXT NOT NULL,              -- <title> / og:title
  description       TEXT NOT NULL,

  primary_category  TEXT NOT NULL,              -- FK-by-convention to the fee taxonomy
  related_categories TEXT[] NOT NULL DEFAULT '{}',
  family            TEXT NOT NULL,

  access_tier       TEXT NOT NULL DEFAULT 'public'
                      CHECK (access_tier IN ('public','registered','pro')),
  audience          TEXT NOT NULL DEFAULT 'consumer'
                      CHECK (audience IN ('consumer','institution','consultant')),
  featured          BOOLEAN NOT NULL DEFAULT FALSE,

  status            TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','in_review','published','archived')),

  author            TEXT NOT NULL DEFAULT 'Fee Insight Research',
  reviewed_at       TIMESTAMPTZ,                -- when the ADVICE was last reviewed
  published_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- provenance, matching the research_articles pattern
  generated_by      TEXT,                       -- e.g. 'consumer-guide-agent'
  agent_run_id      UUID,                       -- the visible run that produced this draft

  view_count        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX consumer_guides_status_published_idx
  ON consumer_guides (status, published_at DESC);
CREATE INDEX consumer_guides_primary_category_idx
  ON consumer_guides (primary_category);

CREATE TABLE consumer_guide_sections (
  id           BIGGENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  guide_id     BIGINT NOT NULL REFERENCES consumer_guides(id) ON DELETE CASCADE,
  anchor       TEXT NOT NULL,                   -- stable, e.g. 'how-to-avoid'
  heading      TEXT NOT NULL,
  position     INTEGER NOT NULL,
  blocks       JSONB NOT NULL,                  -- GuideBlock[] from sample 01
  UNIQUE (guide_id, anchor),
  UNIQUE (guide_id, position)
);

-- Version history: guides make financial claims; every change needs an audit trail.
CREATE TABLE consumer_guide_revisions (
  id          BIGGENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  guide_id    BIGINT NOT NULL REFERENCES consumer_guides(id) ON DELETE CASCADE,
  snapshot    JSONB NOT NULL,                   -- full guide + sections at publish time
  changed_by  TEXT NOT NULL,
  agent_run_id UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX consumer_guide_revisions_guide_idx
  ON consumer_guide_revisions (guide_id, created_at DESC);
```

`BIGGENERATED` above is shorthand for `BIGINT GENERATED ALWAYS AS IDENTITY` — expand
before use. Before writing the real migration, load the
`supabase-postgres-best-practices` skill and confirm RLS posture: `consumer_guides` is
read by anonymous traffic, so the published-row read path needs an explicit policy rather
than inheriting service-role access.

## Data-store module

`src/lib/data-store/guides.ts`, matching `articles.ts` signatures so admin components
transfer:

```ts
export async function getPublishedGuides(): Promise<Guide[]>;
export async function getGuideBySlug(slug: string): Promise<Guide | null>;
export async function getGuidesForCategory(category: string): Promise<Guide[]>;  // powers guide links on /fees/[category] and /institution/[id]
export async function createGuideDraft(input: NewGuideDraft): Promise<Guide>;
export async function updateGuide(id: number, patch: GuidePatch): Promise<Guide>;
export async function publishGuide(id: number, actor: string): Promise<Guide>;  // writes a revision row
export async function incrementGuideView(slug: string): Promise<void>;
```

`getGuidesForCategory` is worth calling out: it closes the loop the current design is
missing entirely. Once guides are queryable by category, `/fees/[category]` and
`/institution/[id]` can surface "Read the guide to this fee" — turning the guides from a
leaf into a hub.

## Agentic contract

`CLAUDE.md` is explicit: *every agent action must create or update a visible agent
run/step/event*, and one-off scripts are not an acceptable execution path. So guide
generation must be an agent module, not a script:

```
src/lib/agents/guides/draft.ts        # runGuideDraft(options): RunGuideDraftResult
```

Run shape, following `runHamiltonPublish` in `src/lib/agents/hamilton/publish.ts`:

| Step | Action | Ledger |
| --- | --- | --- |
| 1 | Read benchmarks for the target category from `published_fee_catalog` (never `extracted_fees`) | `agent_run_step` `read_benchmarks` |
| 2 | Draft prose per `.claude/skills/consumer-guide/SKILL.md` via `src/lib/ai-provider.ts` — never a direct SDK import (`provider-kill`) | `agent_run_step` `draft_sections` + provider usage row |
| 3 | Validate: every `{{token}}` resolves, every category ∈ taxonomy, reading level, length ∈ 800–1,200 words | `agent_run_event` per failed check |
| 4 | Write `status='in_review'`, never `'published'` | `agent_run_step` `persist_draft` |
| 5 | Human publishes from `/admin/guides`, writing a revision row | `agent_run_event` `published` |

Two constraints worth fixing in the design now:

- **Never auto-publish.** These are financial-advice pages; a human approves, exactly as
  Knox ready-review gates fee rows today.
- **Re-draft on benchmark movement.** Hamilton already computes movement signals when it
  publishes (`recordPublicationSignals`, `publish.ts:338`). When a guide's primary category
  median moves materially, enqueue a guide re-draft rather than letting the prose silently
  age. That is the durable fix for P-2, above and beyond token binding.

## Cutover

1. Create tables; seed from the current `GUIDES` array (a one-time seed inside the agent
   module's persist path, not a standalone script).
2. Keep `src/lib/guides.ts` exporting the same shape, backed by the data store, so the
   pages don't change on day one.
3. Move the pages to the data store; delete the literal array.
4. Build `/admin/guides` by copying `/admin/research/articles`.
5. Restore ISR: with prose in Postgres, `revalidate` + `generateStaticParams` becomes the
   right rendering mode and P-9 resolves itself.
