-- fee_index_cache gets a real writer: Hamilton recomputes the national index under the
-- statistics contract (src/lib/data-store/fee-stats.ts) inside its publish transaction.
--
--   * stats_method_version: the contract version a row was computed with. Readers
--     ignore rows from an older method and compute live instead.
--   * agent_run_id: the Hamilton run that wrote the row.
--
-- Additive and idempotent. The table already exists in production; the CREATE is a
-- baseline for fresh databases. Existing rows default to method 1, so they are ignored
-- until the first refresh replaces them.

BEGIN;

CREATE TABLE IF NOT EXISTS public.fee_index_cache (
  fee_category       TEXT PRIMARY KEY,
  fee_family         TEXT,
  median_amount      DOUBLE PRECISION,
  p25_amount         DOUBLE PRECISION,
  p75_amount         DOUBLE PRECISION,
  min_amount         DOUBLE PRECISION,
  max_amount         DOUBLE PRECISION,
  institution_count  INTEGER NOT NULL,
  observation_count  INTEGER NOT NULL,
  approved_count     INTEGER NOT NULL,
  bank_count         INTEGER NOT NULL,
  cu_count           INTEGER NOT NULL,
  maturity_tier      TEXT NOT NULL,
  computed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.fee_index_cache
  ADD COLUMN IF NOT EXISTS stats_method_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS agent_run_id         BIGINT;

ALTER TABLE public.fee_index_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fee_index_cache FROM PUBLIC, anon, authenticated;

COMMIT;
