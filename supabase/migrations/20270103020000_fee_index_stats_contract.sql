-- Statistics contract (Phase 1d): fee_index_cache records how each national index
-- row was computed, and gets a real writer (Hamilton refreshes it after publishing).
--
--   * stats_method_version: rows from an older method are ignored by readers.
--   * basis / sourced_institution_count / legacy_institution_count: whether a
--     category's numbers come only from institutions traced to a stored source
--     document ("sourced") or still include the earlier import ("blended").
--   * agent_run_id: the Hamilton run that wrote the row.
--
-- Additive and idempotent. The table already exists in production; the CREATE is a
-- baseline for fresh databases.

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
  ADD COLUMN IF NOT EXISTS sourced_institution_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS legacy_institution_count  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS basis                     TEXT NOT NULL DEFAULT 'blended',
  ADD COLUMN IF NOT EXISTS stats_method_version      INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS agent_run_id              BIGINT;

ALTER TABLE public.fee_index_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fee_index_cache FROM PUBLIC, anon, authenticated;

COMMIT;
