-- #1059: Darwin's audience is the one published (James, 2026-10-13, option 1). Knox suggests the
-- audience on the raw row; Darwin decides on the verified row, writing evidence that starts with
-- 'darwin:'. The verified tier now keeps that decision instead of copying the raw row's audience.
-- Every other verified write still inherits the raw row's audience, and the published tier still
-- inherits the verified row's, unchanged.
--
-- Data: this changes no stored row. It changes what Darwin's new verified rows (and the published
-- rows built from them) carry. Existing rows keep their audience until a separate, approved
-- relabel step.
CREATE OR REPLACE FUNCTION public.inherit_fee_applicability() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE parent_institution bigint; blocked boolean; raw_audience text; raw_evidence text;
BEGIN
  IF TG_TABLE_NAME = 'verified_fee_observations' THEN
    SELECT r.institution_id, r.fee_audience, r.audience_evidence, r.fee_treatment,
           r.outlier_flags ? 'audience_correction_required'
      INTO parent_institution, raw_audience, raw_evidence, NEW.fee_treatment, blocked
      FROM public.raw_fee_observations r WHERE r.fee_raw_id = NEW.fee_raw_id;
    IF NOT (NEW.fee_audience IN ('consumer', 'business', 'both')
            AND NEW.audience_evidence LIKE 'darwin:%') THEN
      NEW.fee_audience := raw_audience;
      NEW.audience_evidence := raw_evidence;
    END IF;
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
