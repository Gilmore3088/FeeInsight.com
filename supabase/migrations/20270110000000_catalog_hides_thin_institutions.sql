-- The site shows a bank only while it has at least 3 distinct live fees (James, 6 Oct 2026).
--
-- Hamilton's 3-fee rule (publish.ts, HAMILTON_PUBLISH_MIN_INSTITUTION_FEES) gated only a
-- bank's first publish. Takedowns afterwards left 163 banks with 1 or 2 live fees, and
-- those banks appeared on the site and counted in every median as full banks.
--
-- published_fee_catalog, the read model for product, report, research and API reads, now
-- shows a bank's live fees only while that bank has at least 3 distinct canonical fee keys
-- live. Nothing is deleted or rolled back: the rows stay live in published_fee_records,
-- and the bank reappears on its own once it has 3 again. Agents that need every live row
-- (the publish gate, source check, rules re-check, Magellan's thin-bank finder) read
-- published_fee_records directly.
--
-- Data change: none. This replaces a view definition only; columns are unchanged.

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
WHERE fp.rolled_back_at IS NULL
  AND fp.institution_id IN (
    SELECT deep.institution_id
      FROM public.published_fee_records deep
     WHERE deep.rolled_back_at IS NULL
     GROUP BY deep.institution_id
    HAVING count(DISTINCT deep.canonical_fee_key) >= 3
  );

REVOKE ALL ON public.published_fee_catalog FROM PUBLIC, anon, authenticated;
