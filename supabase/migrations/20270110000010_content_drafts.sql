-- Content queue: every post, card and caption the content workflows draft lands here
-- for James to approve, edit or skip. Nothing in this table is ever posted automatically.
-- Schema only: creates an empty table and changes no existing data.
CREATE TABLE IF NOT EXISTS public.content_drafts (
  id bigserial PRIMARY KEY,
  workflow text NOT NULL,
  channel text NOT NULL DEFAULT 'linkedin',
  -- What the draft is about (for W1, "<fee_category>:<metro>"), so a workflow can skip
  -- subjects it featured recently.
  subject_key text NOT NULL,
  title text NOT NULL,
  caption text NOT NULL,
  -- Every number the caption and card use, with the query that produced them.
  facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  as_of timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'skipped', 'posted')),
  agent_run_id bigint,
  reviewed_by text,
  reviewed_at timestamptz,
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS content_drafts_status_created_idx ON public.content_drafts (status, created_at DESC);
CREATE INDEX IF NOT EXISTS content_drafts_subject_idx ON public.content_drafts (workflow, subject_key, created_at DESC);

ALTER TABLE public.content_drafts ENABLE ROW LEVEL SECURITY;
