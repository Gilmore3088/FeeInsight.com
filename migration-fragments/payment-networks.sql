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
