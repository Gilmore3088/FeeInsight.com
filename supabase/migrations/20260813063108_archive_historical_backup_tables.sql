-- Changes the legacy tables (crawl_targets and friends) production had before
-- 2026-08-13. A database built from the preview baseline in 20260406_report_jobs.sql
-- already has the current schema and no legacy tables, so it skips this file.
DO $legacy_guard$
BEGIN
  IF to_regclass('public.crawl_targets') IS NULL AND to_regclass('public.institution_sources') IS NOT NULL THEN
    RETURN;
  END IF;
  EXECUTE $migration$
-- Move historical backup tables out of the active public schema.
--
-- These tables are retained for audit/history, but are not active agentic
-- read/write contracts and should not appear as public runtime data models.

SET lock_timeout = '10s';
SET statement_timeout = '120s';

CREATE SCHEMA IF NOT EXISTS archive;

REVOKE ALL ON SCHEMA archive FROM PUBLIC, anon, authenticated;

ALTER TABLE public.extracted_fees_dedup_backup_20260418
  SET SCHEMA archive;
ALTER TABLE archive.extracted_fees_dedup_backup_20260418
  RENAME TO historical_fee_observation_dedup_backup_20260418;
ALTER TABLE archive.historical_fee_observation_dedup_backup_20260418
  RENAME COLUMN crawl_result_id TO source_document_id;
ALTER TABLE archive.historical_fee_observation_dedup_backup_20260418
  RENAME COLUMN crawl_target_id TO institution_id;

ALTER TABLE archive.historical_fee_observation_dedup_backup_20260418
  RENAME CONSTRAINT extracted_fees_dedup_backup_20260418_pkey
  TO historical_fee_observation_dedup_backup_20260418_pkey;

ALTER INDEX IF EXISTS archive.extracted_fees_dedup_backup_20260418_canonical_fee_key_idx
  RENAME TO historical_fee_observation_dedup_backup_canonical_idx;
ALTER INDEX IF EXISTS archive.extracted_fees_dedup_backup_20260418_crawl_result_id_idx
  RENAME TO historical_fee_observation_dedup_backup_source_doc_idx;
ALTER INDEX IF EXISTS archive.extracted_fees_dedup_backup_20260418_review_status_idx
  RENAME TO historical_fee_observation_dedup_backup_review_idx;
ALTER INDEX IF EXISTS archive.extracted_fees_dedup_backup_202604_review_status_created_at_idx
  RENAME TO historical_fee_observation_dedup_backup_queue_idx;
ALTER INDEX IF EXISTS archive.extracted_fees_dedup_backup_2026_fee_category_review_status_idx
  RENAME TO historical_fee_observation_dedup_backup_category_review_idx;
ALTER INDEX IF EXISTS archive.extracted_fees_dedup_backup_2_crawl_target_id_review_statu_idx1
  RENAME TO historical_fee_observation_dedup_backup_inst_review_cat_amt_idx;
ALTER INDEX IF EXISTS archive.extracted_fees_dedup_backup_2_crawl_target_id_review_status_idx
  RENAME TO historical_fee_observation_dedup_backup_inst_review_idx;
ALTER INDEX IF EXISTS archive.extracted_fees_dedup_backup_2_fee_category_amount_crawl_tar_idx
  RENAME TO historical_fee_observation_dedup_backup_category_amount_idx;

ALTER TABLE public.extracted_fees_promote_backup_20260418
  SET SCHEMA archive;
ALTER TABLE archive.extracted_fees_promote_backup_20260418
  RENAME TO historical_fee_observation_promote_backup_20260418;
ALTER TABLE archive.historical_fee_observation_promote_backup_20260418
  RENAME COLUMN crawl_result_id TO source_document_id;
ALTER TABLE archive.historical_fee_observation_promote_backup_20260418
  RENAME COLUMN crawl_target_id TO institution_id;

ALTER TABLE public.fee_reviews_dedup_backup_20260418
  SET SCHEMA archive;
ALTER TABLE archive.fee_reviews_dedup_backup_20260418
  RENAME TO historical_fee_review_dedup_backup_20260418;
ALTER TABLE archive.historical_fee_review_dedup_backup_20260418
  RENAME CONSTRAINT fee_reviews_dedup_backup_20260418_pkey
  TO historical_fee_review_dedup_backup_20260418_pkey;
ALTER INDEX IF EXISTS archive.fee_reviews_dedup_backup_20260418_created_at_idx
  RENAME TO historical_fee_review_dedup_backup_created_at_idx;

ALTER TABLE public.pipeline_runs_legacy_20260603
  SET SCHEMA archive;
ALTER TABLE archive.pipeline_runs_legacy_20260603
  RENAME TO historical_pipeline_runs_20260603;
ALTER TABLE archive.historical_pipeline_runs_20260603
  RENAME CONSTRAINT pipeline_runs_pkey TO historical_pipeline_runs_20260603_pkey;

ALTER TABLE archive.historical_fee_observation_dedup_backup_20260418 ENABLE ROW LEVEL SECURITY;
ALTER TABLE archive.historical_fee_observation_promote_backup_20260418 ENABLE ROW LEVEL SECURITY;
ALTER TABLE archive.historical_fee_review_dedup_backup_20260418 ENABLE ROW LEVEL SECURITY;
ALTER TABLE archive.historical_pipeline_runs_20260603 ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON archive.historical_fee_observation_dedup_backup_20260418 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON archive.historical_fee_observation_promote_backup_20260418 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON archive.historical_fee_review_dedup_backup_20260418 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON archive.historical_pipeline_runs_20260603 FROM PUBLIC, anon, authenticated;

COMMENT ON SCHEMA archive IS
  'Non-runtime historical data retained for audit/backfill only.';
COMMENT ON TABLE archive.historical_fee_observation_dedup_backup_20260418 IS
  'Historical fee-observation dedup backup retained outside public runtime schema.';
COMMENT ON TABLE archive.historical_fee_observation_promote_backup_20260418 IS
  'Historical fee-observation promotion backup retained outside public runtime schema.';
COMMENT ON TABLE archive.historical_fee_review_dedup_backup_20260418 IS
  'Historical fee-review dedup backup retained outside public runtime schema.';
COMMENT ON TABLE archive.historical_pipeline_runs_20260603 IS
  'Historical legacy pipeline-run backup retained outside public runtime schema.';

$migration$;
END
$legacy_guard$;
