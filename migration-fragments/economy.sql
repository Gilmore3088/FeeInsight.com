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
