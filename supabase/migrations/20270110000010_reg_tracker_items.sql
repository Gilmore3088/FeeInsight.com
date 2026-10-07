-- Regulation tracker: proposed and final rules from the banking regulators, pulled from
-- the Federal Register by Magellan's registry-federal-register step. Later sources
-- (federal and state bills) add rows with their own `source`.
--
-- Additive only: one new empty table. No existing row changes value. The step writes
-- rows only when FEDERAL_REGISTER_TRACKER_LIVE=true; until then it runs in shadow mode
-- and records counts in its run ledger.
--
-- Stage (comment open, comment closed, final not yet effective, in effect) is computed
-- at read time from the dates, so stored rows never go stale.

BEGIN;

CREATE TABLE IF NOT EXISTS public.reg_tracker_items (
  source text NOT NULL,
  external_id text NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  abstract text,
  agencies text[] NOT NULL DEFAULT '{}',
  jurisdiction text NOT NULL DEFAULT 'US',
  published_on date NOT NULL,
  comments_close_on date,
  effective_on date,
  url text NOT NULL,
  rins text[] NOT NULL DEFAULT '{}',
  dockets text[] NOT NULL DEFAULT '{}',
  cfr_parts text[] NOT NULL DEFAULT '{}',
  topics text[] NOT NULL DEFAULT '{}',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, external_id)
);
COMMENT ON TABLE public.reg_tracker_items IS
  'Regulation tracker: one row per rulemaking document or bill. source federal_register: external_id is the Federal Register document number, kind proposed_rule or final_rule.';

CREATE INDEX IF NOT EXISTS idx_reg_tracker_items_published ON public.reg_tracker_items (published_on DESC);
CREATE INDEX IF NOT EXISTS idx_reg_tracker_items_comments ON public.reg_tracker_items (comments_close_on) WHERE comments_close_on IS NOT NULL;

ALTER TABLE public.reg_tracker_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reg_tracker_items FROM PUBLIC, anon, authenticated;

COMMIT;
