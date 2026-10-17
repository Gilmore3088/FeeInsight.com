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
