-- Hamilton studies layer: statistical studies on the joined fee, call report, branch,
-- income and market data, refreshed each quarter by Hamilton's studies run, so Hamilton
-- can cite a result and place one institution in it.
--
-- hamilton_studies           one row per study result (study, method version, data period)
-- hamilton_study_placements  where each institution sits in that study, against its peers
-- inferred_fee_volume        reported overdraft/NSF income divided by the published fee:
--                            implied items paid, a range, always labeled inferred
--
-- Additive only: three new empty tables. No existing row changes.

BEGIN;

CREATE TABLE IF NOT EXISTS public.hamilton_studies (
  id bigserial PRIMARY KEY,
  study_key text NOT NULL,
  method_version integer NOT NULL,
  title text NOT NULL,
  as_of text NOT NULL,
  metric text NOT NULL,
  n integer NOT NULL,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  findings jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_current boolean NOT NULL DEFAULT false,
  agent_run_id bigint,
  computed_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (study_key, method_version, as_of)
);

COMMENT ON TABLE public.hamilton_studies IS
  'One stored study result. as_of is the data period (a year such as 2025, or a quarter such as 2026-Q4). Read the is_current row per study_key.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_hamilton_studies_current
  ON public.hamilton_studies (study_key) WHERE is_current;

CREATE TABLE IF NOT EXISTS public.hamilton_study_placements (
  study_id bigint NOT NULL REFERENCES public.hamilton_studies (id) ON DELETE CASCADE,
  institution_id bigint NOT NULL,
  metric text NOT NULL,
  value double precision,
  peer_group text NOT NULL,
  peer_n integer NOT NULL,
  peer_median double precision,
  percentile double precision,
  quartile smallint,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (study_id, institution_id, metric)
);

CREATE INDEX IF NOT EXISTS idx_hamilton_study_placements_institution
  ON public.hamilton_study_placements (institution_id);

CREATE TABLE IF NOT EXISTS public.inferred_fee_volume (
  institution_id bigint NOT NULL,
  period date NOT NULL,
  fee_category text NOT NULL,
  reported_income numeric NOT NULL,
  published_fee_low numeric NOT NULL,
  published_fee_high numeric NOT NULL,
  items_low numeric NOT NULL,
  items_high numeric NOT NULL,
  peer_group text NOT NULL,
  peer_n integer NOT NULL,
  peer_median_items numeric,
  peer_median_income numeric,
  label text NOT NULL DEFAULT 'inferred',
  basis text NOT NULL,
  study_id bigint REFERENCES public.hamilton_studies (id) ON DELETE SET NULL,
  computed_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (institution_id, period, fee_category)
);

COMMENT ON TABLE public.inferred_fee_volume IS
  'Inferred, never reported: income for the four quarters ending period divided by the published fee. items_low uses the highest published amount, items_high the lowest. Income is net of waivers and refunds.';

ALTER TABLE public.hamilton_studies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hamilton_study_placements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inferred_fee_volume ENABLE ROW LEVEL SECURITY;

COMMIT;
