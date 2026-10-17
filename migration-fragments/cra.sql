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
