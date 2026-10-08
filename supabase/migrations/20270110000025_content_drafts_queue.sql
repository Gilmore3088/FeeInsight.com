-- Widen the content queue into one queue for every growth agent (growth-os/BUILD-PLAN.md 1.7).
--
--   agent        which agent drafted it; existing rows and the LinkedIn workflows are 'murrow'
--   kind         what it is; existing rows are LinkedIn posts ('linkedin_post')
--   skip_reason  why James skipped it, from the Skip form on /admin/customers/content
--   pr_url       the pull request an agent opened for it, when it is a code change
--   score        its weekly score once scored (task 1.12), and when that was
--   scored_at
--
-- The status check is unchanged (draft, approved, skipped, posted covers every kind so far).
--
-- Data: adds six columns. agent and kind are NOT NULL with constant defaults, so existing rows
-- read 'murrow' / 'linkedin_post' (a metadata-only change in Postgres 11+, no table rewrite);
-- the other four are nullable and stay NULL. No existing value changes.

ALTER TABLE public.content_drafts
  ADD COLUMN IF NOT EXISTS agent text NOT NULL DEFAULT 'murrow',
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'linkedin_post',
  ADD COLUMN IF NOT EXISTS skip_reason text,
  ADD COLUMN IF NOT EXISTS pr_url text,
  ADD COLUMN IF NOT EXISTS score numeric,
  ADD COLUMN IF NOT EXISTS scored_at timestamptz;

CREATE INDEX IF NOT EXISTS content_drafts_agent_status_idx
  ON public.content_drafts (agent, status, created_at DESC);
