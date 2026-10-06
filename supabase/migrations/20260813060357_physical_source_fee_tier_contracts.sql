-- Changes the legacy tables (crawl_targets and friends) production had before
-- 2026-08-13. A database built from the preview baseline in 20260406_report_jobs.sql
-- already has the current schema and no legacy tables, so it skips this file.
DO $legacy_guard$
BEGIN
  IF to_regclass('public.crawl_targets') IS NULL AND to_regclass('public.institution_sources') IS NOT NULL THEN
    RETURN;
  END IF;
  EXECUTE $migration$
-- Convert the active source/document/fee-tier semantic contracts from
-- compatibility views over crawler-era tables into the physical storage
-- tables themselves.
--
-- App code already reads and writes these semantic names. This migration
-- removes the old physical relation names underneath that contract.

SET lock_timeout = '10s';
SET statement_timeout = '120s';

DROP VIEW IF EXISTS public.published_fee_catalog;
DROP VIEW IF EXISTS public.published_fee_records;
DROP VIEW IF EXISTS public.verified_fee_observations;
DROP VIEW IF EXISTS public.raw_fee_observations;
DROP VIEW IF EXISTS public.agent_source_texts;
DROP VIEW IF EXISTS public.source_documents;
DROP VIEW IF EXISTS public.source_collection_runs;
DROP VIEW IF EXISTS public.institution_sources;

ALTER TABLE public.crawl_targets RENAME TO institution_sources;
ALTER TABLE public.crawl_runs RENAME TO source_collection_runs;
ALTER TABLE public.crawl_results RENAME TO source_documents;
ALTER TABLE public.agent_document_texts RENAME TO agent_source_texts;
ALTER TABLE public.fees_raw RENAME TO raw_fee_observations;
ALTER TABLE public.fees_verified RENAME TO verified_fee_observations;
ALTER TABLE public.fees_published RENAME TO published_fee_records;
ALTER TABLE public.fees_published_rollback_log RENAME TO published_fee_record_rollback_log;

ALTER TABLE public.source_documents
  RENAME COLUMN crawl_run_id TO source_collection_run_id;
ALTER TABLE public.source_documents
  RENAME COLUMN crawl_target_id TO institution_id;

ALTER TABLE public.agent_source_texts
  RENAME COLUMN crawl_result_id TO source_document_id;
ALTER TABLE public.agent_source_texts
  RENAME COLUMN crawl_target_id TO institution_id;

ALTER TABLE public.raw_fee_observations
  RENAME COLUMN crawl_event_id TO source_document_id;

ALTER TABLE public.verified_fee_observations
  DROP COLUMN IF EXISTS id,
  DROP COLUMN IF EXISTS crawl_target_id;

ALTER TABLE public.institution_sources
  RENAME CONSTRAINT crawl_targets_pkey TO institution_sources_pkey;
ALTER TABLE public.institution_sources
  RENAME CONSTRAINT crawl_targets_rescue_status_check TO institution_sources_rescue_status_check;
ALTER TABLE public.institution_sources
  RENAME CONSTRAINT crawl_targets_source_cert_number_key TO institution_sources_source_cert_number_key;

ALTER TABLE public.source_collection_runs
  RENAME CONSTRAINT crawl_runs_pkey TO source_collection_runs_pkey;

ALTER TABLE public.source_documents
  RENAME CONSTRAINT crawl_results_pkey TO source_documents_pkey;
ALTER TABLE public.source_documents
  RENAME CONSTRAINT crawl_results_crawl_run_id_fkey TO source_documents_source_collection_run_id_fkey;
ALTER TABLE public.source_documents
  RENAME CONSTRAINT crawl_results_crawl_target_id_fkey TO source_documents_institution_id_fkey;

ALTER TABLE public.agent_source_texts
  RENAME CONSTRAINT agent_document_texts_pkey TO agent_source_texts_pkey;
ALTER TABLE public.agent_source_texts
  RENAME CONSTRAINT agent_document_texts_agent_run_id_fkey TO agent_source_texts_agent_run_id_fkey;
ALTER TABLE public.agent_source_texts
  RENAME CONSTRAINT agent_document_texts_crawl_result_id_fkey TO agent_source_texts_source_document_id_fkey;
ALTER TABLE public.agent_source_texts
  RENAME CONSTRAINT agent_document_texts_crawl_result_id_key TO agent_source_texts_source_document_id_key;
ALTER TABLE public.agent_source_texts
  RENAME CONSTRAINT agent_document_texts_crawl_target_id_fkey TO agent_source_texts_institution_id_fkey;
ALTER TABLE public.agent_source_texts
  RENAME CONSTRAINT agent_document_texts_status_check TO agent_source_texts_status_check;

ALTER TABLE public.raw_fee_observations
  RENAME CONSTRAINT fees_raw_pkey TO raw_fee_observations_pkey;
ALTER TABLE public.raw_fee_observations
  RENAME CONSTRAINT fees_raw_source_check TO raw_fee_observations_source_check;

ALTER TABLE public.verified_fee_observations
  RENAME CONSTRAINT fees_verified_pkey TO verified_fee_observations_pkey;
ALTER TABLE public.verified_fee_observations
  RENAME CONSTRAINT fees_verified_fee_raw_id_fkey TO verified_fee_observations_fee_raw_id_fkey;
ALTER TABLE public.verified_fee_observations
  RENAME CONSTRAINT fees_verified_review_status_check TO verified_fee_observations_review_status_check;

ALTER TABLE public.published_fee_records
  RENAME CONSTRAINT fees_published_pkey TO published_fee_records_pkey;
ALTER TABLE public.published_fee_records
  RENAME CONSTRAINT fees_published_coverage_tier_check TO published_fee_records_coverage_tier_check;
ALTER TABLE public.published_fee_records
  RENAME CONSTRAINT fees_published_lineage_ref_fkey TO published_fee_records_lineage_ref_fkey;

ALTER TABLE public.published_fee_record_rollback_log
  RENAME CONSTRAINT fees_published_rollback_log_pkey TO published_fee_record_rollback_log_pkey;
ALTER TABLE public.published_fee_record_rollback_log
  RENAME CONSTRAINT fees_published_rollback_log_rollback_token_key TO published_fee_record_rollback_log_rollback_token_key;

ALTER SEQUENCE IF EXISTS public.crawl_targets_id_seq RENAME TO institution_sources_id_seq;
ALTER SEQUENCE IF EXISTS public.crawl_runs_id_seq RENAME TO source_collection_runs_id_seq;
ALTER SEQUENCE IF EXISTS public.crawl_results_id_seq RENAME TO source_documents_id_seq;
ALTER SEQUENCE IF EXISTS public.agent_document_texts_id_seq RENAME TO agent_source_texts_id_seq;
ALTER SEQUENCE IF EXISTS public.fees_raw_fee_raw_id_seq RENAME TO raw_fee_observations_fee_raw_id_seq;
ALTER SEQUENCE IF EXISTS public.fees_verified_fee_verified_id_seq RENAME TO verified_fee_observations_fee_verified_id_seq;
ALTER SEQUENCE IF EXISTS public.fees_published_fee_published_id_seq RENAME TO published_fee_records_fee_published_id_seq;
ALTER SEQUENCE IF EXISTS public.fees_published_rollback_log_rollback_id_seq
  RENAME TO published_fee_record_rollback_log_rollback_id_seq;

ALTER SEQUENCE IF EXISTS public.institution_sources_id_seq OWNED BY public.institution_sources.id;
ALTER SEQUENCE IF EXISTS public.source_collection_runs_id_seq OWNED BY public.source_collection_runs.id;
ALTER SEQUENCE IF EXISTS public.source_documents_id_seq OWNED BY public.source_documents.id;
ALTER SEQUENCE IF EXISTS public.agent_source_texts_id_seq OWNED BY public.agent_source_texts.id;
ALTER SEQUENCE IF EXISTS public.raw_fee_observations_fee_raw_id_seq OWNED BY public.raw_fee_observations.fee_raw_id;
ALTER SEQUENCE IF EXISTS public.verified_fee_observations_fee_verified_id_seq OWNED BY public.verified_fee_observations.fee_verified_id;
ALTER SEQUENCE IF EXISTS public.published_fee_records_fee_published_id_seq OWNED BY public.published_fee_records.fee_published_id;
ALTER SEQUENCE IF EXISTS public.published_fee_record_rollback_log_rollback_id_seq
  OWNED BY public.published_fee_record_rollback_log.rollback_id;

ALTER INDEX IF EXISTS public.crawl_targets_rescue_pending_idx RENAME TO institution_sources_rescue_pending_idx;
ALTER INDEX IF EXISTS public.idx_crawl_targets_charter_tier RENAME TO institution_sources_charter_tier_idx;
ALTER INDEX IF EXISTS public.idx_crawl_targets_failure RENAME TO institution_sources_failure_idx;
ALTER INDEX IF EXISTS public.idx_crawl_targets_fee_url RENAME TO institution_sources_fee_url_idx;
ALTER INDEX IF EXISTS public.idx_crawl_targets_lei RENAME TO institution_sources_lei_idx;
ALTER INDEX IF EXISTS public.idx_crawl_targets_ncua RENAME TO institution_sources_ncua_idx;
ALTER INDEX IF EXISTS public.idx_crawl_targets_platform RENAME TO institution_sources_platform_idx;
ALTER INDEX IF EXISTS public.idx_crawl_targets_routing RENAME TO institution_sources_routing_idx;
ALTER INDEX IF EXISTS public.idx_crawl_targets_rssd RENAME TO institution_sources_rssd_idx;
ALTER INDEX IF EXISTS public.idx_crawl_targets_state_tier RENAME TO institution_sources_state_tier_idx;
ALTER INDEX IF EXISTS public.idx_crawl_targets_with_fees RENAME TO institution_sources_with_fee_url_idx;

ALTER INDEX IF EXISTS public.idx_crawl_results_date RENAME TO source_documents_crawled_at_idx;
ALTER INDEX IF EXISTS public.idx_crawl_results_target RENAME TO source_documents_institution_crawled_at_idx;

ALTER INDEX IF EXISTS public.agent_document_texts_run_idx RENAME TO agent_source_texts_run_idx;
ALTER INDEX IF EXISTS public.agent_document_texts_status_idx RENAME TO agent_source_texts_status_idx;
ALTER INDEX IF EXISTS public.agent_document_texts_target_idx RENAME TO agent_source_texts_institution_updated_idx;

ALTER INDEX IF EXISTS public.fees_raw_agent_event_idx RENAME TO raw_fee_observations_agent_event_idx;
ALTER INDEX IF EXISTS public.fees_raw_backfill_dedup_idx RENAME TO raw_fee_observations_backfill_dedup_idx;
ALTER INDEX IF EXISTS public.fees_raw_institution_time_idx RENAME TO raw_fee_observations_institution_time_idx;
ALTER INDEX IF EXISTS public.fees_raw_knox_agentic_dedup_idx RENAME TO raw_fee_observations_knox_agentic_dedup_idx;
ALTER INDEX IF EXISTS public.fees_raw_lineage_missing_idx RENAME TO raw_fee_observations_lineage_missing_idx;
ALTER INDEX IF EXISTS public.fees_raw_source_idx RENAME TO raw_fee_observations_source_idx;

ALTER INDEX IF EXISTS public.fees_verified_canonical_institution_idx RENAME TO verified_fee_observations_canonical_institution_idx;
ALTER INDEX IF EXISTS public.fees_verified_darwin_agentic_dedup_idx RENAME TO verified_fee_observations_darwin_agentic_dedup_idx;
ALTER INDEX IF EXISTS public.fees_verified_institution_active_idx RENAME TO verified_fee_observations_institution_active_idx;
ALTER INDEX IF EXISTS public.fees_verified_raw_idx RENAME TO verified_fee_observations_raw_idx;
ALTER INDEX IF EXISTS public.fees_verified_status_idx RENAME TO verified_fee_observations_status_idx;

ALTER INDEX IF EXISTS public.fees_published_agentic_live_lineage_dedup_idx RENAME TO published_fee_records_agentic_live_lineage_dedup_idx;
ALTER INDEX IF EXISTS public.fees_published_batch_idx RENAME TO published_fee_records_batch_idx;
ALTER INDEX IF EXISTS public.fees_published_canonical_institution_idx RENAME TO published_fee_records_canonical_institution_idx;
ALTER INDEX IF EXISTS public.fees_published_institution_time_idx RENAME TO published_fee_records_institution_time_idx;
ALTER INDEX IF EXISTS public.fees_published_lineage_idx RENAME TO published_fee_records_lineage_idx;
ALTER INDEX IF EXISTS public.fees_published_live_idx RENAME TO published_fee_records_live_idx;

ALTER INDEX IF EXISTS public.fees_published_rollback_log_batch_idx RENAME TO published_fee_record_rollback_log_batch_idx;

ALTER TABLE public.institution_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_collection_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_source_texts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_fee_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verified_fee_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.published_fee_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.published_fee_record_rollback_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.institution_sources FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.source_collection_runs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.source_documents FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.agent_source_texts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.raw_fee_observations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.verified_fee_observations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.published_fee_records FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.published_fee_record_rollback_log FROM PUBLIC, anon, authenticated;

REVOKE ALL ON SEQUENCE public.institution_sources_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.source_collection_runs_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.source_documents_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.agent_source_texts_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.raw_fee_observations_fee_raw_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.verified_fee_observations_fee_verified_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.published_fee_records_fee_published_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.published_fee_record_rollback_log_rollback_id_seq FROM PUBLIC, anon, authenticated;

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

REVOKE ALL ON public.published_fee_catalog FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.promote_to_tier2(
  p_fee_raw_id bigint,
  p_agent_name text,
  p_reasoning_hash bytea,
  p_verified_by_agent_event_id uuid,
  p_canonical_fee_key text,
  p_variant_type text DEFAULT NULL::text,
  p_outlier_flags jsonb DEFAULT '[]'::jsonb
) RETURNS bigint
LANGUAGE plpgsql
AS $function$
DECLARE
  v_raw public.raw_fee_observations%ROWTYPE;
  v_verified_id bigint;
BEGIN
  IF p_agent_name IS DISTINCT FROM 'darwin' THEN
    RAISE EXCEPTION 'promote_to_tier2: only darwin may promote (got %)', p_agent_name
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_canonical_fee_key IS NULL OR length(p_canonical_fee_key) = 0 THEN
    RAISE EXCEPTION 'promote_to_tier2: canonical_fee_key required at Tier 2';
  END IF;

  SELECT * INTO v_raw
  FROM public.raw_fee_observations
  WHERE fee_raw_id = p_fee_raw_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'promote_to_tier2: raw_fee_observations.fee_raw_id=% not found', p_fee_raw_id;
  END IF;

  INSERT INTO public.verified_fee_observations (
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
    review_status
  )
  VALUES (
    v_raw.fee_raw_id,
    v_raw.institution_id,
    v_raw.source_url,
    v_raw.document_r2_key,
    v_raw.extraction_confidence,
    p_canonical_fee_key,
    p_variant_type,
    p_outlier_flags,
    p_verified_by_agent_event_id,
    v_raw.fee_name,
    v_raw.amount,
    v_raw.frequency,
    'verified'
  )
  RETURNING fee_verified_id INTO v_verified_id;

  INSERT INTO public.agent_events (
    agent_name,
    action,
    tool_name,
    entity,
    entity_id,
    status,
    parent_event_id,
    reasoning_hash,
    input_payload,
    output_payload
  )
  VALUES (
    p_agent_name,
    'promote_to_tier2',
    'promote_to_tier2',
    'verified_fee_observations',
    v_verified_id::text,
    'success',
    p_verified_by_agent_event_id,
    p_reasoning_hash,
    jsonb_build_object('fee_raw_id', p_fee_raw_id, 'canonical_fee_key', p_canonical_fee_key),
    jsonb_build_object('fee_verified_id', v_verified_id)
  );

  RETURN v_verified_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.promote_to_tier3(
  p_fee_verified_id bigint,
  p_adversarial_event_id uuid,
  p_batch_id text DEFAULT NULL::text
) RETURNS bigint
LANGUAGE plpgsql
AS $function$
DECLARE
  v_verified public.verified_fee_observations%ROWTYPE;
  v_match_corr uuid;
  v_darwin_accept boolean := false;
  v_knox_accept boolean := false;
  v_grandfathered boolean := false;
  v_published_id bigint;
BEGIN
  SELECT * INTO v_verified
  FROM public.verified_fee_observations
  WHERE fee_verified_id = p_fee_verified_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'promote_to_tier3: verified_fee_observations.fee_verified_id=% not found', p_fee_verified_id;
  END IF;

  SELECT d.correlation_id INTO v_match_corr
  FROM public.agent_messages d
  JOIN public.agent_messages k ON k.correlation_id = d.correlation_id
  WHERE d.sender_agent = 'darwin'
    AND d.intent = 'accept'
    AND d.payload->>'fee_verified_id' = p_fee_verified_id::text
    AND d.created_at >= now() - interval '30 days'
    AND k.sender_agent = 'knox'
    AND k.intent = 'accept'
    AND k.payload->>'fee_verified_id' = p_fee_verified_id::text
    AND k.created_at >= now() - interval '30 days'
  LIMIT 1;

  IF v_match_corr IS NOT NULL THEN
    v_darwin_accept := true;
    v_knox_accept := true;
  ELSE
    SELECT EXISTS (
      SELECT 1
      FROM public.agent_messages
      WHERE sender_agent = 'darwin'
        AND intent = 'accept'
        AND payload->>'fee_verified_id' = p_fee_verified_id::text
        AND created_at >= now() - interval '30 days'
    ) INTO v_darwin_accept;

    SELECT EXISTS (
      SELECT 1
      FROM public.agent_messages
      WHERE sender_agent = 'knox'
        AND intent = 'accept'
        AND payload->>'fee_verified_id' = p_fee_verified_id::text
        AND created_at >= now() - interval '30 days'
    ) INTO v_knox_accept;

    IF v_darwin_accept AND v_knox_accept THEN
      v_grandfathered := true;
      RAISE NOTICE 'promote_to_tier3: grandfather accept (no shared correlation_id) for fee_verified_id=%', p_fee_verified_id;
    END IF;
  END IF;

  IF NOT (v_darwin_accept AND v_knox_accept) THEN
    RAISE EXCEPTION 'promote_to_tier3: adversarial handshake incomplete for fee_verified_id=% (darwin_accept=% knox_accept=% within 30d)',
      p_fee_verified_id, v_darwin_accept, v_knox_accept;
  END IF;

  INSERT INTO public.published_fee_records (
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
    batch_id
  )
  VALUES (
    v_verified.fee_verified_id,
    v_verified.institution_id,
    v_verified.canonical_fee_key,
    v_verified.source_url,
    v_verified.document_r2_key,
    v_verified.extraction_confidence,
    NULL,
    v_verified.verified_by_agent_event_id,
    p_adversarial_event_id,
    v_verified.fee_name,
    v_verified.amount,
    v_verified.frequency,
    v_verified.variant_type,
    p_batch_id
  )
  RETURNING fee_published_id INTO v_published_id;

  INSERT INTO public.agent_events (
    agent_name,
    action,
    tool_name,
    entity,
    entity_id,
    status,
    parent_event_id,
    input_payload
  )
  VALUES (
    '_adversarial',
    'promote_to_tier3',
    'promote_to_tier3',
    'published_fee_records',
    v_published_id::text,
    'success',
    p_adversarial_event_id,
    jsonb_build_object(
      'fee_verified_id', p_fee_verified_id,
      'handshake_correlation_id', v_match_corr,
      'grandfathered', v_grandfathered,
      'batch_id', p_batch_id
    )
  );

  RETURN v_published_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.lineage_graph(p_fee_published_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  v_published public.published_fee_records%ROWTYPE;
  v_verified public.verified_fee_observations%ROWTYPE;
  v_raw public.raw_fee_observations%ROWTYPE;
  v_event_chain jsonb;
BEGIN
  SELECT * INTO v_published
  FROM public.published_fee_records
  WHERE fee_published_id = p_fee_published_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'error', 'fee_published_not_found',
      'fee_published_id', p_fee_published_id
    );
  END IF;

  SELECT * INTO v_verified
  FROM public.verified_fee_observations
  WHERE fee_verified_id = v_published.lineage_ref;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'error', 'tier_2_missing',
      'fee_published_id', p_fee_published_id,
      'lineage_ref', v_published.lineage_ref
    );
  END IF;

  SELECT * INTO v_raw
  FROM public.raw_fee_observations
  WHERE fee_raw_id = v_verified.fee_raw_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'error', 'tier_1_missing',
      'fee_published_id', p_fee_published_id,
      'fee_verified_id', v_verified.fee_verified_id,
      'fee_raw_id', v_verified.fee_raw_id
    );
  END IF;

  WITH RECURSIVE chain AS (
    SELECT
      event_id,
      parent_event_id,
      agent_name,
      action,
      tool_name,
      created_at,
      0 AS depth
    FROM public.agent_events
    WHERE event_id = v_raw.agent_event_id

    UNION ALL

    SELECT
      e.event_id,
      e.parent_event_id,
      e.agent_name,
      e.action,
      e.tool_name,
      e.created_at,
      c.depth + 1
    FROM public.agent_events e
    JOIN chain c ON e.event_id = c.parent_event_id
    WHERE c.depth < 10
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'event_id', event_id,
      'agent_name', agent_name,
      'action', action,
      'tool_name', tool_name,
      'created_at', created_at,
      'depth', depth
    )
    ORDER BY depth
  )
  INTO v_event_chain
  FROM chain;

  RETURN jsonb_build_object(
    'tier_3', jsonb_build_object(
      'level', 3,
      'row', to_jsonb(v_published),
      'children', jsonb_build_array(
        jsonb_build_object(
          'tier_2', jsonb_build_object(
            'level', 2,
            'row', to_jsonb(v_verified),
            'children', jsonb_build_array(
              jsonb_build_object(
                'tier_1', jsonb_build_object(
                  'level', 1,
                  'row', to_jsonb(v_raw),
                  'r2_key', v_raw.document_r2_key,
                  'source_url', v_raw.source_url,
                  'event_chain', COALESCE(v_event_chain, '[]'::jsonb)
                )
              )
            )
          )
        )
      )
    )
  );
END;
$function$;

COMMENT ON TABLE public.institution_sources IS
  'Physical institution/source records for agentic collection and product reporting.';
COMMENT ON TABLE public.source_collection_runs IS
  'Physical source collection run ledger for the agentic pipeline.';
COMMENT ON TABLE public.source_documents IS
  'Physical fetched source document records for the agentic pipeline.';
COMMENT ON TABLE public.agent_source_texts IS
  'Physical Rosetta text artifacts extracted from fetched source documents.';
COMMENT ON TABLE public.raw_fee_observations IS
  'Physical Knox Tier 1 raw fee observations.';
COMMENT ON TABLE public.verified_fee_observations IS
  'Physical Darwin Tier 2 verified fee observations.';
COMMENT ON TABLE public.published_fee_records IS
  'Physical Hamilton Tier 3 published fee records.';
COMMENT ON TABLE public.published_fee_record_rollback_log IS
  'Rollback audit log for Hamilton published fee record batches.';
COMMENT ON VIEW public.published_fee_catalog IS
  'Semantic product/admin/research catalog for Hamilton-published fee records.';

COMMENT ON COLUMN public.source_documents.source_collection_run_id IS
  'Collection-run identifier for the run that produced this source document.';
COMMENT ON COLUMN public.source_documents.institution_id IS
  'Institution/source identifier for this source document.';
COMMENT ON COLUMN public.agent_source_texts.source_document_id IS
  'Source document identifier for the fetched document read by Rosetta.';
COMMENT ON COLUMN public.agent_source_texts.institution_id IS
  'Institution/source identifier for this text artifact.';
COMMENT ON COLUMN public.raw_fee_observations.source_document_id IS
  'Source document identifier that produced this raw fee observation.';
COMMENT ON COLUMN public.published_fee_catalog.institution_id IS
  'Semantic institution/source identifier for product/admin fee consumers.';
COMMENT ON COLUMN public.published_fee_catalog.source_document_id IS
  'Semantic source document identifier for the raw fee observation lineage.';
COMMENT ON FUNCTION public.promote_to_tier2(bigint, text, bytea, uuid, text, text, jsonb) IS
  'Darwin-only promotion from raw_fee_observations to verified_fee_observations.';
COMMENT ON FUNCTION public.promote_to_tier3(bigint, uuid, text) IS
  'Adversarial publish gate from verified_fee_observations to published_fee_records.';
COMMENT ON FUNCTION public.lineage_graph(bigint) IS
  'Returns the published/verified/raw fee lineage graph using semantic physical tier tables.';

$migration$;
END
$legacy_guard$;
