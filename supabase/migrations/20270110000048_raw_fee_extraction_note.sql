-- #1234 step 2 (James approved, Oct 14): Knox's extraction note gets its own column.
--
-- Knox writes an audit note on every raw row it reads ("Knox deterministic extraction from Rosetta
-- artifact #N. canonical_hint=...; text_hash=...; excerpt=\"...\""). Until now it went into
-- `conditions`, the field for the bank's own condition text: 239,006 of 239,917 Knox rows held only
-- the note there (read-only count, 2026-10-15 00:56 UTC).
--
-- This file only adds. It adds a nullable column and appends it to the two catalog views as their
-- last column (same columns, same order before it; `conditions` is still fr.conditions). It changes
-- no stored data, and today's code, which never names `extraction_note`, runs unchanged against it.
-- It ships on its own, ahead of the code that reads and writes the column (#1336), so that code
-- never deploys before the column exists. The stored notes are moved later by Knox's
-- ledger-visible step in #1336 (`moveExtractionNotes`), not by this file.
--
-- lock_timeout: adding a column and replacing a view take an ACCESS EXCLUSIVE lock. If a publish
-- transaction holds the table or a view, this fails after 20 seconds instead of queueing every
-- read behind it; it can then be run again. The first deploy (01:03 UTC Oct 15) used 5 seconds and
-- was cancelled by a 6-10 second read on the table; nothing was applied
-- (docs/project/findings/2026-10-15-migration-lock-timeout.md).
--
-- Rollback (only after #1336's step rollback has put every note back in `conditions`, or before
-- that step ever ran). CREATE OR REPLACE VIEW cannot drop a view column, so:
--   BEGIN;
--   SET LOCAL lock_timeout = '5s';
--   DROP VIEW public.published_fee_rate_catalog;
--   DROP VIEW public.published_fee_catalog;
--   -- CREATE VIEW both again from 20270110000040_fee_audience_integrity.sql, with its REVOKE/GRANT lines.
--   -- Check: each view's grantees are postgres and service_role only:
--   --   SELECT relname, relacl FROM pg_class WHERE relname IN ('published_fee_catalog', 'published_fee_rate_catalog');
--   --   On 2026-10-15 both read {postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}.
--   ALTER TABLE public.raw_fee_observations DROP COLUMN extraction_note;
--   COMMIT;

SET lock_timeout = '20s';

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
