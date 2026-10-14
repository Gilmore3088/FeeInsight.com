-- Explicit fee audience is independent of an account's product name.
-- Existing rows deliberately remain unknown; no assumption that an unqualified fee is consumer.
-- Deploy with the application change, AFTER reviewing consumer benchmark coverage in staging.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['raw_fee_observations','verified_fee_observations','published_fee_records'] LOOP
    EXECUTE format('ALTER TABLE public.%I
      ADD COLUMN fee_audience text NOT NULL DEFAULT ''unknown'',
      ADD COLUMN audience_evidence text,
      ADD COLUMN fee_treatment text NOT NULL DEFAULT ''unknown''', t);
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (
      fee_audience IN (''consumer'',''business'',''both'',''unknown'')
      AND (fee_audience = ''unknown'' OR nullif(btrim(audience_evidence), '''') IS NOT NULL))', t, t || '_audience_check');
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (
      fee_treatment = ''unknown''
      OR (fee_treatment = ''charged'' AND ((amount_kind = ''flat'' AND amount IS NOT NULL AND amount > 0) OR amount_kind = ''percent''))
      OR (fee_treatment IN (''no_charge'',''eliminated'') AND amount_kind = ''flat'' AND amount IS NOT NULL AND amount = 0))', t, t || '_treatment_check');
  END LOOP;
END $$;

ALTER TABLE public.published_fee_records
  ADD COLUMN quarantined_at timestamptz,
  ADD COLUMN quarantine_reason text,
  ADD CONSTRAINT published_fee_records_quarantine_check CHECK (
    (quarantined_at IS NULL AND quarantine_reason IS NULL)
    OR (quarantined_at IS NOT NULL AND nullif(btrim(quarantine_reason), '') IS NOT NULL));
COMMENT ON COLUMN public.published_fee_records.quarantined_at IS
  'Confirmed data error: excluded immediately, independently of replacement coverage or historical review flags.';

-- All verification/publication writers inherit the same evidence through real lineage.
-- This is an invoker trigger, not a privileged RPC; it does not manufacture verification events.
CREATE FUNCTION public.inherit_fee_applicability() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE parent_institution bigint; blocked boolean;
BEGIN
  IF TG_TABLE_NAME = 'verified_fee_observations' THEN
    SELECT r.institution_id, r.fee_audience, r.audience_evidence, r.fee_treatment,
           r.outlier_flags ? 'audience_correction_required'
      INTO parent_institution, NEW.fee_audience, NEW.audience_evidence, NEW.fee_treatment, blocked
      FROM public.raw_fee_observations r WHERE r.fee_raw_id = NEW.fee_raw_id;
  ELSIF TG_TABLE_NAME = 'published_fee_records' THEN
    SELECT v.institution_id, v.fee_audience, v.audience_evidence, v.fee_treatment,
           r.outlier_flags ? 'audience_correction_required'
      INTO parent_institution, NEW.fee_audience, NEW.audience_evidence, NEW.fee_treatment, blocked
      FROM public.verified_fee_observations v
      JOIN public.raw_fee_observations r ON r.fee_raw_id = v.fee_raw_id
     WHERE v.fee_verified_id = NEW.lineage_ref;
  ELSE
    RAISE EXCEPTION 'Unsupported fee applicability trigger table';
  END IF;
  IF parent_institution IS NULL OR parent_institution <> NEW.institution_id THEN
    RAISE EXCEPTION 'Fee audience lineage is missing or belongs to another institution';
  END IF;
  IF blocked THEN
    RAISE EXCEPTION 'Source observation requires an audience correction; re-extract rather than republish';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.inherit_fee_applicability() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER verified_fee_applicability
BEFORE INSERT OR UPDATE OF fee_raw_id, institution_id, fee_audience, audience_evidence, fee_treatment
ON public.verified_fee_observations FOR EACH ROW EXECUTE FUNCTION public.inherit_fee_applicability();
CREATE TRIGGER published_fee_applicability
BEFORE INSERT OR UPDATE OF lineage_ref, institution_id, fee_audience, audience_evidence, fee_treatment
ON public.published_fee_records FOR EACH ROW EXECUTE FUNCTION public.inherit_fee_applicability();

-- Same name, amount and document may legitimately price both audiences independently.
DROP INDEX IF EXISTS public.raw_fee_observations_knox_agentic_dedup_idx;
CREATE UNIQUE INDEX raw_fee_observations_knox_agentic_dedup_idx
  ON public.raw_fee_observations (source_document_id, lower(fee_name), COALESCE(amount, '-1'::numeric), fee_audience)
  WHERE source = 'knox' AND source_document_id IS NOT NULL;
CREATE INDEX published_fee_records_live_audience_idx
  ON public.published_fee_records (institution_id, canonical_fee_key, fee_audience, published_at DESC)
  WHERE rolled_back_at IS NULL AND quarantined_at IS NULL;

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
  fp.fee_treatment
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
  fp.fee_treatment
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
