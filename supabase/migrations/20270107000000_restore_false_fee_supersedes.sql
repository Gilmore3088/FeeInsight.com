-- Undo the fee "price changes" Hamilton recorded that never happened.
--
-- Hamilton used to treat any second price for the same fee (institution, canonical key,
-- variant, frequency) as a new price and close the live one. Of 495 such replacements
-- on 2026-10-05, only 2 were real (the same fee line at a new amount in a newer
-- document). The rest were:
--   * 465 other lines of the same schedule (a $28 and a $15 stop payment for different
--     channels), the second closing the first;
--   * 18 where an older document overwrote a newer live price;
--   * 10 where a newer document's differently named line replaced an unrelated line.
-- Each wrote a fake row to fee_change_records and raised a fee-movement signal. Publish
-- now records a change only for a same-named line from a newer document; this repairs
-- what was already written.
--
--   * Reopens each wrongly closed row, unless the same verified row or an identical
--     line is already live.
--   * Where an older document overwrote a newer price, closes that stale row
--     (`older document than #<id>`).
--   * Deletes the fee_change_records rows those replacements wrote (same institution,
--     fee, amounts, and timestamp as the close).
--   * Deletes fee-movement signals whose every movement was one of these (their
--     priority alerts cascade).
--
-- Run after the publish fix is deployed. Idempotent: a second run finds nothing.

SET lock_timeout = '10s';
SET statement_timeout = '120s';

BEGIN;

CREATE TEMP TABLE false_supersedes ON COMMIT DROP AS
SELECT old_fp.fee_published_id,
       new_fp.fee_published_id AS superseded_by_id,
       old_fp.institution_id,
       old_fp.canonical_fee_key,
       old_fp.amount AS old_amount,
       new_fp.amount AS new_amount,
       old_fp.rolled_back_at,
       new_doc.crawled_at < old_doc.crawled_at AS older_document_won
  FROM public.published_fee_records old_fp
  JOIN public.published_fee_records new_fp
    ON new_fp.fee_published_id = substring(old_fp.rolled_back_reason FROM '^superseded by #(\d+)$')::bigint
  JOIN public.verified_fee_observations old_fv ON old_fv.fee_verified_id = old_fp.lineage_ref
  JOIN public.raw_fee_observations old_fr ON old_fr.fee_raw_id = old_fv.fee_raw_id
  JOIN public.verified_fee_observations new_fv ON new_fv.fee_verified_id = new_fp.lineage_ref
  JOIN public.raw_fee_observations new_fr ON new_fr.fee_raw_id = new_fv.fee_raw_id
  LEFT JOIN public.source_documents old_doc ON old_doc.id = old_fr.source_document_id
  LEFT JOIN public.source_documents new_doc ON new_doc.id = new_fr.source_document_id
 WHERE old_fp.rolled_back_reason LIKE 'superseded by #%'
   AND old_fp.rolled_back_at IS NOT NULL
   AND old_fr.source_document_id IS NOT NULL
   AND new_fr.source_document_id IS NOT NULL
   AND NOT (
     -- The only real change: the same line at a new amount in a newer document.
     old_fr.source_document_id <> new_fr.source_document_id
     AND new_doc.crawled_at > old_doc.crawled_at
     AND btrim(regexp_replace(lower(old_fp.fee_name), '[^a-z0-9]+', ' ', 'g'))
       = btrim(regexp_replace(lower(new_fp.fee_name), '[^a-z0-9]+', ' ', 'g'))
   );

DELETE FROM public.fee_change_records c
 USING false_supersedes s
 WHERE c.institution_id = s.institution_id
   AND c.canonical_fee_key = s.canonical_fee_key
   AND c.previous_amount IS NOT DISTINCT FROM s.old_amount
   AND c.new_amount IS NOT DISTINCT FROM s.new_amount
   AND c.detected_at = s.rolled_back_at;

DELETE FROM public.hamilton_signals sig
 WHERE sig.signal_type = 'hamilton_fee_movement_detected'
   AND jsonb_typeof(sig.source_json -> 'movements') = 'array'
   AND jsonb_array_length(sig.source_json -> 'movements') > 0
   AND NOT EXISTS (
     SELECT 1
       FROM jsonb_array_elements(sig.source_json -> 'movements') m
      WHERE (m ->> 'previous_fee_published_id')::bigint NOT IN (
        SELECT fee_published_id FROM false_supersedes
      )
   );

UPDATE public.published_fee_records fp
   SET rolled_back_at = NOW(),
       rolled_back_by_batch_id = 'restore-false-supersedes',
       rolled_back_reason = 'older document than #' || s.fee_published_id
  FROM false_supersedes s
 WHERE fp.fee_published_id = s.superseded_by_id
   AND s.older_document_won
   AND fp.rolled_back_at IS NULL;

UPDATE public.published_fee_records fp
   SET rolled_back_at = NULL,
       rolled_back_by_batch_id = NULL,
       rolled_back_reason = NULL
  FROM false_supersedes s
 WHERE fp.fee_published_id = s.fee_published_id
   AND NOT EXISTS (
     SELECT 1
       FROM public.published_fee_records live
      WHERE live.rolled_back_at IS NULL
        AND (
          live.lineage_ref = fp.lineage_ref
          OR (
            live.institution_id = fp.institution_id
            AND live.canonical_fee_key = fp.canonical_fee_key
            AND COALESCE(live.variant_type, '') = COALESCE(fp.variant_type, '')
            AND COALESCE(live.frequency, '') = COALESCE(fp.frequency, '')
            AND live.amount IS NOT DISTINCT FROM fp.amount
            AND live.fee_name = fp.fee_name
          )
        )
   );

COMMIT;
