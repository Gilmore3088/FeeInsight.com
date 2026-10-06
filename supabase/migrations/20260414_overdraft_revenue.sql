-- Changes the legacy tables (crawl_targets and friends) production had before
-- 2026-08-13. A database built from the preview baseline in 20260406_report_jobs.sql
-- already has the current schema and no legacy tables, so it skips this file.
DO $legacy_guard$
BEGIN
  IF to_regclass('public.crawl_targets') IS NULL AND to_regclass('public.institution_sources') IS NOT NULL THEN
    RETURN;
  END IF;
  EXECUTE $migration$
-- Add overdraft_revenue column (RIADH032 from FFIEC CDR Schedule RI-E)
-- Consumer overdraft/NSF service charges. Reported by banks with $1B+ assets.
-- Values stored in thousands (matching other Call Report monetary fields).
ALTER TABLE institution_financials
  ADD COLUMN IF NOT EXISTS overdraft_revenue BIGINT;

COMMENT ON COLUMN institution_financials.overdraft_revenue IS 'Consumer overdraft/NSF service charges (RIADH032, Schedule RI-E). In thousands. NULL for banks <$1B that do not report this field.';

$migration$;
END
$legacy_guard$;
