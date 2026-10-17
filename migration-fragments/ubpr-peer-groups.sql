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
