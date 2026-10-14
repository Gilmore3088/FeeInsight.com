-- User-reported Pinnacle correction, not a bank fee change in October 2026.
-- The bank's program changes were effective 2022-08-01. Do not emit a fee-change alert.
-- No invented raw/verified events: replacements must pass Knox -> Darwin -> Hamilton.
-- Scope: the two EXACT historical observations diagnosed on the working branch.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.published_fee_records p
    WHERE p.fee_published_id IN (97662,97663)
      AND (p.institution_id <> 47 OR p.amount IS DISTINCT FROM 30
        OR p.canonical_fee_key <> CASE p.fee_published_id WHEN 97662 THEN 'nsf' ELSE 'overdraft' END
        OR p.lineage_ref <> CASE p.fee_published_id WHEN 97662 THEN 110743 ELSE 110744 END)
  ) THEN RAISE EXCEPTION 'Pinnacle correction precondition changed; inspect before applying'; END IF;
END $$;

WITH target AS (
  SELECT p.fee_published_id, p.lineage_ref, v.fee_raw_id, p.institution_id,
         p.canonical_fee_key, p.amount, r.source_document_id, r.source_url, r.conditions
    FROM public.published_fee_records p
    JOIN public.verified_fee_observations v ON v.fee_verified_id = p.lineage_ref
    JOIN public.raw_fee_observations r ON r.fee_raw_id = v.fee_raw_id
   WHERE p.fee_published_id IN (97662,97663) AND p.institution_id = 47
     AND r.fee_raw_id IN (321488,321489) AND r.source_document_id = 21164
     AND r.source_url = 'https://www.pnfp.com/Overdraft'
), feedback AS (
  INSERT INTO public.pipeline_feedback (
    about_stage, signal, kind, reported_by, check_name, institution_id,
    source_document_id, source_url, fee_raw_id, fee_verified_id, fee_published_id,
    canonical_fee_key, amount, evidence, dedupe_key
  ) SELECT 'extract', 'wrong', 'confirmed_data_error', 'human', 'human.pinnacle_audience',
           institution_id, source_document_id, source_url, fee_raw_id, lineage_ref, fee_published_id,
           canonical_fee_key, amount,
           jsonb_build_object('origin','user-reported Pinnacle audit',
             'correction_type','data_quality_not_bank_fee_change',
             'reason','Source audience was dropped; old observation must not be republished',
             'source_excerpt',conditions,
             'source_program_effective_date','2022-08-01'),
           'pinnacle-audience-correction:pub:' || fee_published_id
      FROM target ON CONFLICT (dedupe_key) DO NOTHING
), raw_block AS (
  UPDATE public.raw_fee_observations r
     SET outlier_flags = (r.outlier_flags - 'needs_darwin_verification')
                         || '["audience_correction_required"]'::jsonb
    FROM target t WHERE r.fee_raw_id = t.fee_raw_id
      AND NOT r.outlier_flags ? 'audience_correction_required'
), verified_block AS (
  UPDATE public.verified_fee_observations v
     SET review_status = 'rejected',
         outlier_flags = v.outlier_flags || '["audience_correction_required"]'::jsonb
    FROM target t WHERE v.fee_verified_id = t.lineage_ref
      AND NOT v.outlier_flags ? 'audience_correction_required'
)
UPDATE public.published_fee_records p
   SET quarantined_at = COALESCE(p.quarantined_at, now()),
       quarantine_reason = 'pinnacle_audience_correction: confirmed data-quality error',
       rolled_back_at = COALESCE(p.rolled_back_at, now()),
       rolled_back_by_batch_id = COALESCE(p.rolled_back_by_batch_id, 'pinnacle-audience-correction'),
       rolled_back_reason = COALESCE(p.rolled_back_reason, 'pinnacle_audience_correction')
  FROM target t WHERE p.fee_published_id = t.fee_published_id;

-- Re-extraction is deliberately handled by extract.rules v65's existing current-copy /
-- priority-bank reread. No synthetic $0 is inserted into verified or published tables here.
