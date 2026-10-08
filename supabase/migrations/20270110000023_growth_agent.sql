-- Growth, the marketing agent, on the run ledger (growth-os/BUILD-PLAN.md tasks 1.1, 1.2, 1.4).
--
-- 1. An `agent:growth` provider budget policy with the caps James approved on 2026-10-08
--    ($5 a day, $60 a month), seeded DISABLED: provider calls stay fail-closed for growth
--    until James enables the row. Same column shapes as the other agent policies in
--    20270101040000_api_hardening_budget_controls.sql.
-- 2. A `growth` row in agent_registry, because agent_runs.agent_name and
--    agent_run_steps.agent_name reference agent_registry(agent_name).
-- 3. The marketing pause: automation_control may hold a 'marketing' row, and the audit log
--    may record 'marketing_pause' / 'marketing_resume' (src/lib/automation-control.ts).
--    Both checks keep their names (last set in 20261002233148_pipeline_control_and_billing_override.sql)
--    and only widen. No 'marketing' row is inserted: the app reads a missing row as enabled.
--
-- Data: inserts two rows (one policy, one registry entry) and widens two checks; changes no
-- existing rows. Re-running is safe: the policy insert leaves an existing row untouched (so a
-- cap or switch James set by hand is never reset) and the registry insert does nothing on conflict.

INSERT INTO public.api_budget_policies
  (policy_key, scope, route_id, agent_name, enabled, fail_closed,
   hard_daily_microusd, hard_monthly_microusd, notes, created_by, updated_by)
VALUES
  ('agent:growth', 'agent', NULL, 'growth', FALSE, TRUE,
   5000000, 60000000,
   'Growth (marketing) provider budget: $5/day, $60/month (James, 2026-10-08). Disabled until James turns it on.',
   'migration:growth_agent', 'migration:growth_agent')
ON CONFLICT (policy_key) DO NOTHING;

DO $$
BEGIN
  IF to_regclass('public.agent_registry') IS NOT NULL THEN
    INSERT INTO public.agent_registry (agent_name, display_name, description, role, parent_agent)
    VALUES ('growth', 'Growth',
            'Marketing agent; drafts posts and emails for James to approve. Never sends or posts on its own.',
            'analyst', NULL)
    ON CONFLICT (agent_name) DO NOTHING;
  END IF;
END $$;

ALTER TABLE public.automation_control
  DROP CONSTRAINT IF EXISTS automation_control_key_check;
ALTER TABLE public.automation_control
  ADD CONSTRAINT automation_control_key_check
  CHECK (control_key IN ('global', 'pipeline', 'marketing'));

ALTER TABLE public.automation_control_audit
  DROP CONSTRAINT IF EXISTS automation_control_audit_action_check;
ALTER TABLE public.automation_control_audit
  ADD CONSTRAINT automation_control_audit_action_check
  CHECK (action IN (
    'emergency_stop',
    'resume',
    'pipeline_pause',
    'pipeline_resume',
    'marketing_pause',
    'marketing_resume',
    'billing_resolved'
  ));
