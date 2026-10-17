-- HMDA (CFPB/FFIEC Home Mortgage Disclosure Act) public data, aggregated. Written by Magellan's
-- registry step `hmda` (src/lib/agents/magellan/registry/hmda.ts), one partition per year and
-- state ("2025-CA"). No loan-level row is stored: the step streams the Data Browser CSV of the
-- state's originations (action_taken = 1) and keeps only the sums and medians below.
--
-- hmda_lenders: one row per HMDA filer (LEI) per activity year, with the public panel's RSSD,
--   name, parent and top holder, and the institution_sources row it matched (by LEI, else by
--   panel RSSD). Unmatched lenders stay with institution_id NULL. raw_json keeps the panel row.
-- hmda_lender_originations: originations and their dollar volume (sum of HMDA's rounded loan
--   amounts) per lender per county per MSA/MD per year. county_fips NULL = HMDA reported "NA";
--   msa_md '99999' = HMDA's own code for outside any MSA. amount_missing counts loans whose
--   amount was blank/NA and so are not in origination_amount.
-- hmda_lender_loan_costs: exact medians (with their loan counts) of total loan costs, origination
--   charges, discount points and lender credits per lender per MSA/MD per year, within one state.
--   An MSA that spans states has one row per state; medians are not merged across states.
--   cost_detail holds p25/p75 and the counts of Exempt, NA, blank, unreadable and negative values.

CREATE TABLE IF NOT EXISTS public.hmda_lenders (
  activity_year INTEGER NOT NULL,
  lei TEXT NOT NULL,
  respondent_name TEXT,
  rssd_id TEXT,
  parent_rssd TEXT,
  top_holder_rssd TEXT,
  agency_code TEXT,
  assets TEXT,
  other_lender_code TEXT,
  institution_id BIGINT REFERENCES public.institution_sources(id) ON DELETE SET NULL,
  match_method TEXT,
  in_panel BOOLEAN NOT NULL DEFAULT false,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_url TEXT,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (activity_year, lei),
  CONSTRAINT hmda_lenders_match_method_check CHECK (match_method IS NULL OR match_method IN ('lei', 'rssd'))
);

CREATE INDEX IF NOT EXISTS hmda_lenders_institution_idx
  ON public.hmda_lenders (institution_id, activity_year) WHERE institution_id IS NOT NULL;

ALTER TABLE public.hmda_lenders ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.hmda_lender_originations (
  id BIGSERIAL PRIMARY KEY,
  activity_year INTEGER NOT NULL,
  lei TEXT NOT NULL,
  state_code CHARACTER(2) NOT NULL,
  county_fips TEXT,
  msa_md TEXT,
  institution_id BIGINT REFERENCES public.institution_sources(id) ON DELETE SET NULL,
  originations INTEGER NOT NULL,
  origination_amount NUMERIC NOT NULL,
  amount_missing INTEGER NOT NULL DEFAULT 0,
  purchase_count INTEGER NOT NULL,
  purchase_amount NUMERIC NOT NULL,
  refinance_count INTEGER NOT NULL,
  refinance_amount NUMERIC NOT NULL,
  source_url TEXT,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT hmda_lender_originations_key UNIQUE NULLS NOT DISTINCT (activity_year, lei, state_code, county_fips, msa_md)
);

CREATE INDEX IF NOT EXISTS hmda_lender_originations_msa_idx
  ON public.hmda_lender_originations (activity_year, msa_md);

CREATE INDEX IF NOT EXISTS hmda_lender_originations_county_idx
  ON public.hmda_lender_originations (activity_year, county_fips);

CREATE INDEX IF NOT EXISTS hmda_lender_originations_institution_idx
  ON public.hmda_lender_originations (institution_id, activity_year) WHERE institution_id IS NOT NULL;

ALTER TABLE public.hmda_lender_originations ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.hmda_lender_loan_costs (
  id BIGSERIAL PRIMARY KEY,
  activity_year INTEGER NOT NULL,
  lei TEXT NOT NULL,
  state_code CHARACTER(2) NOT NULL,
  msa_md TEXT,
  institution_id BIGINT REFERENCES public.institution_sources(id) ON DELETE SET NULL,
  originations INTEGER NOT NULL,
  total_loan_costs_n INTEGER NOT NULL,
  total_loan_costs_median NUMERIC,
  origination_charges_n INTEGER NOT NULL,
  origination_charges_median NUMERIC,
  discount_points_n INTEGER NOT NULL,
  discount_points_median NUMERIC,
  lender_credits_n INTEGER NOT NULL,
  lender_credits_median NUMERIC,
  cost_detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_url TEXT,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT hmda_lender_loan_costs_key UNIQUE NULLS NOT DISTINCT (activity_year, lei, state_code, msa_md)
);

CREATE INDEX IF NOT EXISTS hmda_lender_loan_costs_msa_idx
  ON public.hmda_lender_loan_costs (activity_year, msa_md);

CREATE INDEX IF NOT EXISTS hmda_lender_loan_costs_institution_idx
  ON public.hmda_lender_loan_costs (institution_id, activity_year) WHERE institution_id IS NOT NULL;

ALTER TABLE public.hmda_lender_loan_costs ENABLE ROW LEVEL SECURITY;

-- hmda_apor_rates: CFPB average prime offer rates (percent) by week, loan term and fixed or
--   adjustable rate, as published in the weekly APOR tables HMDA's rate spread is measured
--   against. Written by registry source `hmda-apor` (one partition, 'current').
CREATE TABLE IF NOT EXISTS public.hmda_apor_rates (
  rate_type TEXT NOT NULL,
  effective_date DATE NOT NULL,
  term_years INTEGER NOT NULL,
  apor NUMERIC NOT NULL,
  source_url TEXT,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (rate_type, effective_date, term_years),
  CONSTRAINT hmda_apor_rates_type_check CHECK (rate_type IN ('fixed', 'adjustable'))
);

ALTER TABLE public.hmda_apor_rates ENABLE ROW LEVEL SECURITY;
