-- Credit union branch offices from the NCUA 5300 call-report archive ("Credit Union
-- Branch Information"), loaded by Magellan's registry-ncua-branches step. The FDIC
-- Summary of Deposits (institution_branch_deposits) covers banks only.
--
-- NCUA publishes addresses but no coordinates and no per-branch deposits, so
-- latitude/longitude are filled later by registry-ncua-branch-geocode (US Census
-- geocoder) and there is no deposits column. One row per office (charter, site_id);
-- report_date is the newest quarter the office appeared in, so an office missing from
-- the latest quarter is old, never deleted.
--
-- Additive: creates an empty table and its indexes. Changes no existing data.

CREATE TABLE IF NOT EXISTS public.credit_union_branches (
  id BIGSERIAL PRIMARY KEY,
  charter TEXT NOT NULL,
  site_id TEXT NOT NULL,
  institution_id BIGINT REFERENCES public.institution_sources(id) ON DELETE SET NULL,
  report_date DATE NOT NULL,
  cu_name TEXT,
  site_name TEXT,
  site_type TEXT,
  is_main_office BOOLEAN NOT NULL DEFAULT false,
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  county_name TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  -- matched | no_match | null (not tried yet). Reset when the address changes.
  geocode_status TEXT,
  geocoded_at TIMESTAMPTZ,
  agent_run_id BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (charter, site_id)
);

CREATE INDEX IF NOT EXISTS credit_union_branches_institution_idx
  ON public.credit_union_branches (institution_id);

CREATE INDEX IF NOT EXISTS credit_union_branches_state_city_idx
  ON public.credit_union_branches (state, upper(city));

CREATE INDEX IF NOT EXISTS credit_union_branches_zip_idx
  ON public.credit_union_branches (left(zip, 5));

CREATE INDEX IF NOT EXISTS credit_union_branches_geocode_pending_idx
  ON public.credit_union_branches (id)
  WHERE geocode_status IS NULL;

ALTER TABLE public.credit_union_branches ENABLE ROW LEVEL SECURITY;
