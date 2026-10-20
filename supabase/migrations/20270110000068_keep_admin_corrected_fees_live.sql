-- #978 H03-T07: an admin-corrected fee stays live until an admin corrects or reverses it again.
-- A corrected version keeps its original raw/verified lineage (20270110000066), so every agent
-- check that reads live Knox rows also reads it, re-checks it against the old document and can
-- take it down. Only Darwin's re-check skipped corrected rows; about 40 other takedown paths did
-- not. This trigger is the one place they all pass through: an update that would close a live
-- row with a current correction is skipped (the row stays live and drops out of RETURNING),
-- unless the correction workflow itself is superseding it (batch prefix `admin-correction-`,
-- CORRECTION_BATCH_PREFIX in src/lib/fee-correction-rules.ts). Holds use quarantined_at and are
-- untouched; restores (rolled_back_at back to NULL) are untouched.
--
-- Schema only: no table rows change when this runs.
-- Rollback: DROP TRIGGER keep_admin_corrected_fee_live ON public.published_fee_records;
--           DROP FUNCTION public.keep_admin_corrected_fee_live();
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.keep_admin_corrected_fee_live()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(NEW.rolled_back_by_batch_id, '') NOT LIKE 'admin-correction-%'
     AND EXISTS (
       SELECT 1 FROM public.published_fee_corrections c
        WHERE c.fee_published_id = OLD.fee_published_id
          AND c.status = 'current'
     )
  THEN
    RAISE NOTICE 'fee % has a current admin correction; takedown by % skipped',
      OLD.fee_published_id, COALESCE(NEW.rolled_back_by_batch_id, 'an unnamed batch');
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.keep_admin_corrected_fee_live() FROM PUBLIC;

CREATE OR REPLACE TRIGGER keep_admin_corrected_fee_live
  BEFORE UPDATE OF rolled_back_at ON public.published_fee_records
  FOR EACH ROW
  WHEN (OLD.rolled_back_at IS NULL AND NEW.rolled_back_at IS NOT NULL)
  EXECUTE FUNCTION public.keep_admin_corrected_fee_live();
