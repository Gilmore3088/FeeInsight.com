-- A fee waiting on its 12-hour second look (pipeline_feedback kind takedown_pending) stays in
-- the catalog until the archive, so an institution whose misread price was re-read correctly
-- showed both prices for 12 hours (Jeanne D'Arc FCU, 9 Oct: money order $2 and $5). Both
-- catalog views now leave out a pending row once a newer live row for the same institution and
-- fee has no pending flag. The archive itself still waits the 12 hours; a pending row that is
-- cleared on its second look comes back by itself.
--
-- Data change: none. Two view redefinitions (same columns, same order, same types) and a
-- partial index so the pending check reads 1,4xx rows, not the whole feedback table. On 9 Oct
-- the new condition leaves out 154 of 65,145 live rows.

CREATE INDEX IF NOT EXISTS pipeline_feedback_takedown_pending_idx
  ON public.pipeline_feedback (fee_published_id)
  WHERE kind = 'takedown_pending';

CREATE OR REPLACE VIEW public.published_fee_catalog
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
  fr.product_name AS account_product_type,
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
  fp.published_at AS updated_at,
  fp.amount_kind,
  fp.rate_percent,
  fp.rate_min_amount,
  fp.rate_max_amount,
  fp.rate_basis,
  fr.min_balance_to_avoid,
  fr.min_opening_deposit,
  fr.waiver_text
FROM public.published_fee_records fp
LEFT JOIN public.verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
LEFT JOIN public.raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
WHERE fp.rolled_back_at IS NULL
  AND fp.amount_kind = 'flat'
  AND fp.institution_id IN (
    SELECT deep.institution_id
      FROM public.published_fee_records deep
     WHERE deep.rolled_back_at IS NULL
     GROUP BY deep.institution_id
    HAVING count(DISTINCT deep.canonical_fee_key) >= 3
  )
  -- A fee waiting on its second look (takedown_pending) steps aside once a newer live read of
  -- the same fee at the same institution has none: the page shows the new price only.
  AND NOT (
    EXISTS (
      SELECT 1 FROM public.pipeline_feedback pf
       WHERE pf.fee_published_id = fp.fee_published_id AND pf.kind = 'takedown_pending'
    )
    AND EXISTS (
      SELECT 1 FROM public.published_fee_records newer
       WHERE newer.institution_id = fp.institution_id
         AND newer.canonical_fee_key = fp.canonical_fee_key
         AND newer.rolled_back_at IS NULL
         AND newer.published_at > fp.published_at
         AND NOT EXISTS (
           SELECT 1 FROM public.pipeline_feedback npf
            WHERE npf.fee_published_id = newer.fee_published_id AND npf.kind = 'takedown_pending'
         )
    )
  );

REVOKE ALL ON public.published_fee_catalog FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE VIEW public.published_fee_rate_catalog
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
  fp.published_at AS updated_at,
  fp.amount_kind,
  fp.rate_percent,
  fp.rate_min_amount,
  fp.rate_max_amount,
  fp.rate_basis
FROM public.published_fee_records fp
LEFT JOIN public.verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
LEFT JOIN public.raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
WHERE fp.rolled_back_at IS NULL
  AND fp.amount_kind = 'percent'
  AND fp.institution_id IN (
    SELECT deep.institution_id
      FROM public.published_fee_records deep
     WHERE deep.rolled_back_at IS NULL
     GROUP BY deep.institution_id
    HAVING count(DISTINCT deep.canonical_fee_key) >= 3
  )
  -- A fee waiting on its second look (takedown_pending) steps aside once a newer live read of
  -- the same fee at the same institution has none: the page shows the new price only.
  AND NOT (
    EXISTS (
      SELECT 1 FROM public.pipeline_feedback pf
       WHERE pf.fee_published_id = fp.fee_published_id AND pf.kind = 'takedown_pending'
    )
    AND EXISTS (
      SELECT 1 FROM public.published_fee_records newer
       WHERE newer.institution_id = fp.institution_id
         AND newer.canonical_fee_key = fp.canonical_fee_key
         AND newer.rolled_back_at IS NULL
         AND newer.published_at > fp.published_at
         AND NOT EXISTS (
           SELECT 1 FROM public.pipeline_feedback npf
            WHERE npf.fee_published_id = newer.fee_published_id AND npf.kind = 'takedown_pending'
         )
    )
  );

REVOKE ALL ON public.published_fee_rate_catalog FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.published_fee_rate_catalog TO service_role;
