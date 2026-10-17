-- Public data loaders, round 3: tables for entity and location rows that do not fit area_statistics.
-- Additive only: new empty tables, indexes and RLS. Changes no existing data.

-- migration-fragments/locations-gleif.sql
-- AllThePlaces bank/ATM locations and GLEIF legal entities + parent relationships.
--
-- Why new tables and not area_statistics: these are point locations (one row per branch or ATM,
-- with coordinates, brand and an institution link) and legal-entity rows (one row per LEI, one
-- row per parent relationship). area_statistics holds one number per area, period and series;
-- the area counts derived from the locations DO go there (series atp_bank_branch_locations and
-- atp_atm_locations, by nation, state and county), but distance reads ("competitor ATMs within
-- N miles of a branch") and corporate-family reads need the rows themselves.
--
-- Additive only: four new empty tables, their indexes and RLS. Changes no existing data.
-- RLS is enabled with no policies, so only the service role (server code) reads or writes them.
-- Each table has a unique key the loader upserts on, so a re-run of a partition is idempotent.
-- To ship: copy into supabase/migrations/ under the next 14-digit number (migration-version-kill).

-- 1. AllThePlaces (CC0 1.0) bank branches (amenity=bank) and ATMs (amenity=atm), US only.
--    institution_id is set only through brand_wikidata_institutions (reviewed QID mapping) or an
--    exact normalized brand/operator name equal to one tracked institution in the same state.
--    Reads use each spider's newest atp_run_id, so a location a chain closed drops out.
CREATE TABLE IF NOT EXISTS public.atp_financial_locations (
  id BIGSERIAL PRIMARY KEY,
  spider TEXT NOT NULL,
  -- The feature's own id; else 'ref:<ref>'; else 'hash:<sha1 of name, address, point>'.
  feature_key TEXT NOT NULL,
  key_basis TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT,
  brand TEXT,
  brand_wikidata TEXT,
  operator TEXT,
  operator_wikidata TEXT,
  address TEXT,
  city TEXT,
  state CHAR(2),
  zip CHAR(5),
  -- Five-digit FIPS of the county outline holding the point (us-atlas 1:10m); NULL without a point.
  county_fips CHAR(5),
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  ref TEXT,
  -- The page the spider read the location from (@source_uri), when given.
  source_ref TEXT,
  institution_id BIGINT REFERENCES public.institution_sources(id) ON DELETE SET NULL,
  match_method TEXT,
  match_field TEXT,
  atp_run_id TEXT NOT NULL,
  as_of DATE,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  attribution TEXT NOT NULL,
  source_url TEXT,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT atp_financial_locations_kind_check CHECK (kind IN ('branch', 'atm')),
  CONSTRAINT atp_financial_locations_key_basis_check CHECK (key_basis IN ('id', 'ref', 'hash')),
  CONSTRAINT atp_financial_locations_match_check
    CHECK (match_method IS NULL OR match_method IN ('brand_wikidata', 'operator_wikidata', 'name_state')),
  UNIQUE (spider, feature_key)
);

CREATE INDEX IF NOT EXISTS atp_financial_locations_spider_run_idx
  ON public.atp_financial_locations (spider, atp_run_id);
CREATE INDEX IF NOT EXISTS atp_financial_locations_lat_lon_idx
  ON public.atp_financial_locations (lat, lon) WHERE lat IS NOT NULL;
CREATE INDEX IF NOT EXISTS atp_financial_locations_county_idx
  ON public.atp_financial_locations (county_fips, kind);
CREATE INDEX IF NOT EXISTS atp_financial_locations_institution_idx
  ON public.atp_financial_locations (institution_id) WHERE institution_id IS NOT NULL;

ALTER TABLE public.atp_financial_locations ENABLE ROW LEVEL SECURITY;

-- 2. Reviewed brand -> institution mapping (Wikidata QID, e.g. 'Q123'). Filled by a person after
--    review, never by the loader; the loader only reads it.
CREATE TABLE IF NOT EXISTS public.brand_wikidata_institutions (
  brand_wikidata TEXT PRIMARY KEY,
  institution_id BIGINT NOT NULL REFERENCES public.institution_sources(id) ON DELETE CASCADE,
  brand_name TEXT,
  note TEXT,
  reviewed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT brand_wikidata_institutions_qid_check CHECK (brand_wikidata ~ '^Q[0-9]+$')
);

ALTER TABLE public.brand_wikidata_institutions ENABLE ROW LEVEL SECURITY;

-- 3. GLEIF level 1: one row per LEI we track (institution_sources.lei) and each member of their
--    corporate families. rssd_id is filled only when the record is registered with the Fed's
--    National Information Center (found by name in GLEIF's registration-authority list).
--    institution_id: by LEI equal to institution_sources.lei, else by that RSSD; else NULL.
--    direct/ultimate parent LEIs are copied from gleif_relationships (newest publish).
CREATE TABLE IF NOT EXISTS public.gleif_entities (
  lei CHAR(20) PRIMARY KEY,
  legal_name TEXT,
  jurisdiction TEXT,
  legal_country TEXT,
  legal_region TEXT,
  legal_state CHAR(2),
  legal_city TEXT,
  hq_country TEXT,
  category TEXT,
  legal_form_id TEXT,
  entity_status TEXT,
  registration_status TEXT,
  registered_at_id TEXT,
  registered_as TEXT,
  rssd_id TEXT,
  last_update TEXT,
  next_renewal TEXT,
  direct_parent_lei CHAR(20),
  ultimate_parent_lei CHAR(20),
  institution_id BIGINT REFERENCES public.institution_sources(id) ON DELETE SET NULL,
  link_method TEXT,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_url TEXT,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT gleif_entities_link_check CHECK (link_method IS NULL OR link_method IN ('lei', 'rssd'))
);

CREATE INDEX IF NOT EXISTS gleif_entities_institution_idx
  ON public.gleif_entities (institution_id) WHERE institution_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS gleif_entities_ultimate_parent_idx
  ON public.gleif_entities (ultimate_parent_lei) WHERE ultimate_parent_lei IS NOT NULL;
CREATE INDEX IF NOT EXISTS gleif_entities_rssd_idx
  ON public.gleif_entities (rssd_id) WHERE rssd_id IS NOT NULL;

ALTER TABLE public.gleif_entities ENABLE ROW LEVEL SECURITY;

-- 4. GLEIF level 2: accounting-consolidation parents from the golden copy's relationship file.
--    One row per (child, parent, kind); last_seen_publish is the golden-copy publish date of the
--    newest file that still carried it, so reads use the newest publish only.
CREATE TABLE IF NOT EXISTS public.gleif_relationships (
  id BIGSERIAL PRIMARY KEY,
  child_lei CHAR(20) NOT NULL,
  parent_lei CHAR(20) NOT NULL,
  kind TEXT NOT NULL,
  relationship_status TEXT,
  registration_status TEXT,
  last_seen_publish TEXT NOT NULL,
  source_url TEXT,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT gleif_relationships_kind_check CHECK (kind IN ('direct', 'ultimate')),
  UNIQUE (child_lei, parent_lei, kind)
);

CREATE INDEX IF NOT EXISTS gleif_relationships_parent_idx
  ON public.gleif_relationships (parent_lei, kind);
CREATE INDEX IF NOT EXISTS gleif_relationships_publish_idx
  ON public.gleif_relationships (last_seen_publish);

ALTER TABLE public.gleif_relationships ENABLE ROW LEVEL SECURITY;

-- state-lists: two entity tables for Magellan's state list loaders
-- (src/lib/agents/magellan/registry/state-lists.ts).
--
-- Why new tables and not area_statistics: both sources are lists of named entities (one row per
-- depository or licensee, with an address, a license number and a status), not one number per
-- area and period. area_statistics still gets the counts: non-bank licensees by state and county
-- per license type, and the Urban Institute debt shares. Additive only; nothing existing changes.
-- RLS on with no policies: service-role reads only, like the other registry tables.

-- One row per depository per published list. The list is a quarterly snapshot, so each list date
-- keeps its own rows (history of who joined, capped or withdrew) and a re-run of the same list
-- updates in place.
CREATE TABLE IF NOT EXISTS public.state_public_depositories (
  id BIGSERIAL PRIMARY KEY,
  -- State whose public-funds program publishes the list (FL).
  program_state TEXT NOT NULL,
  -- Date the list speaks for; list_date_basis says how it was found.
  list_date DATE NOT NULL,
  -- file_name | file_title | fetched
  list_date_basis TEXT NOT NULL,
  -- cert:<n>, charter:<n>, or normalized name|state|city.
  record_key TEXT NOT NULL,
  listed_name TEXT NOT NULL,
  listed_city TEXT,
  listed_home_state TEXT,
  listed_cert TEXT,
  listed_charter TEXT,
  -- listed | limited | withdrawing | qualified | other (status_text keeps what was printed).
  status TEXT NOT NULL,
  status_text TEXT,
  status_date DATE,
  institution_id BIGINT REFERENCES public.institution_sources(id) ON DELETE SET NULL,
  -- fdic_cert | ncua_charter | name_state; null when unmatched.
  matched_by TEXT,
  -- key_not_found | name_state_not_found | ambiguous_name_state; null when matched.
  unmatched_reason TEXT,
  source_url TEXT,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT state_public_depositories_status_check
    CHECK (status IN ('listed', 'limited', 'withdrawing', 'qualified', 'other')),
  CONSTRAINT state_public_depositories_matched_by_check
    CHECK (matched_by IS NULL OR matched_by IN ('fdic_cert', 'ncua_charter', 'name_state')),
  UNIQUE (program_state, list_date, record_key)
);

CREATE INDEX IF NOT EXISTS state_public_depositories_institution_idx
  ON public.state_public_depositories (institution_id, program_state, list_date DESC)
  WHERE institution_id IS NOT NULL;

ALTER TABLE public.state_public_depositories ENABLE ROW LEVEL SECURITY;

-- One row per licensee (or licensed location) per state open-data dataset. The dataset is a
-- current list, so a re-run updates in place and rows the dataset no longer carries are removed
-- (unless the new read is under half the stored rows; see the registry step).
CREATE TABLE IF NOT EXISTS public.state_nonbank_licensees (
  id BIGSERIAL PRIMARY KEY,
  state TEXT NOT NULL,
  -- Socrata domain and four-by-four id the row came from.
  dataset_domain TEXT NOT NULL,
  dataset_id TEXT NOT NULL,
  -- lic:<number>|type|address, or normalized name|type|address|zip.
  record_key TEXT NOT NULL,
  licensee_name TEXT NOT NULL,
  dba TEXT,
  -- License type as published.
  license_type TEXT NOT NULL,
  -- payday_deferred_deposit | check_casher | money_transmitter | licensed_lender | other
  license_category TEXT NOT NULL,
  license_number TEXT,
  address TEXT,
  city TEXT,
  zip TEXT,
  county TEXT,
  county_fips TEXT,
  -- file_fips | county_name; null when no county could be placed.
  county_basis TEXT,
  license_status TEXT,
  -- true/false from the status text; null when the dataset has no status.
  active BOOLEAN,
  license_date DATE,
  source_url TEXT,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT state_nonbank_licensees_category_check
    CHECK (license_category IN ('payday_deferred_deposit', 'check_casher', 'money_transmitter', 'licensed_lender', 'other')),
  UNIQUE (state, dataset_id, record_key)
);

CREATE INDEX IF NOT EXISTS state_nonbank_licensees_area_idx
  ON public.state_nonbank_licensees (state, license_category, county_fips);

ALTER TABLE public.state_nonbank_licensees ENABLE ROW LEVEL SECURITY;

-- sec-market-value (Magellan registry source 'sec-market-value',
-- src/lib/agents/magellan/registry/sec-market-value.ts; read by
-- src/lib/data-store/sec-market-value-aggregates.ts).
--
-- One row per SEC filer (CIK), dei concept and as-of date: dei:EntityPublicFloat (USD, as of the
-- last business day of the filer's second fiscal quarter) and dei:EntityCommonStockSharesOutstanding
-- (shares, as of each 10-K / 10-Q cover date), from data.sec.gov company facts, for bank holding
-- companies already linked by the sec-links step. When several filings repeat a date, the most
-- recently filed value is kept. Values are as filed; nothing is filled, defaulted or derived.
--
-- Why a new table: sec_fee_income_facts is keyed (cik, concept, frame) with frame NOT NULL, and
-- its reader getFeeIncomeFactMedians groups every concept in it as a fee-income line; cover-page
-- dei facts often carry no SEC frame, so storing them there would need an invented frame and would
-- surface market values as fee lines. area_statistics is for geographic areas, not filers.
--
-- Additive and idempotent: one new empty table and an index. Changes no existing data.

CREATE TABLE IF NOT EXISTS public.sec_market_value_facts (
  id BIGSERIAL PRIMARY KEY,
  cik TEXT NOT NULL,
  institution_id BIGINT REFERENCES public.institution_sources(id) ON DELETE SET NULL,
  -- 'dei:EntityPublicFloat' | 'dei:EntityCommonStockSharesOutstanding'
  concept TEXT NOT NULL,
  -- SEC's own label and description for the concept, from the same response.
  label TEXT,
  description TEXT,
  -- 'USD' | 'shares'
  unit TEXT NOT NULL,
  period_end DATE NOT NULL,
  value NUMERIC NOT NULL,
  fiscal_year INT,
  fiscal_period TEXT,
  -- SEC's calendar frame when the fact has one (e.g. CY2025Q2I); NULL otherwise, never invented.
  frame TEXT,
  accession_no TEXT,
  form TEXT,
  filed DATE,
  source_url TEXT,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cik, concept, period_end)
);

CREATE INDEX IF NOT EXISTS sec_market_value_facts_institution_idx
  ON public.sec_market_value_facts (institution_id, concept, period_end DESC);

ALTER TABLE public.sec_market_value_facts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sec_market_value_facts FROM PUBLIC, anon, authenticated;
