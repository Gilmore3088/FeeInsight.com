-- Quarterly copies of each institution workspace's Hamilton briefing (step `briefing-refresh`),
-- so the bank can see what changed since the last quarter.
--
-- Additive only: one new, empty table. No existing row changes.

BEGIN;

CREATE TABLE IF NOT EXISTS public.hamilton_briefing_snapshots (
  institution_id bigint NOT NULL,
  quarter text NOT NULL,
  engine_version text NOT NULL,
  briefing jsonb NOT NULL,
  agent_run_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (institution_id, quarter)
);
COMMENT ON TABLE public.hamilton_briefing_snapshots IS
  'One Hamilton workspace briefing per institution per quarter (quarter like 2026-Q4), stored as getWorkspaceBriefing returned it, so the next quarter can show what changed. Written by the briefing-refresh step; never edited after.';

ALTER TABLE public.hamilton_briefing_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hamilton_briefing_snapshots FROM PUBLIC, anon, authenticated;

COMMIT;
