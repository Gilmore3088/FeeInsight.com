-- Changes the legacy tables (crawl_targets and friends) production had before
-- 2026-08-13. A database built from the preview baseline in 20260406_report_jobs.sql
-- already has the current schema and no legacy tables, so it skips this file.
DO $legacy_guard$
BEGIN
  IF to_regclass('public.crawl_targets') IS NULL AND to_regclass('public.institution_sources') IS NOT NULL THEN
    RETURN;
  END IF;
  EXECUTE $migration$
-- Add semantic fee-tier boundaries for the active Knox -> Darwin -> Hamilton
-- agent pipeline while physical storage columns are phased out.

CREATE OR REPLACE VIEW public.raw_fee_observations
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
  source,
  crawl_event_id
FROM public.fees_raw;

REVOKE ALL ON public.raw_fee_observations FROM anon, authenticated;

COMMENT ON VIEW public.raw_fee_observations IS
  'Agentic semantic boundary for Knox raw fee observations while fees_raw physical storage is phased out.';
COMMENT ON COLUMN public.raw_fee_observations.source_document_id IS
  'Semantic alias for the source document that produced this raw fee observation.';

CREATE OR REPLACE VIEW public.verified_fee_observations
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
  id,
  crawl_target_id,
  validation_flags,
  fee_category
FROM public.fees_verified;

REVOKE ALL ON public.verified_fee_observations FROM anon, authenticated;

COMMENT ON VIEW public.verified_fee_observations IS
  'Agentic semantic boundary for Darwin verified fee observations while fees_verified physical storage is phased out.';

CREATE OR REPLACE VIEW public.published_fee_records
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

REVOKE ALL ON public.published_fee_records FROM anon, authenticated;

COMMENT ON VIEW public.published_fee_records IS
  'Agentic semantic boundary for Hamilton published fee records while fees_published physical storage is phased out.';

$migration$;
END
$legacy_guard$;
