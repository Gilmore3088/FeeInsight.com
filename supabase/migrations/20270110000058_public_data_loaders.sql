-- Public data loaders: every new table the Magellan registry needs for the free public sources
-- in /mnt/project-files/api-mcp/public-data-catalog-2026-10-17.md, in one migration for one yes.
--
-- Additive only: CREATE TABLE / INDEX / VIEW IF NOT EXISTS, RLS enabled on every new table, one
-- index added to a table this migration creates. No existing table is altered and no row is
-- written, updated or deleted. Loaders fill these tables through visible registry runs after
-- merge; each one reports missing or unexpected fields in its run instead of guessing them.
--
-- Sections: 1 call-report detail + FDIC structure history; 2 CFPB card/prepaid agreements and
-- TCCP; 3 HMDA; 4 CRA; 5 FR Y-9C and NIC structure; 6 UBPR peer groups; 7 designation lists;
-- 8 payment networks, Reg II, OpenStreetMap; 9 local economy and surveys; 10 industry events.

-- ============================================================
-- 1. call-report detail and FDIC structure history
-- ============================================================
-- Two tables for public regulator data that Magellan's registry does not load yet.
--
-- 1. institution_call_report_items: one row per institution, quarter and call-report line,
--    for detail lines beyond the fixed columns of institution_financial_records. Banks come
--    from the FFIEC bulk call report (MDRM codes such as RIADH033 maintenance charges,
--    RCONF049 deposit accounts of $250,000 or less, RCFD1406 loans 30-89 days past due,
--    RIAD4635 charge-offs). Credit unions come from the NCUA 5300 archive (ACCT_* codes).
--    Each row keeps the regulator's own description of the line, read from the file, so a
--    code is never labelled from memory. A line missing from a file is reported in the
--    registry run (registry_ingest_partitions.detail), never written as zero or guessed.
--    Long format, so adding a line later needs no migration.
--
-- 2. institution_structure_events: FDIC BankFind structure history (mergers, charter and
--    name changes, failures, branch openings and closings), one row per FDIC event record.
--
-- Additive: creates two empty tables and their indexes. Changes no existing data.

CREATE TABLE IF NOT EXISTS public.institution_call_report_items (
  id BIGSERIAL PRIMARY KEY,
  institution_id BIGINT NOT NULL REFERENCES public.institution_sources(id) ON DELETE CASCADE,
  -- 'ffiec' (bank call report, FFIEC 031/041/051) or 'ncua' (5300).
  source TEXT NOT NULL,
  report_date DATE NOT NULL,
  -- The code exactly as the file's column header carries it (RIADH033, RCFD1406, ACCT_564A).
  item_code TEXT NOT NULL,
  -- Our name for the line (maintenance_charges_ytd, past_due_30_89, ...).
  item_key TEXT NOT NULL,
  -- The regulator's description from the same file (FFIEC header row 2, NCUA AcctDesc).
  item_description TEXT,
  -- Schedule or table the line came from (RI, RIBI, RCN, RCO, FS220A ...).
  schedule TEXT,
  value NUMERIC NOT NULL,
  -- thousands (FFIEC dollar lines), dollars (NCUA dollar lines), count.
  unit TEXT NOT NULL,
  -- ytd (income statement), point_in_time (balance sheet and counts).
  period_basis TEXT NOT NULL,
  source_url TEXT,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT institution_call_report_items_source_check CHECK (source IN ('ffiec', 'ncua')),
  CONSTRAINT institution_call_report_items_unit_check CHECK (unit IN ('thousands', 'dollars', 'count')),
  CONSTRAINT institution_call_report_items_basis_check CHECK (period_basis IN ('ytd', 'point_in_time')),
  UNIQUE (institution_id, source, report_date, item_key)
);

CREATE INDEX IF NOT EXISTS institution_call_report_items_key_date_idx
  ON public.institution_call_report_items (item_key, report_date);

CREATE INDEX IF NOT EXISTS institution_call_report_items_source_date_idx
  ON public.institution_call_report_items (source, report_date);

ALTER TABLE public.institution_call_report_items ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.institution_structure_events (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'fdic-history',
  -- The FDIC record's own id when it has one, else a hash of the record.
  event_key TEXT NOT NULL,
  cert TEXT,
  institution_id BIGINT REFERENCES public.institution_sources(id) ON DELETE SET NULL,
  institution_name TEXT,
  change_code TEXT,
  change_description TEXT,
  effective_date DATE,
  process_date DATE,
  acquirer_cert TEXT,
  acquirer_name TEXT,
  outgoing_cert TEXT,
  outgoing_name TEXT,
  survivor_cert TEXT,
  survivor_name TEXT,
  -- Branch events: the office the event is about.
  office_number TEXT,
  office_name TEXT,
  office_city TEXT,
  office_state TEXT,
  office_zip TEXT,
  office_county TEXT,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_url TEXT,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, event_key)
);

CREATE INDEX IF NOT EXISTS institution_structure_events_institution_idx
  ON public.institution_structure_events (institution_id, effective_date);

CREATE INDEX IF NOT EXISTS institution_structure_events_cert_idx
  ON public.institution_structure_events (cert, effective_date);

CREATE INDEX IF NOT EXISTS institution_structure_events_code_date_idx
  ON public.institution_structure_events (change_code, effective_date);

ALTER TABLE public.institution_structure_events ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. cfpb-card-agreements (migration-fragments/cfpb-card-agreements.sql)
-- ============================================================

-- cfpb-card-agreements: CFPB Credit Card Agreement Database (quarterly zip of issuers' agreement
-- PDFs), Prepaid Product Agreements Database (metadata snapshot each quarter) and the Terms of
-- Credit Card Plans survey (twice-yearly CSV). Loaded by the Magellan registry step
-- src/lib/agents/magellan/registry/cfpb-card-agreements.ts; read by
-- src/lib/data-store/cfpb-card-agreements-aggregates.ts.
--
-- cfpb_card_agreements: one row per agreement file (credit_card), prepaid agreement (prepaid) or
-- survey plan (tccp_plan) per period ('2026Q2' or '2026H1'). institution_id is set only when the
-- issuer name matched exactly one institution_sources row by exact or normalized name; otherwise
-- NULL. raw_json keeps the source record (zip path or CSV row) so a mapping fix needs no re-fetch.
-- fee_status: read | no_text (scan or unreadable PDF) | fetch_failed | pending (not reached yet).
--
-- cfpb_agreement_terms: one row per labelled fee (or the TCCP purchase APR) per agreement: the quoted
-- line, and its amount only when the line is unambiguous (dollars and percentages in separate
-- columns; ambiguous = true leaves both NULL). Additive only; changes no existing data.

CREATE TABLE IF NOT EXISTS public.cfpb_card_agreements (
  id BIGSERIAL PRIMARY KEY,
  agreement_kind TEXT NOT NULL CHECK (agreement_kind IN ('credit_card', 'prepaid', 'tccp_plan')),
  period TEXT NOT NULL,
  period_date DATE NOT NULL,
  record_key TEXT NOT NULL,
  issuer_name TEXT,
  product_name TEXT,
  file_name TEXT,
  agreement_url TEXT,
  external_id TEXT,
  agreement_status TEXT,
  effective_date_text TEXT,
  institution_id BIGINT REFERENCES public.institution_sources(id) ON DELETE SET NULL,
  match_method TEXT,
  file_sha256 TEXT,
  file_bytes BIGINT,
  fee_status TEXT NOT NULL CHECK (fee_status IN ('read', 'no_text', 'fetch_failed', 'pending')),
  fee_parser_version INTEGER NOT NULL,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_url TEXT NOT NULL,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agreement_kind, period, record_key)
);

CREATE INDEX IF NOT EXISTS cfpb_card_agreements_kind_period_idx
  ON public.cfpb_card_agreements (agreement_kind, period_date DESC);
CREATE INDEX IF NOT EXISTS cfpb_card_agreements_institution_idx
  ON public.cfpb_card_agreements (institution_id) WHERE institution_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cfpb_card_agreements_pending_idx
  ON public.cfpb_card_agreements (agreement_kind, period) WHERE fee_status = 'pending';

ALTER TABLE public.cfpb_card_agreements ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.cfpb_agreement_terms (
  id BIGSERIAL PRIMARY KEY,
  agreement_id BIGINT NOT NULL REFERENCES public.cfpb_card_agreements(id) ON DELETE CASCADE,
  term_type TEXT NOT NULL,
  quoted_text TEXT NOT NULL,
  amount_usd NUMERIC CHECK (amount_usd IS NULL OR amount_usd >= 0),
  amount_percent NUMERIC CHECK (amount_percent IS NULL OR amount_percent >= 0),
  amount_qualifier TEXT CHECK (amount_qualifier IS NULL OR amount_qualifier IN ('exact', 'up_to', 'none')),
  ambiguous BOOLEAN NOT NULL DEFAULT false,
  ambiguity_reason TEXT,
  line_count INTEGER NOT NULL DEFAULT 1,
  parser_version INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agreement_id, term_type),
  CHECK (amount_usd IS NULL OR amount_percent IS NULL)
);

CREATE INDEX IF NOT EXISTS cfpb_agreement_terms_type_idx
  ON public.cfpb_agreement_terms (term_type) WHERE NOT ambiguous;

ALTER TABLE public.cfpb_agreement_terms ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3. hmda (migration-fragments/hmda.sql)
-- ============================================================

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

-- ============================================================
-- 4. cra (migration-fragments/cra.sql)
-- ============================================================

-- Community Reinvestment Act data from the FFIEC, loaded by Magellan's 'cra' registry source
-- (src/lib/agents/magellan/registry/cra.ts).
--
-- 1. cra_ratings: one row per CRA examination from the interagency CRA ratings file
--    (institution, regulator, exam date, overall rating 1-4, exam method, and the public
--    evaluation URL when the file carries one). Linked to the bank's FDIC row in
--    institution_sources by RSSD id, else FDIC cert; unlinked exams are kept with
--    institution_id NULL. The whole source row is kept in raw_json.
-- 2. cra_lending_respondents: the CRA transmittal sheet, one row per reporter and activity
--    year (name, RSSD id, assets as filed), linked by RSSD id.
-- 3. cra_small_business_lending: the CRA disclosure tables D1-1/D1-2 (small business loans
--    originated/purchased) and D2-1/D2-2 (small farm), one row per reporter, county,
--    assessment area, income group and report level. Loan counts and amounts (thousands of
--    dollars) in three size buckets: small business <=$100K, >$100K-$250K, >$250K-$1M; small
--    farm <=$100K, >$100K-$250K, >$250K-$500K; plus loans to businesses or farms with revenue
--    of $1M or less. A blank field in the file stays NULL. The source line is kept in raw_line.
--
-- Additive: creates three empty tables and their indexes. Changes no existing data.

CREATE TABLE IF NOT EXISTS public.cra_ratings (
  id BIGSERIAL PRIMARY KEY,
  -- Hash of regulator, identifiers and exam date as filed (see craRatingKey).
  rating_key TEXT NOT NULL UNIQUE,
  institution_id BIGINT REFERENCES public.institution_sources(id) ON DELETE SET NULL,
  rssd TEXT,
  fdic_cert TEXT,
  -- The regulator's own institution id (OCC charter, FDIC cert, ...) when the file has one.
  agency_id TEXT,
  regulator_raw TEXT,
  -- OCC, FRB, FDIC or OTS when recognized; NULL otherwise (regulator_raw keeps the value).
  regulator TEXT,
  institution_name TEXT,
  file_city TEXT,
  file_state TEXT,
  exam_date DATE,
  exam_date_raw TEXT,
  rating_raw TEXT,
  -- 1 Outstanding, 2 Satisfactory, 3 Needs to Improve, 4 Substantial Noncompliance.
  rating_code SMALLINT,
  exam_method TEXT,
  -- As filed; unit unconfirmed.
  asset_size NUMERIC,
  evaluation_url TEXT,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_url TEXT,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cra_ratings_rating_code_check CHECK (rating_code IS NULL OR rating_code BETWEEN 1 AND 4)
);

CREATE INDEX IF NOT EXISTS cra_ratings_institution_exam_idx
  ON public.cra_ratings (institution_id, exam_date DESC) WHERE institution_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cra_ratings_rssd_idx ON public.cra_ratings (rssd) WHERE rssd IS NOT NULL;

ALTER TABLE public.cra_ratings ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.cra_lending_respondents (
  activity_year INTEGER NOT NULL,
  -- FFIEC agency code: 1 OCC, 2 Federal Reserve, 3 FDIC, 4 OTS.
  agency_code TEXT NOT NULL,
  respondent_id TEXT NOT NULL,
  institution_id BIGINT REFERENCES public.institution_sources(id) ON DELETE SET NULL,
  respondent_name TEXT,
  respondent_city TEXT,
  respondent_state TEXT,
  rssd TEXT,
  -- As filed; unit unconfirmed.
  assets NUMERIC,
  raw_line TEXT,
  source_url TEXT,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (activity_year, agency_code, respondent_id)
);

CREATE INDEX IF NOT EXISTS cra_lending_respondents_institution_idx
  ON public.cra_lending_respondents (institution_id, activity_year) WHERE institution_id IS NOT NULL;

ALTER TABLE public.cra_lending_respondents ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.cra_small_business_lending (
  id BIGSERIAL PRIMARY KEY,
  -- The row's identifying fields joined (see craLendingRowKey).
  row_key TEXT NOT NULL UNIQUE,
  activity_year INTEGER NOT NULL,
  -- D1-1, D1-2, D2-1 or D2-2.
  table_id TEXT NOT NULL,
  agency_code TEXT NOT NULL,
  respondent_id TEXT NOT NULL,
  institution_id BIGINT REFERENCES public.institution_sources(id) ON DELETE SET NULL,
  loan_type TEXT NOT NULL,
  action_taken TEXT NOT NULL,
  state_fips TEXT,
  county_fips TEXT,
  msa_md TEXT,
  assessment_area TEXT,
  partial_county TEXT,
  split_county TEXT,
  population_class TEXT,
  income_group TEXT,
  -- '040' marks a county-total row (unconfirmed; the loader's cleaning pass checks it).
  report_level TEXT,
  count_size_1 BIGINT,
  amount_size_1 BIGINT,
  count_size_2 BIGINT,
  amount_size_2 BIGINT,
  count_size_3 BIGINT,
  amount_size_3 BIGINT,
  count_rev_under_1m BIGINT,
  amount_rev_under_1m BIGINT,
  raw_line TEXT,
  source_url TEXT,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cra_small_business_lending_loan_type_check CHECK (loan_type IN ('small_business', 'small_farm')),
  CONSTRAINT cra_small_business_lending_action_check CHECK (action_taken IN ('originated', 'purchased'))
);

CREATE INDEX IF NOT EXISTS cra_small_business_lending_county_idx
  ON public.cra_small_business_lending (activity_year, loan_type, state_fips, county_fips)
  WHERE report_level = '040';
CREATE INDEX IF NOT EXISTS cra_small_business_lending_institution_idx
  ON public.cra_small_business_lending (institution_id, activity_year) WHERE institution_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cra_small_business_lending_respondent_idx
  ON public.cra_small_business_lending (activity_year, agency_code, respondent_id);

ALTER TABLE public.cra_small_business_lending ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 5. fr-y9c (migration-fragments/fr-y9c.sql)
-- ============================================================

-- FR Y-9C holding-company lines and NIC holding-company structure.
--
-- 1. holding_company_y9c_items: one row per holding company (Y-9C filer RSSD), quarter and
--    Y-9C line, long format like institution_call_report_items. Lines come from the NIC bulk
--    BHCF file (MDRM codes such as BHCK2170 total assets, BHCK4483 service charges on deposit
--    accounts, BHCK4079 noninterest income, BHCK4340 net income, BHCKF555 interchange,
--    BHCK2122 loans, BHCK4635/4605 charge-offs and recoveries, BHCK3210 equity,
--    BHDM/BHFN 6631/6636 deposits). Each row keeps the description the code was checked
--    against and where it came from (the file's description row, or the Fed MDRM dictionary).
--    A line missing or described differently is reported in registry_ingest_partitions.detail,
--    never written as zero. Values are thousands of dollars as filed; income lines year to date.
--    Consolidated holding-company figures: never pooled with bank call reports.
--    holding_company_financials (SEC XBRL, keyed by CIK, fixed columns) is not reused: these
--    lines would not fit it without altering its columns.
-- 2. holding_company_y9c_filers: one row per filer and quarter: name, city, state as filed,
--    and the raw cells of the identity fields and every defined code (accepted or not), so a
--    code-mapping fix needs no re-fetch.
-- 3. nic_relationships: NIC parent-offspring links with start and end dates (end NULL = open
--    per NIC's 99991231 sentinel; the raw row keeps the original), one row per parent,
--    offspring and start date.
-- 4. nic_entities: NIC attributes (legal name, entity type, city, state) for every entity
--    that is a parent in nic_relationships, from the active and closed attributes files.
--
-- Banks link through institution_sources.rssd_id (offspring) and
-- institution_sources.holding_company_rssd (Y-9C filer). Additive: creates four empty tables
-- and their indexes; changes no existing data.

CREATE TABLE IF NOT EXISTS public.holding_company_y9c_items (
  id BIGSERIAL PRIMARY KEY,
  holding_company_rssd TEXT NOT NULL,
  report_date DATE NOT NULL,
  -- The code exactly as the file's column header carries it (BHCK2170).
  item_code TEXT NOT NULL,
  -- Our name for the line (total_assets, service_charges_deposit_accounts_ytd, ...).
  item_key TEXT NOT NULL,
  item_description TEXT,
  -- 'file' (BHCF description row) or 'mdrm' (Federal Reserve MDRM dictionary, FR Y-9C entry).
  description_source TEXT NOT NULL,
  schedule TEXT,
  value NUMERIC NOT NULL,
  unit TEXT NOT NULL,
  period_basis TEXT NOT NULL,
  source_url TEXT,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT holding_company_y9c_items_unit_check CHECK (unit IN ('thousands')),
  CONSTRAINT holding_company_y9c_items_basis_check CHECK (period_basis IN ('ytd', 'point_in_time')),
  CONSTRAINT holding_company_y9c_items_description_source_check CHECK (description_source IN ('file', 'mdrm')),
  CONSTRAINT holding_company_y9c_items_key UNIQUE (holding_company_rssd, report_date, item_key)
);

CREATE INDEX IF NOT EXISTS holding_company_y9c_items_key_date_idx
  ON public.holding_company_y9c_items (item_key, report_date);
CREATE INDEX IF NOT EXISTS holding_company_y9c_items_date_idx
  ON public.holding_company_y9c_items (report_date);

CREATE TABLE IF NOT EXISTS public.holding_company_y9c_filers (
  holding_company_rssd TEXT NOT NULL,
  report_date DATE NOT NULL,
  legal_name TEXT,
  city TEXT,
  state_code TEXT,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_url TEXT,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (holding_company_rssd, report_date)
);

CREATE INDEX IF NOT EXISTS holding_company_y9c_filers_state_idx
  ON public.holding_company_y9c_filers (report_date, state_code);

CREATE TABLE IF NOT EXISTS public.nic_relationships (
  id BIGSERIAL PRIMARY KEY,
  parent_rssd TEXT NOT NULL,
  offspring_rssd TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE,
  relationship_level INTEGER,
  pct_equity NUMERIC,
  control_indicator TEXT,
  regulatory_indicator TEXT,
  termination_reason TEXT,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_url TEXT,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT nic_relationships_key UNIQUE (parent_rssd, offspring_rssd, start_date)
);

CREATE INDEX IF NOT EXISTS nic_relationships_offspring_idx
  ON public.nic_relationships (offspring_rssd, end_date);
CREATE INDEX IF NOT EXISTS nic_relationships_parent_idx
  ON public.nic_relationships (parent_rssd);

CREATE TABLE IF NOT EXISTS public.nic_entities (
  rssd TEXT PRIMARY KEY,
  legal_name TEXT NOT NULL,
  short_name TEXT,
  entity_type TEXT,
  city TEXT,
  state_code TEXT,
  open_date DATE,
  end_date DATE,
  bhc_indicator TEXT,
  fhc_indicator TEXT,
  fdic_cert TEXT,
  -- 'active' or 'closed': which NIC attributes file the row came from.
  file_kind TEXT NOT NULL,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT nic_entities_file_kind_check CHECK (file_kind IN ('active', 'closed'))
);

ALTER TABLE public.holding_company_y9c_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holding_company_y9c_filers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nic_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nic_entities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.holding_company_y9c_items FROM anon, authenticated;
REVOKE ALL ON public.holding_company_y9c_filers FROM anon, authenticated;
REVOKE ALL ON public.nic_relationships FROM anon, authenticated;
REVOKE ALL ON public.nic_entities FROM anon, authenticated;

-- ============================================================
-- 6. ubpr-peer-groups (migration-fragments/ubpr-peer-groups.sql)
-- ============================================================

-- FFIEC Uniform Bank Performance Report (UBPR) peer groups and peer-group averages,
-- loaded by Magellan's registry step "ubpr-peer-groups" (src/lib/agents/magellan/registry/ubpr-peer-groups.ts).
--
-- 1. ubpr_bank_peer_groups: one row per bank (RSSD) per quarter: the bank's UBPR peer group
--    number as filed, and its own value for the fee-related ratios whose column passed the
--    loader's description check (noninterest income / average assets, service charges /
--    average assets, efficiency ratio, ROA, NIM, net charge-offs / average loans), in percent.
--    A ratio whose cell was blank or whose column did not check out is absent from `ratios`,
--    never zero. `ratio_codes` holds the UBPR column code each value came from; `raw_json`
--    keeps the bank's kept cells as filed. Banks not in institution_sources are kept with
--    institution_id NULL.
-- 2. ubpr_peer_group_averages: the regulator's published average for each ratio and peer
--    group per quarter, from the UBPR peer statistics bulk product, with the column's code and
--    description as the file gave them. Our own medians are computed at read time and never
--    stored here.
--
-- Additive: creates two empty tables and their indexes. Changes no existing data.

CREATE TABLE IF NOT EXISTS public.ubpr_bank_peer_groups (
  id BIGSERIAL PRIMARY KEY,
  rssd TEXT NOT NULL,
  report_date DATE NOT NULL,
  institution_id BIGINT REFERENCES public.institution_sources(id) ON DELETE SET NULL,
  -- As filed (trimmed); NULL when the bank's cell was blank or no peer group column checked out.
  peer_group TEXT,
  ratios JSONB NOT NULL DEFAULT '{}'::jsonb,
  ratio_codes JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_json JSONB,
  source_file TEXT,
  source_url TEXT,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (rssd, report_date)
);

CREATE INDEX IF NOT EXISTS ubpr_bank_peer_groups_date_group_idx
  ON public.ubpr_bank_peer_groups (report_date, peer_group);

CREATE INDEX IF NOT EXISTS ubpr_bank_peer_groups_institution_idx
  ON public.ubpr_bank_peer_groups (institution_id, report_date)
  WHERE institution_id IS NOT NULL;

ALTER TABLE public.ubpr_bank_peer_groups ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.ubpr_peer_group_averages (
  id BIGSERIAL PRIMARY KEY,
  report_date DATE NOT NULL,
  peer_group TEXT NOT NULL,
  -- Our name for the ratio (roa, nim, efficiency_ratio, ...).
  ratio_key TEXT NOT NULL,
  -- The column code and description exactly as the file carried them.
  ratio_code TEXT,
  ratio_description TEXT,
  value NUMERIC NOT NULL,
  source_file TEXT,
  raw_json JSONB,
  source_url TEXT,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (report_date, peer_group, ratio_key)
);

CREATE INDEX IF NOT EXISTS ubpr_peer_group_averages_key_date_idx
  ON public.ubpr_peer_group_averages (ratio_key, report_date);

ALTER TABLE public.ubpr_peer_group_averages ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 7. designation-lists (migration-fragments/designation-lists.sql)
-- ============================================================

-- institution_designations: published designation lists that become peer filters, loaded by
-- Magellan's registry step `registry-designation-lists` (src/lib/agents/magellan/registry/designation-lists.ts).
--
-- One row per list row and designation. `source` is the list (one registry partition each):
--   fdic-institution-flags  FDIC BankFind institutions: minority_depository (MDI_STATUS_*),
--                           fdic_specialty_group (SPECGRP/SPECGRPN), ownership_form (MUTUAL:
--                           mutual|stock), subchapter_s (SUBCHAPS)
--   ncua-foicu-flags        FOICU.txt in the newest NCUA 5300 zip: low_income (LIMITED_INC),
--                           field_of_membership (TOM_CODE as filed), year_chartered (YEAR_OPENED)
--   ncua-mdi                NCUA's minority depository institution list: minority_depository
--   cdfi-fund               CDFI Fund certified CDFIs (bank, thrift, credit union, holding company
--                           types only): cdfi
--   bank-on                 Bank On certified accounts (joinbankon.org): bank_on_certified
-- `value` is the listed value (MDI group, specialty group name, FOM code, year, mutual/stock) or
-- 'yes' for a flag. Matching: FDIC cert or NCUA charter when the list carries one, else exact
-- normalized name + state. Unmatched rows are kept with institution_id NULL and
-- unmatched_reason set; each run lists them in registry_ingest_partitions.detail.cleaning.
-- `raw` keeps the source fields of the row, so a mapping fix needs no re-fetch.
-- A run replaces its list's rows (rows the list no longer carries are deleted), unless the new
-- read is under half the stored rows, which is reported and the old rows kept.
--
-- Additive: creates one empty table and its indexes. Changes no existing data.

CREATE TABLE IF NOT EXISTS public.institution_designations (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  designation TEXT NOT NULL,
  value TEXT NOT NULL,
  -- Stable key within the list: FDIC cert, NCUA charter, or normalized name|state.
  record_key TEXT NOT NULL,
  institution_id BIGINT REFERENCES public.institution_sources(id) ON DELETE SET NULL,
  listed_name TEXT,
  listed_state TEXT,
  listed_city TEXT,
  listed_cert TEXT,
  listed_charter TEXT,
  -- Organization type as the list states it (CDFI list); null otherwise.
  org_type TEXT,
  -- fdic_cert | ncua_charter | name_state; null when unmatched.
  matched_by TEXT,
  -- key_not_found | name_state_not_found | ambiguous_name_state | no_state | holding_company.
  unmatched_reason TEXT,
  -- Date the list speaks for: 5300 quarter end, a date in the file name, or the fetch date
  -- (the partition detail's as_of_basis says which).
  as_of DATE,
  source_url TEXT,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT institution_designations_source_check
    CHECK (source IN ('fdic-institution-flags', 'ncua-foicu-flags', 'ncua-mdi', 'cdfi-fund', 'bank-on')),
  CONSTRAINT institution_designations_matched_by_check
    CHECK (matched_by IS NULL OR matched_by IN ('fdic_cert', 'ncua_charter', 'name_state')),
  UNIQUE (source, designation, record_key)
);

CREATE INDEX IF NOT EXISTS institution_designations_designation_institution_idx
  ON public.institution_designations (designation, institution_id)
  WHERE institution_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS institution_designations_institution_idx
  ON public.institution_designations (institution_id)
  WHERE institution_id IS NOT NULL;

ALTER TABLE public.institution_designations ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 8. payment-networks (migration-fragments/payment-networks.sql)
-- ============================================================

-- Three tables for Magellan's payment-networks registry source (src/lib/agents/magellan/registry/payment-networks.ts).
--
-- 1. institution_network_memberships: one row per institution named on a published participant
--    list, per snapshot. network is 'zelle', 'fednow', 'rtp', 'reg-ii-not-exempt' (the Fed's
--    Regulation II covered debit issuers) or 'reg-ii-exempt'. as_of is the date the publisher
--    gives its list, or the fetch date when it gives none (the run detail says which).
--    institution_id is NULL when the listed name matched no institution we track (or matched
--    two or more); those rows are kept and counted. raw_json is the listed row as read.
-- 2. reg_ii_interchange_figures: the Fed's Regulation II interchange fee tables, one row per
--    table cell as published (value_text verbatim; value NULL when the cell is not a number).
-- 3. osm_financial_locations: OpenStreetMap ATMs (amenity=atm) and bank branches
--    (amenity=bank), one row per OSM element, refreshed one state at a time through the
--    Overpass API. Licensed ODbL 1.0: attribution is stored on every row and must be shown
--    with any use. institution_id is set only on an exact normalized operator/brand name match.
--    network_tag is OSM's own `network` tag (e.g. an ATM network) as mapped, never inferred.
--
-- Additive: creates three empty tables and their indexes. Changes no existing data.

CREATE TABLE IF NOT EXISTS public.institution_network_memberships (
  id BIGSERIAL PRIMARY KEY,
  network TEXT NOT NULL,
  as_of DATE NOT NULL,
  -- Hash of network, normalized name, state, city and listed ids: one listed row per snapshot.
  listed_key TEXT NOT NULL,
  institution_id BIGINT REFERENCES public.institution_sources(id) ON DELETE SET NULL,
  -- rssd, fdic_cert, ncua_charter, name_state or name_only_unique; NULL when unmatched.
  match_method TEXT,
  listed_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  listed_city TEXT,
  listed_state CHAR(2),
  listed_rssd TEXT,
  listed_cert TEXT,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_url TEXT,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT institution_network_memberships_match_check
    CHECK (match_method IS NULL OR match_method IN ('rssd', 'fdic_cert', 'ncua_charter', 'name_state', 'name_only_unique')),
  UNIQUE (network, as_of, listed_key)
);

CREATE INDEX IF NOT EXISTS institution_network_memberships_network_asof_idx
  ON public.institution_network_memberships (network, as_of);
CREATE INDEX IF NOT EXISTS institution_network_memberships_institution_idx
  ON public.institution_network_memberships (institution_id) WHERE institution_id IS NOT NULL;

ALTER TABLE public.institution_network_memberships ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.reg_ii_interchange_figures (
  id BIGSERIAL PRIMARY KEY,
  page_url TEXT NOT NULL,
  table_index INT NOT NULL,
  table_title TEXT,
  row_label TEXT NOT NULL,
  column_label TEXT NOT NULL,
  value_text TEXT NOT NULL,
  value NUMERIC,
  -- dollars, cents or percent when the cell or table says so; NULL otherwise.
  unit TEXT,
  survey_year INT,
  as_of DATE NOT NULL,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reg_ii_interchange_figures_unit_check CHECK (unit IS NULL OR unit IN ('dollars', 'cents', 'percent')),
  UNIQUE (page_url, table_index, row_label, column_label)
);

CREATE INDEX IF NOT EXISTS reg_ii_interchange_figures_year_idx
  ON public.reg_ii_interchange_figures (survey_year);

ALTER TABLE public.reg_ii_interchange_figures ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.osm_financial_locations (
  id BIGSERIAL PRIMARY KEY,
  osm_type TEXT NOT NULL,
  osm_id BIGINT NOT NULL,
  -- The state partition whose Overpass query returned it.
  partition_state CHAR(2) NOT NULL,
  kind TEXT NOT NULL,
  name TEXT,
  operator TEXT,
  brand TEXT,
  network_tag TEXT,
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  addr_city TEXT,
  addr_state CHAR(2),
  institution_id BIGINT REFERENCES public.institution_sources(id) ON DELETE SET NULL,
  match_method TEXT,
  -- operator or brand: the tag the exact name match was made on.
  match_field TEXT,
  tags JSONB NOT NULL DEFAULT '{}'::jsonb,
  attribution TEXT NOT NULL,
  -- Date of the newest pull that returned this element; reads use each state's newest as_of.
  as_of DATE NOT NULL,
  source_url TEXT,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT osm_financial_locations_kind_check CHECK (kind IN ('atm', 'bank')),
  UNIQUE (osm_type, osm_id)
);

CREATE INDEX IF NOT EXISTS osm_financial_locations_state_asof_idx
  ON public.osm_financial_locations (partition_state, as_of);
CREATE INDEX IF NOT EXISTS osm_financial_locations_institution_idx
  ON public.osm_financial_locations (institution_id) WHERE institution_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS osm_financial_locations_network_tag_idx
  ON public.osm_financial_locations (network_tag) WHERE network_tag IS NOT NULL;

ALTER TABLE public.osm_financial_locations ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 9. economy (migration-fragments/economy.sql)
-- ============================================================

-- Local-economy public data, loaded by Magellan's economy registry steps
-- (src/lib/agents/magellan/registry/economy.ts).
--
-- area_statistics: one published value for one area (nation 'US', state postal code, county
--   5-digit FIPS, metro 5-digit CBSA), one period ('2024', '2026Q2', '2026-09') and one series,
--   with its unit and source. Holds USDA rural-urban continuum codes, BLS QCEW, Census County
--   Business Patterns, Census SAIPE poverty, BEA personal income, the FHFA house price index,
--   FDIC household survey shares, Fed SHED national shares, FDIC industry totals, FDIC national
--   rates and Atlanta Fed payment choice tables. A blank or suppressed value is NULL with the
--   publisher's flag in `note`, never zero. raw_json keeps the source record.
-- branch_census_tracts: the 2020-vintage census tract each current bank (SOD) and credit union
--   branch sits in, from the Census geocoder; status says why a branch has none.
-- remittance_prices: World Bank Remittance Prices Worldwide quotes for US-send corridors, by
--   provider; institution_id only on an exact (case-insensitive), unique name match.
-- zip_county_crosswalk: HUD USPS ZIP-to-county crosswalk with address-share ratios.
-- institution_hq_counties (view): the county of each institution's main office, from the SOD
--   main office (banks) or the NCUA main office, geocoded or matched by county name (credit unions).
--
-- FFIEC tract income levels go to the existing census_tracts table (county_fips there is the
-- 5-digit state+county code). institution_sources.urban_rural already exists.
--
-- Additive and idempotent: new empty tables, indexes and a view. Changes no existing data.

CREATE TABLE IF NOT EXISTS public.area_statistics (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  geo_type TEXT NOT NULL CHECK (geo_type IN ('nation', 'state', 'county', 'metro')),
  geo_code TEXT NOT NULL,
  geo_name TEXT,
  state_code TEXT,
  period TEXT NOT NULL,
  series_key TEXT NOT NULL,
  value DOUBLE PRECISION,
  unit TEXT NOT NULL,
  note TEXT,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_url TEXT,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, geo_type, geo_code, period, series_key)
);

CREATE INDEX IF NOT EXISTS area_statistics_geo_idx
  ON public.area_statistics (geo_type, geo_code, series_key, period DESC);

CREATE INDEX IF NOT EXISTS area_statistics_series_idx
  ON public.area_statistics (series_key, geo_type, period DESC);

CREATE INDEX IF NOT EXISTS area_statistics_state_idx
  ON public.area_statistics (state_code, geo_type, series_key)
  WHERE state_code IS NOT NULL;

ALTER TABLE public.area_statistics ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.area_statistics FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.branch_census_tracts (
  id BIGSERIAL PRIMARY KEY,
  -- 'bank' (branch_key = cert:branch_number) or 'credit_union' (branch_key = charter:site_id)
  branch_kind TEXT NOT NULL CHECK (branch_kind IN ('bank', 'credit_union')),
  branch_key TEXT NOT NULL,
  institution_id BIGINT REFERENCES public.institution_sources(id) ON DELETE SET NULL,
  -- md5 of the address the placement was made from; a changed address is placed again.
  address_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('matched', 'matched_coordinates', 'no_match', 'tie', 'no_address')),
  state_fips TEXT,
  county_fips TEXT,
  tract_id TEXT,
  tract_vintage INTEGER,
  agent_run_id BIGINT,
  placed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (branch_kind, branch_key)
);

CREATE INDEX IF NOT EXISTS branch_census_tracts_institution_idx
  ON public.branch_census_tracts (institution_id);

CREATE INDEX IF NOT EXISTS branch_census_tracts_tract_idx
  ON public.branch_census_tracts (tract_id)
  WHERE tract_id IS NOT NULL;

ALTER TABLE public.branch_census_tracts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.branch_census_tracts FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.remittance_prices (
  id BIGSERIAL PRIMARY KEY,
  period TEXT NOT NULL,
  source_country TEXT NOT NULL,
  destination_country TEXT NOT NULL,
  firm TEXT NOT NULL,
  firm_type TEXT,
  product TEXT,
  amount_sent DOUBLE PRECISION,
  fee DOUBLE PRECISION,
  fx_margin_pct DOUBLE PRECISION,
  total_cost_pct DOUBLE PRECISION,
  institution_id BIGINT REFERENCES public.institution_sources(id) ON DELETE SET NULL,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_url TEXT,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS remittance_prices_quote_key
  ON public.remittance_prices (period, source_country, destination_country, firm, (COALESCE(product, '')));

CREATE INDEX IF NOT EXISTS remittance_prices_institution_idx
  ON public.remittance_prices (institution_id)
  WHERE institution_id IS NOT NULL;

ALTER TABLE public.remittance_prices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.remittance_prices FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.zip_county_crosswalk (
  id BIGSERIAL PRIMARY KEY,
  period TEXT NOT NULL,
  zip TEXT NOT NULL,
  county_fips TEXT NOT NULL,
  state_code TEXT,
  city TEXT,
  res_ratio DOUBLE PRECISION,
  bus_ratio DOUBLE PRECISION,
  oth_ratio DOUBLE PRECISION,
  tot_ratio DOUBLE PRECISION,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (period, zip, county_fips)
);

CREATE INDEX IF NOT EXISTS zip_county_crosswalk_zip_idx
  ON public.zip_county_crosswalk (zip, period DESC);

ALTER TABLE public.zip_county_crosswalk ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.zip_county_crosswalk FROM PUBLIC, anon, authenticated;

-- HQ county per institution. Banks: the newest Summary of Deposits main office. Credit unions:
-- the NCUA main office's geocoded tract county, else its county name matched to a RUCC county
-- in the same state when exactly one county carries that name (so "Baltimore" city/county and
-- other shared names stay unmatched rather than guessed).
CREATE OR REPLACE VIEW public.institution_hq_counties WITH (security_invoker = true) AS
WITH bank AS (
  SELECT DISTINCT ON (d.institution_id)
         d.institution_id, lpad(d.county_fips::text, 5, '0') AS county_fips, 'sod_main_office'::text AS basis
    FROM public.institution_branch_deposits d
   WHERE d.is_main_office AND d.institution_id IS NOT NULL AND d.county_fips IS NOT NULL
   ORDER BY d.institution_id, d.year DESC
), cu_tract AS (
  SELECT DISTINCT ON (b.institution_id)
         b.institution_id, t.county_fips, 'ncua_main_office_geocoded'::text AS basis
    FROM public.credit_union_branches b
    JOIN public.branch_census_tracts t
      ON t.branch_kind = 'credit_union' AND t.branch_key = b.charter || ':' || b.site_id
     AND t.county_fips IS NOT NULL
   WHERE b.is_main_office AND b.institution_id IS NOT NULL
   ORDER BY b.institution_id, b.report_date DESC
), county_names AS (
  SELECT state_code,
         regexp_replace(replace(replace(upper(geo_name), '.', ''), 'SAINT ', 'ST '),
                        '\s+(COUNTY|PARISH|BOROUGH|CENSUS AREA|CITY AND BOROUGH|MUNICIPALITY)$', '') AS name_key,
         MIN(geo_code) AS county_fips
    FROM public.area_statistics
   WHERE source = 'usda-rucc' AND geo_type = 'county' AND geo_name IS NOT NULL AND state_code IS NOT NULL
   GROUP BY 1, 2
  HAVING COUNT(DISTINCT geo_code) = 1
), cu_name AS (
  SELECT DISTINCT ON (b.institution_id)
         b.institution_id, n.county_fips, 'ncua_main_office_county_name'::text AS basis
    FROM public.credit_union_branches b
    JOIN county_names n
      ON n.state_code = upper(b.state)
     AND n.name_key = regexp_replace(replace(replace(upper(trim(b.county_name)), '.', ''), 'SAINT ', 'ST '),
                                     '\s+(COUNTY|PARISH|BOROUGH|CENSUS AREA|CITY AND BOROUGH|MUNICIPALITY)$', '')
   WHERE b.is_main_office AND b.institution_id IS NOT NULL AND b.county_name IS NOT NULL
   ORDER BY b.institution_id, b.report_date DESC
)
SELECT institution_id, county_fips, basis FROM bank
UNION ALL
SELECT institution_id, county_fips, basis FROM cu_tract
UNION ALL
SELECT n.institution_id, n.county_fips, n.basis
  FROM cu_name n
 WHERE NOT EXISTS (SELECT 1 FROM cu_tract t WHERE t.institution_id = n.institution_id);

REVOKE ALL ON TABLE public.institution_hq_counties FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 10. industry-events (migration-fragments/industry-events.sql)
-- ============================================================

-- Industry events (Magellan registry source 'industry-events'). Additive: new empty tables and
-- one index on an existing table. Changes no existing data.
--
-- Reuses institution_structure_events (migration 058) for failures, mergers, liquidations and
-- early-warning application lines, with these `source` values next to 'fdic-history':
--   'fdic-failures'      BankFind /failures; change_code = RESTYPE1 (PA, PI ...), change_description = RESTYPE (FAILURE / ASSISTANCE)
--   'ncua-mergers'       NCUA merger / P&A list; cert = merging CU charter; acquirer_* = continuing CU
--   'ncua-liquidations'  NCUA liquidation list; cert = CU charter
--   'fed-h2'             Fed H.2 weekly actions; change_code = release heading, change_description = the line as published
--   'occ-bulletin'       OCC Weekly Bulletin; same shape as fed-h2
-- For these rows office_city / office_state hold the institution's own city and state from the list.
--
-- New tables:
--   fhlb_members          FHFA quarterly FHLBank membership file, one row per bank + member; last_seen_at marks the latest file.
--   cdfi_awards           CDFI Fund award list, one row per award as published.
--   sba_lender_lending    SBA 7(a)/504 FOIA loans summed per lender, project state, fiscal year (no loan-level rows).
--   sec_fee_income_facts  XBRL us-gaap fee-income lines (service charges on deposits, overdraft, card fees) per filer and calendar year.
--   sec_event_filings     8-Ks scanned for merger items 1.01 / 2.01 and the newest 10-K per filer scanned for fee passages.
--   fee_lawsuits          Overdraft / NSF / re-presentment dockets from CourtListener; institution_id only on an exact defendant-name match.
--   rule_comments         regulations.gov comments from banks and credit unions on fee rulemaking dockets.
-- Every table keeps unmatched rows with institution_id NULL; blanks stay NULL, never zero.

CREATE INDEX IF NOT EXISTS institution_structure_events_source_date_idx
  ON public.institution_structure_events (source, effective_date);

CREATE TABLE IF NOT EXISTS public.fhlb_members (
  id BIGSERIAL PRIMARY KEY,
  row_key TEXT NOT NULL UNIQUE,
  fhlbank TEXT,
  member_name TEXT,
  city TEXT,
  state TEXT,
  rssd_id TEXT,
  fdic_cert TEXT,
  ncua_charter TEXT,
  fhfa_id TEXT,
  charter_type TEXT,
  membership_date DATE,
  institution_id BIGINT REFERENCES public.institution_sources(id) ON DELETE SET NULL,
  match_method TEXT,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  file_url TEXT,
  agent_run_id BIGINT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS fhlb_members_institution_idx ON public.fhlb_members (institution_id);
ALTER TABLE public.fhlb_members ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.cdfi_awards (
  id BIGSERIAL PRIMARY KEY,
  row_key TEXT NOT NULL UNIQUE,
  awardee_name TEXT,
  city TEXT,
  state TEXT,
  program TEXT,
  award_year INT,
  -- The year cell as published ("FY2024", "2024 Round"), kept because award_year is read from it.
  award_year_raw TEXT,
  award_amount NUMERIC,
  institution_type TEXT,
  institution_id BIGINT REFERENCES public.institution_sources(id) ON DELETE SET NULL,
  match_method TEXT,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_url TEXT,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS cdfi_awards_state_year_idx ON public.cdfi_awards (state, award_year);
ALTER TABLE public.cdfi_awards ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.sba_lender_lending (
  id BIGSERIAL PRIMARY KEY,
  -- program|fiscal_year|lender key (fdic:<cert>, ncua:<charter> or name:<name>|<state>)|project_state
  row_key TEXT NOT NULL UNIQUE,
  program TEXT NOT NULL,
  fiscal_year INT NOT NULL,
  lender_name TEXT NOT NULL,
  lender_city TEXT,
  lender_state TEXT,
  lender_fdic_cert TEXT,
  lender_ncua_charter TEXT,
  project_state TEXT,
  loans INT NOT NULL,
  -- Loans whose gross approval was filled in; gross_approval sums only those.
  loans_with_amount INT NOT NULL,
  gross_approval NUMERIC,
  sba_guaranteed NUMERIC,
  third_party_dollars NUMERIC,
  institution_id BIGINT REFERENCES public.institution_sources(id) ON DELETE SET NULL,
  match_method TEXT,
  partition_key TEXT,
  source_url TEXT,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sba_lender_lending_program_check CHECK (program IN ('7a', '504'))
);
CREATE INDEX IF NOT EXISTS sba_lender_lending_year_idx ON public.sba_lender_lending (program, fiscal_year, project_state);
CREATE INDEX IF NOT EXISTS sba_lender_lending_institution_idx ON public.sba_lender_lending (institution_id, fiscal_year);
ALTER TABLE public.sba_lender_lending ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.sec_fee_income_facts (
  id BIGSERIAL PRIMARY KEY,
  cik TEXT NOT NULL,
  institution_id BIGINT REFERENCES public.institution_sources(id) ON DELETE SET NULL,
  concept TEXT NOT NULL,
  -- SEC's own label and description for the concept, read from the same response.
  label TEXT,
  description TEXT,
  frame TEXT NOT NULL,
  period_start DATE,
  period_end DATE NOT NULL,
  value NUMERIC NOT NULL,
  accession_no TEXT,
  form TEXT,
  filed DATE,
  source_url TEXT,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cik, concept, frame)
);
CREATE INDEX IF NOT EXISTS sec_fee_income_facts_concept_idx ON public.sec_fee_income_facts (concept, frame);
ALTER TABLE public.sec_fee_income_facts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.sec_event_filings (
  id BIGSERIAL PRIMARY KEY,
  accession_no TEXT NOT NULL UNIQUE,
  cik TEXT NOT NULL,
  institution_id BIGINT REFERENCES public.institution_sources(id) ON DELETE SET NULL,
  form TEXT NOT NULL,
  filed_at DATE,
  filing_url TEXT,
  items TEXT[] NOT NULL DEFAULT '{}',
  merger_agreement BOOLEAN,
  merger_completion BOOLEAN,
  -- [{kind: merger_agreement | merger_completion | fee_income, phrase, text}]
  passages JSONB NOT NULL DEFAULT '[]'::jsonb,
  text_chars INT,
  text_truncated BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL,
  error TEXT,
  parser_version INT NOT NULL,
  agent_run_id BIGINT,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sec_event_filings_status_check CHECK (status IN ('scanned', 'fetch_failed'))
);
CREATE INDEX IF NOT EXISTS sec_event_filings_merger_idx ON public.sec_event_filings (filed_at) WHERE merger_agreement OR merger_completion;
CREATE INDEX IF NOT EXISTS sec_event_filings_institution_idx ON public.sec_event_filings (institution_id, filed_at);
ALTER TABLE public.sec_event_filings ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.fee_lawsuits (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'courtlistener',
  docket_id TEXT NOT NULL,
  case_name TEXT,
  court TEXT,
  court_id TEXT,
  docket_number TEXT,
  filed_date DATE,
  docket_url TEXT,
  suit_nature TEXT,
  cause TEXT,
  -- The defendant side of the case name as written; institution_id is set only on an exact name match.
  defendant_name TEXT,
  institution_id BIGINT REFERENCES public.institution_sources(id) ON DELETE SET NULL,
  match_method TEXT,
  partition_key TEXT,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, docket_id)
);
CREATE INDEX IF NOT EXISTS fee_lawsuits_institution_idx ON public.fee_lawsuits (institution_id, filed_date);
CREATE INDEX IF NOT EXISTS fee_lawsuits_filed_idx ON public.fee_lawsuits (filed_date);
ALTER TABLE public.fee_lawsuits ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.rule_comments (
  id BIGSERIAL PRIMARY KEY,
  comment_id TEXT NOT NULL UNIQUE,
  topic TEXT NOT NULL,
  docket_id TEXT NOT NULL,
  docket_title TEXT,
  agency_id TEXT,
  title TEXT,
  submitter_name TEXT,
  posted_date DATE,
  comment_url TEXT,
  institution_id BIGINT REFERENCES public.institution_sources(id) ON DELETE SET NULL,
  match_method TEXT,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS rule_comments_docket_idx ON public.rule_comments (docket_id);
CREATE INDEX IF NOT EXISTS rule_comments_institution_idx ON public.rule_comments (institution_id);
ALTER TABLE public.rule_comments ENABLE ROW LEVEL SECURITY;
