-- Regulatory registry, part 2: storage for the remaining published-data
-- sources (NCUA 5300, FDIC Summary of Deposits, CFPB complaints, SEC EDGAR,
-- state regulators).
--
-- 1. institution_branch_deposits gains branch name/address and run lineage.
-- 2. institution_sources gains sec_cik (holding-company filer) and
--    credit-union charter type.
-- 3. institution_identity_links records how an external identity (CFPB company,
--    SEC CIK) was matched to an institution, with method and confidence, so
--    ambiguous name matches can be reviewed instead of silently written.
-- 4. institution_filings and holding_company_financials hold SEC EDGAR filings
--    and XBRL facts at the holding-company level, kept apart from bank-level
--    call reports so the two never mix on one chart.
-- 5. state_regulators is the chartering-agency registry for all states + DC
--    (bank regulator, plus the credit-union regulator where a state splits them).
--
-- Additive and idempotent.

BEGIN;

ALTER TABLE public.institution_branch_deposits
  ADD COLUMN IF NOT EXISTS branch_name TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS zip TEXT,
  ADD COLUMN IF NOT EXISTS agent_run_id BIGINT;

ALTER TABLE public.institution_sources
  ADD COLUMN IF NOT EXISTS sec_cik TEXT,
  ADD COLUMN IF NOT EXISTS cu_charter_type TEXT;

CREATE INDEX IF NOT EXISTS institution_sources_sec_cik_idx
  ON public.institution_sources (sec_cik)
  WHERE sec_cik IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.institution_identity_links (
  id BIGSERIAL PRIMARY KEY,
  institution_id BIGINT REFERENCES public.institution_sources(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL,
  external_key TEXT NOT NULL,
  external_name TEXT,
  method TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'accepted',
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  agent_run_id BIGINT,
  verified_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT institution_identity_links_type_check
    CHECK (link_type IN ('cfpb_company', 'sec_cik')),
  CONSTRAINT institution_identity_links_status_check
    CHECK (status IN ('accepted', 'needs_review', 'rejected')),
  CONSTRAINT institution_identity_links_type_key UNIQUE (link_type, external_key)
);

CREATE INDEX IF NOT EXISTS institution_identity_links_institution_idx
  ON public.institution_identity_links (institution_id, link_type);

CREATE TABLE IF NOT EXISTS public.institution_filings (
  id BIGSERIAL PRIMARY KEY,
  cik TEXT NOT NULL,
  institution_id BIGINT REFERENCES public.institution_sources(id) ON DELETE SET NULL,
  company_name TEXT,
  form TEXT NOT NULL,
  filed_at DATE NOT NULL,
  period_of_report DATE,
  accession_no TEXT NOT NULL,
  primary_doc_url TEXT,
  description TEXT,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT institution_filings_accession_key UNIQUE (accession_no)
);

CREATE INDEX IF NOT EXISTS institution_filings_cik_filed_idx
  ON public.institution_filings (cik, filed_at DESC);
CREATE INDEX IF NOT EXISTS institution_filings_institution_idx
  ON public.institution_filings (institution_id, filed_at DESC);

CREATE TABLE IF NOT EXISTS public.holding_company_financials (
  id BIGSERIAL PRIMARY KEY,
  cik TEXT NOT NULL,
  period_end DATE NOT NULL,
  fiscal_period TEXT,
  total_assets BIGINT,
  total_liabilities BIGINT,
  stockholders_equity BIGINT,
  net_income BIGINT,
  eps_diluted DOUBLE PRECISION,
  source_url TEXT,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT holding_company_financials_cik_period_key UNIQUE (cik, period_end)
);

COMMENT ON TABLE public.holding_company_financials IS
  'SEC XBRL companyfacts per quarter, whole dollars. Holding-company level; never mixed with bank call reports.';

CREATE TABLE IF NOT EXISTS public.state_regulators (
  state_code CHAR(2) PRIMARY KEY,
  state_name TEXT NOT NULL,
  agency_name TEXT NOT NULL,
  website_url TEXT,
  credit_union_agency_name TEXT,
  credit_union_website_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.institution_identity_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.institution_filings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holding_company_financials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.state_regulators ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.institution_identity_links FROM anon, authenticated;
REVOKE ALL ON public.institution_filings FROM anon, authenticated;
REVOKE ALL ON public.holding_company_financials FROM anon, authenticated;
REVOKE ALL ON public.state_regulators FROM anon, authenticated;

COMMIT;
