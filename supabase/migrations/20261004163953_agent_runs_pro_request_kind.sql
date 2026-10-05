-- Pro AI requests (report generation, briefing thesis, Simulate interpretation) are
-- recorded in the run ledger as run_kind 'pro_request': one completed or failed run
-- with one step and one event each, written after the request finishes. The cron
-- executor and reapers only pick up RUN_KINDS_WITH_LEDGER (run-store.ts), which does
-- not include 'pro_request', so these rows are visible but never executed.
--
-- Widens the CHECK only; idempotent.

BEGIN;

ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_run_kind_check;
ALTER TABLE public.agent_runs
  ADD CONSTRAINT agent_runs_run_kind_check CHECK (run_kind IN (
    'workflow',
    'workflow_lane',
    'state_agent',
    'report',
    'manual_repair',
    'dry_run',
    'pro_request'
  ));

COMMIT;
