-- #1234 step 2 (James approved, Oct 14): Knox's extraction note gets its own column.
--
-- Knox writes an audit note on every raw row it reads ("Knox deterministic extraction from Rosetta
-- artifact #N. canonical_hint=...; text_hash=...; excerpt=\"...\""). Until now it went into
-- `conditions`, the field for the bank's own condition text, so 237,519 of 238,430 Knox rows held
-- the note there (read-only count, 2026-10-14). From this migration:
--   - `extraction_note` holds the note; `conditions` holds only the bank's text.
--   - Code reads the note as `COALESCE(extraction_note, conditions)` (`extractionNoteOf`), so a row
--     not yet moved reads the same as one moved.
--   - Knox writes new and re-read rows to `extraction_note`.
--   - The stored notes are moved by Knox's ledger-visible `extraction-note` step after deploy, in
--     batches (`moveExtractionNotes`, src/lib/agents/knox/extraction-note.ts), not by this file.
--
-- This file changes no stored data: it adds a nullable column and appends it to the two catalog
-- views (same columns, same order, `extraction_note` last; `conditions` is still fr.conditions).
-- Rollback: recreate both views from 20270110000040 and drop the column, after the step's own
-- rollback has put every note back in `conditions`.

ALTER TABLE public.raw_fee_observations ADD COLUMN IF NOT EXISTS extraction_note text;
COMMENT ON COLUMN public.raw_fee_observations.extraction_note IS
  'Knox''s audit note for the read (#1234): method, Rosetta artifact, canonical_hint, text_hash, calibrated_confidence, excerpt. conditions holds only the bank''s own text.';

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
  fr.waiver_text,
  fp.fee_audience,
  fp.audience_evidence,
  fp.fee_treatment,
  fr.extraction_note
FROM public.published_fee_records fp
LEFT JOIN public.verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
LEFT JOIN public.raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
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
  fp.rate_basis,
  fp.fee_audience,
  fp.audience_evidence,
  fp.fee_treatment,
  fr.extraction_note
FROM public.published_fee_records fp
LEFT JOIN public.verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
LEFT JOIN public.raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
WHERE fp.rolled_back_at IS NULL
  AND fp.quarantined_at IS NULL
  AND fp.amount_kind = 'percent'
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

REVOKE ALL ON public.published_fee_rate_catalog FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.published_fee_rate_catalog TO service_role;
