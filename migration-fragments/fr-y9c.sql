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
