-- #1075 step 1: Gutenberg, the internal agent that keeps the live fee catalog, on the run ledger
-- (James, Oct 12: "Yes split"; the name Gutenberg, DECISIONS.md).
--
-- 1. A `gutenberg` row in agent_registry, because agent_runs.agent_name and
--    agent_run_steps.agent_name reference agent_registry(agent_name). Same shape as the growth row
--    (20270110000023_growth_agent.sql). It gets no provider budget policy: Gutenberg makes no paid
--    model calls.
-- 2. pipeline_feedback.reported_by may be 'gutenberg' (last set in
--    20270110000045_deming_audit_label.sql; code: FEEDBACK_REPORTERS in
--    src/lib/agents/learning/feedback.ts). The check keeps its name and only widens.
--
-- Data: inserts one registry row and widens one check; changes no existing row. Nothing writes the
-- name yet. The readers that accept both names come in their own PR (#1075 step 1, code), and
-- #1075 step 2 switches the writers. Re-running is safe: the insert does nothing on conflict.
--
-- lock_timeout: replacing a check takes an ACCESS EXCLUSIVE lock on pipeline_feedback. If a
-- transaction holds the table, this fails after 5 seconds instead of queueing every write behind
-- it; it can then be run again. The check is added NOT VALID and validated in its own statement,
-- so the scan of existing rows runs outside that lock.
SET lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('public.agent_registry') IS NOT NULL THEN
    INSERT INTO public.agent_registry (agent_name, display_name, description, role, parent_agent)
    VALUES ('gutenberg', 'Gutenberg',
            'Keeps the live fee catalog: takes Darwin-verified fees, decides which go live, and keeps them correct. No paid model calls.',
            'data', 'atlas')
    ON CONFLICT (agent_name) DO NOTHING;
  END IF;
END $$;

ALTER TABLE public.pipeline_feedback DROP CONSTRAINT IF EXISTS pipeline_feedback_reported_by_check;
ALTER TABLE public.pipeline_feedback ADD CONSTRAINT pipeline_feedback_reported_by_check
  CHECK (reported_by IN ('atlas', 'magellan', 'rosetta', 'knox', 'darwin', 'hamilton', 'gutenberg', 'growth', 'human', 'deming'))
  NOT VALID;
ALTER TABLE public.pipeline_feedback VALIDATE CONSTRAINT pipeline_feedback_reported_by_check;
