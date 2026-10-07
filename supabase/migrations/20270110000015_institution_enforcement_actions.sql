-- Public enforcement actions against banks, loaded by Magellan's registry-enforcement
-- step from the OCC's EASearch export and the Federal Reserve's enforcement-actions CSV.
-- Only actions against an institution are stored; actions against individuals are not.
--
-- institution_id is set when the named party matched one institution (name and state,
-- or name and city). holding_company holds institution_sources.holding_company_name when
-- the action was against the holding company instead. Unmatched rows stay, with both null,
-- so the match rate is visible. Rows are updated on refresh, never deleted.
--
-- Additive: creates an empty table and its indexes. Changes no existing data.

CREATE TABLE IF NOT EXISTS public.institution_enforcement_actions (
  id BIGSERIAL PRIMARY KEY,
  agency TEXT NOT NULL,
  source_key TEXT NOT NULL UNIQUE,
  institution_id BIGINT REFERENCES public.institution_sources(id) ON DELETE SET NULL,
  holding_company TEXT,
  match_method TEXT,
  party_name TEXT NOT NULL,
  party_city TEXT,
  party_state TEXT,
  action_type TEXT,
  subject TEXT,
  start_date DATE,
  termination_date DATE,
  penalty_amount NUMERIC,
  document_url TEXT,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS institution_enforcement_actions_institution_idx
  ON public.institution_enforcement_actions (institution_id);

CREATE INDEX IF NOT EXISTS institution_enforcement_actions_holding_idx
  ON public.institution_enforcement_actions (holding_company)
  WHERE holding_company IS NOT NULL;

ALTER TABLE public.institution_enforcement_actions ENABLE ROW LEVEL SECURITY;
