-- #2127 / #978: publish an admin correction's conditions and evidence document.
-- Corrected versions retain their original raw/verified lineage. Read the approved current
-- correction for its conditions and source instead of silently returning original raw values.
-- A NULL corrected condition clears the condition; do not COALESCE it with the original.
-- Hide the original extraction note on corrected rows: readers prefer that note over conditions.
-- Resolve corrected source links from the evidence document too, including after a reversal.
-- If correction evidence is inconsistent, leave all source fields NULL rather than mixing copies.
--
-- Forward-only view replacement. No table rows, grants, eligibility gates, column order/types,
-- security_invoker setting, raw lineage, or percentage-rate catalog are changed.
-- source_document_id keeps the catalog's existing integer contract (raw source IDs are integer).
-- Source definition: migration 20270110000048, SHA256 20be09c80a90aaca9d20afa6451de42549616c02de6f8121db940d0b331ead3d.
-- Rollback: restore the dollar CREATE OR REPLACE VIEW from migration 20270110000048;
-- do not rerun that entire migration. Keep correction history and all published rows.

BEGIN;
SET LOCAL lock_timeout = '5s';

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
  CASE WHEN pc.id IS NULL THEN fr.conditions ELSE pc.conditions END AS conditions,
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
  CASE WHEN pc.id IS NULL THEN COALESCE(fp.source_url, fv.source_url, fr.source_url)
       ELSE correction_source.document_url END AS source_url,
  fr.source,
  CASE WHEN pc.id IS NULL THEN COALESCE(fp.source_url, fv.source_url, fr.source_url)
       ELSE correction_source.document_url END AS document_url,
  CASE WHEN pc.id IS NULL THEN COALESCE(fp.document_r2_key, fv.document_r2_key, fr.document_r2_key)
       ELSE correction_source.document_r2_key END AS document_r2_key,
  CASE WHEN pc.id IS NULL THEN fr.source_document_id
       ELSE correction_source.id::integer END AS source_document_id,
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
  fr.waiver_text,
  fp.fee_audience,
  fp.audience_evidence,
  fp.fee_treatment,
  CASE WHEN pc.id IS NULL THEN fr.extraction_note ELSE NULL::text END AS extraction_note
FROM public.published_fee_records fp
LEFT JOIN public.verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
LEFT JOIN public.raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
LEFT JOIN public.published_fee_corrections pc
  ON pc.fee_published_id = fp.fee_published_id
 AND pc.institution_id = fp.institution_id
 AND pc.status = 'current'
LEFT JOIN public.source_documents correction_source
  ON pc.id IS NOT NULL
 AND correction_source.id = COALESCE(pc.source_document_id, fr.source_document_id)
 AND correction_source.institution_id = fp.institution_id
WHERE fp.rolled_back_at IS NULL
  AND fp.quarantined_at IS NULL
  AND fp.amount_kind = 'flat'
  AND fp.institution_id IN (
    SELECT deep.institution_id
      FROM public.published_fee_records deep
     WHERE deep.rolled_back_at IS NULL
       AND deep.quarantined_at IS NULL
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
         AND newer.fee_audience = fp.fee_audience
         AND newer.quarantined_at IS NULL
         AND newer.rolled_back_at IS NULL
         AND newer.published_at > fp.published_at
         AND NOT EXISTS (
           SELECT 1 FROM public.pipeline_feedback npf
            WHERE npf.fee_published_id = newer.fee_published_id AND npf.kind = 'takedown_pending'
         )
    )
  );


COMMIT;
