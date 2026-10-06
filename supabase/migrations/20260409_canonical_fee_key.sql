-- Changes the legacy tables (crawl_targets and friends) production had before
-- 2026-08-13. A database built from the preview baseline in 20260406_report_jobs.sql
-- already has the current schema and no legacy tables, so it skips this file.
DO $legacy_guard$
BEGIN
  IF to_regclass('public.crawl_targets') IS NULL AND to_regclass('public.institution_sources') IS NOT NULL THEN
    RETURN;
  END IF;
  EXECUTE $migration$
-- Migration: Add canonical_fee_key and variant_type columns to extracted_fees
-- Phase 55: Canonical Taxonomy Foundation
--
-- Expand-and-contract pattern: add nullable columns, keep fee_category as the
-- active query column until backfill is verified. The flip (switching queries
-- to use canonical_fee_key) is the final step of Phase 55.
--
-- Idempotent: uses IF NOT EXISTS for both ALTER TABLE and CREATE INDEX.
-- Postgres 15 (Supabase) supports ADD COLUMN IF NOT EXISTS.
-- Index creation uses IF NOT EXISTS (not CONCURRENTLY) since extracted_fees
-- is ~15K rows; sub-second index build, no need for concurrent mode inside
-- a transaction block.

ALTER TABLE extracted_fees ADD COLUMN IF NOT EXISTS canonical_fee_key TEXT;
ALTER TABLE extracted_fees ADD COLUMN IF NOT EXISTS variant_type TEXT;

-- Index for future queries filtering or grouping by canonical_fee_key.
-- Partial index (WHERE NOT NULL) keeps it lean during the backfill window.
CREATE INDEX IF NOT EXISTS idx_fees_canonical_key
  ON extracted_fees(canonical_fee_key)
  WHERE canonical_fee_key IS NOT NULL;

COMMENT ON COLUMN extracted_fees.canonical_fee_key IS
  'Stable aggregation key from CANONICAL_KEY_MAP. NULL = unmatched long-tail fee.';

COMMENT ON COLUMN extracted_fees.variant_type IS
  'Fee variant: standard, rush, express, waived, daily_cap, per_item. NULL = standard.';

$migration$;
END
$legacy_guard$;
