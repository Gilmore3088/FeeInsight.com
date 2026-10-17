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
