-- Split the deterministic pipeline pause from the provider (global) automation stop,
-- and record operator "billing resolved" overrides that clear the provider circuit.
--
-- Before: one 'global' row stopped every agent step, even steps that never call a
-- paid provider, so a provider billing problem froze fee ingestion. After:
--   * control_key 'global'   gates provider steps only (paid model calls).
--   * control_key 'pipeline' is an operator pause for deterministic steps.
-- Additive and idempotent; the app treats a missing 'pipeline' row as enabled.

BEGIN;

ALTER TABLE automation_control
  DROP CONSTRAINT IF EXISTS automation_control_key_check;
ALTER TABLE automation_control
  ADD CONSTRAINT automation_control_key_check
  CHECK (control_key IN ('global', 'pipeline'));

INSERT INTO automation_control (control_key, enabled, reason, changed_by)
VALUES ('pipeline', TRUE, NULL, 'migration')
ON CONFLICT (control_key) DO NOTHING;

-- The audit action CHECK was declared inline, so drop it by definition, not by name.
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
     WHERE nsp.nspname = 'public'
       AND rel.relname = 'automation_control_audit'
       AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) ILIKE '%action%'
  LOOP
    EXECUTE format('ALTER TABLE public.automation_control_audit DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE automation_control_audit
  ADD CONSTRAINT automation_control_audit_action_check
  CHECK (action IN (
    'emergency_stop',
    'resume',
    'pipeline_pause',
    'pipeline_resume',
    'billing_resolved'
  ));

COMMIT;
