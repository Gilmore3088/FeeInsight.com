-- Regulation tracker: state bills from Open States (Magellan's registry-state-bills step).
-- A bill's stage (introduced, in committee, passed a chamber, passed the legislature,
-- signed, vetoed, failed) comes from its action history, not from dates, so it is stored.
--
-- Additive only: four new nullable columns on reg_tracker_items, which is still empty
-- (both tracker steps run in shadow mode). No existing row changes value.

BEGIN;

ALTER TABLE public.reg_tracker_items
  ADD COLUMN IF NOT EXISTS identifier text,
  ADD COLUMN IF NOT EXISTS session text,
  ADD COLUMN IF NOT EXISTS stage text,
  ADD COLUMN IF NOT EXISTS stage_on date;

COMMENT ON COLUMN public.reg_tracker_items.stage IS
  'Bills only: introduced, in_committee, passed_chamber, passed_legislature, signed, vetoed or failed, from the action history. Rules compute their stage from dates at read time.';

CREATE INDEX IF NOT EXISTS idx_reg_tracker_items_jurisdiction ON public.reg_tracker_items (jurisdiction, source);

COMMIT;
