-- Changes the legacy tables (crawl_targets and friends) production had before
-- 2026-08-13. A database built from the preview baseline in 20260406_report_jobs.sql
-- already has the current schema and no legacy tables, so it skips this file.
DO $legacy_guard$
BEGIN
  IF to_regclass('public.crawl_targets') IS NULL AND to_regclass('public.institution_sources') IS NOT NULL THEN
    RETURN;
  END IF;
  EXECUTE $migration$
-- Tighten semantic agentic views so current contracts no longer expose
-- crawler-era alias columns. Preserve historical extracted fee data under an
-- explicit archive name instead of keeping it as an active table.

DROP VIEW IF EXISTS public.published_fee_catalog;
DROP VIEW IF EXISTS public.published_fee_observations;

DROP VIEW IF EXISTS public.agent_source_texts;
DROP VIEW IF EXISTS public.source_documents;
DROP VIEW IF EXISTS public.raw_fee_observations;
DROP VIEW IF EXISTS public.verified_fee_observations;
DROP VIEW IF EXISTS public.published_fee_records;

CREATE VIEW public.source_documents
WITH (security_invoker = true)
AS
SELECT
  id,
  crawl_run_id AS source_collection_run_id,
  crawl_target_id AS institution_id,
  status,
  document_url,
  document_path,
  content_hash,
  fees_extracted,
  error_message,
  crawled_at,
  status_code
FROM public.crawl_results;

CREATE VIEW public.agent_source_texts
WITH (security_invoker = true)
AS
SELECT
  id,
  agent_run_id,
  crawl_result_id AS source_document_id,
  crawl_target_id AS institution_id,
  source_url,
  document_type,
  content_type,
  source_hash,
  status,
  normalized_text,
  text_hash,
  char_count,
  error_message,
  created_at,
  updated_at
FROM public.agent_document_texts;

CREATE VIEW public.raw_fee_observations
WITH (security_invoker = true)
AS
SELECT
  fee_raw_id,
  created_at,
  institution_id,
  crawl_event_id AS source_document_id,
  document_r2_key,
  source_url,
  extraction_confidence,
  agent_event_id,
  fee_name,
  amount,
  frequency,
  conditions,
  outlier_flags,
  source
FROM public.fees_raw;

CREATE VIEW public.verified_fee_observations
WITH (security_invoker = true)
AS
SELECT
  fee_verified_id,
  created_at,
  fee_raw_id,
  institution_id,
  source_url,
  document_r2_key,
  extraction_confidence,
  canonical_fee_key,
  variant_type,
  outlier_flags,
  verified_by_agent_event_id,
  fee_name,
  amount,
  frequency,
  review_status,
  validation_flags,
  fee_category
FROM public.fees_verified;

CREATE VIEW public.published_fee_records
WITH (security_invoker = true)
AS
SELECT
  fee_published_id,
  published_at,
  lineage_ref,
  institution_id,
  canonical_fee_key,
  source_url,
  document_r2_key,
  extraction_confidence,
  agent_event_id,
  verified_by_agent_event_id,
  published_by_adversarial_event_id,
  fee_name,
  amount,
  frequency,
  variant_type,
  coverage_tier,
  batch_id,
  rolled_back_at,
  rolled_back_by_batch_id,
  rolled_back_reason
FROM public.fees_published;

CREATE VIEW public.published_fee_catalog
WITH (security_invoker = true)
AS
SELECT
  fp.fee_published_id AS id,
  fp.fee_published_id,
  fp.lineage_ref AS fee_verified_id,
  fv.fee_raw_id,
  fp.institution_id,
  fp.fee_name,
  fp.amount,
  fp.frequency,
  fr.conditions,
  COALESCE(fp.extraction_confidence, fv.extraction_confidence, fr.extraction_confidence) AS extraction_confidence,
  'approved'::text AS review_status,
  COALESCE(fv.outlier_flags, '[]'::jsonb) AS validation_flags,
  fp.canonical_fee_key AS fee_category,
  fp.canonical_fee_key,
  NULL::text AS fee_family,
  NULL::text AS account_product_type,
  false AS is_fee_cap,
  fp.variant_type,
  fp.coverage_tier,
  COALESCE(fp.source_url, fv.source_url, fr.source_url) AS source_url,
  fr.source,
  COALESCE(fp.source_url, fv.source_url, fr.source_url) AS document_url,
  COALESCE(fp.document_r2_key, fv.document_r2_key, fr.document_r2_key) AS document_r2_key,
  fr.source_document_id,
  COALESCE(fp.agent_event_id, fr.agent_event_id) AS agent_event_id,
  COALESCE(fp.verified_by_agent_event_id, fv.verified_by_agent_event_id) AS verified_by_agent_event_id,
  fp.published_by_adversarial_event_id,
  fp.batch_id,
  fp.published_at AS created_at,
  fp.published_at AS updated_at
FROM public.published_fee_records fp
LEFT JOIN public.verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
LEFT JOIN public.raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
WHERE fp.rolled_back_at IS NULL;

REVOKE ALL ON public.source_documents FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.agent_source_texts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.raw_fee_observations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.verified_fee_observations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.published_fee_records FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.published_fee_catalog FROM PUBLIC, anon, authenticated;

COMMENT ON VIEW public.source_documents IS
  'Semantic source-document boundary over collected institution source documents.';
COMMENT ON COLUMN public.source_documents.source_collection_run_id IS
  'Semantic collection-run identifier for the run that produced this source document.';
COMMENT ON COLUMN public.source_documents.institution_id IS
  'Semantic institution/source identifier.';

COMMENT ON VIEW public.agent_source_texts IS
  'Semantic Rosetta text artifact boundary over fetched source documents.';
COMMENT ON COLUMN public.agent_source_texts.source_document_id IS
  'Semantic source document identifier for the fetched document read by Rosetta.';
COMMENT ON COLUMN public.agent_source_texts.institution_id IS
  'Semantic institution/source identifier.';

COMMENT ON VIEW public.raw_fee_observations IS
  'Semantic Knox raw fee observation boundary.';
COMMENT ON COLUMN public.raw_fee_observations.source_document_id IS
  'Semantic source document identifier that produced this raw fee observation.';

COMMENT ON VIEW public.verified_fee_observations IS
  'Semantic Darwin verified fee observation boundary.';
COMMENT ON VIEW public.published_fee_records IS
  'Semantic Hamilton published fee record boundary.';
COMMENT ON VIEW public.published_fee_catalog IS
  'Semantic product/admin/research catalog for Hamilton-published fee records.';

DROP TABLE IF EXISTS public.community_submissions;
DROP TABLE IF EXISTS public.discovery_cache;
DROP TABLE IF EXISTS public.gold_standard_fees;

DO $$
BEGIN
  IF to_regclass('public.extracted_fees') IS NOT NULL
     AND to_regclass('public.historical_fee_observation_archive') IS NULL THEN
    DROP TRIGGER IF EXISTS extracted_fees_freeze ON public.extracted_fees;
    ALTER TABLE public.extracted_fees RENAME TO historical_fee_observation_archive;

    ALTER TABLE public.historical_fee_observation_archive
      RENAME COLUMN crawl_result_id TO source_document_id;
    ALTER TABLE public.historical_fee_observation_archive
      RENAME COLUMN crawl_target_id TO institution_id;

    ALTER TABLE public.historical_fee_observation_archive
      RENAME CONSTRAINT extracted_fees_pkey TO historical_fee_observation_archive_pkey;
    ALTER TABLE public.historical_fee_observation_archive
      RENAME CONSTRAINT extracted_fees_crawl_result_id_fkey TO historical_fee_observation_archive_source_document_id_fkey;
    ALTER TABLE public.historical_fee_observation_archive
      RENAME CONSTRAINT extracted_fees_crawl_target_id_fkey TO historical_fee_observation_archive_institution_id_fkey;

    ALTER SEQUENCE IF EXISTS public.extracted_fees_id_seq
      RENAME TO historical_fee_observation_archive_id_seq;
    ALTER INDEX IF EXISTS public.idx_extracted_fees_cat_amt
      RENAME TO historical_fee_observation_archive_cat_amt_idx;
    ALTER INDEX IF EXISTS public.idx_extracted_fees_category
      RENAME TO historical_fee_observation_archive_category_idx;
    ALTER INDEX IF EXISTS public.idx_extracted_fees_crawl_result
      RENAME TO historical_fee_observation_archive_source_document_idx;
    ALTER INDEX IF EXISTS public.idx_extracted_fees_review
      RENAME TO historical_fee_observation_archive_review_idx;
    ALTER INDEX IF EXISTS public.idx_extracted_fees_review_queue
      RENAME TO historical_fee_observation_archive_review_queue_idx;
    ALTER INDEX IF EXISTS public.idx_extracted_fees_target
      RENAME TO historical_fee_observation_archive_institution_review_idx;
    ALTER INDEX IF EXISTS public.idx_extracted_fees_target_status
      RENAME TO historical_fee_observation_archive_institution_status_idx;
    ALTER INDEX IF EXISTS public.idx_fees_canonical_key
      RENAME TO historical_fee_observation_archive_canonical_key_idx;
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public._block_extracted_fees_writes();

COMMENT ON TABLE public.historical_fee_observation_archive IS
  'Historical pre-agentic fee observation archive retained for audit/backfill only. Not an active read or write contract.';

$migration$;
END
$legacy_guard$;
