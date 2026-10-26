-- Disposable restore destination. No production observation is changed by a rehearsal.
SET LOCAL lock_timeout='3s';
CREATE UNLOGGED TABLE public.call_report_archive_restore_checks
  (LIKE public.institution_call_report_items INCLUDING CONSTRAINTS INCLUDING INDEXES);
ALTER TABLE public.call_report_archive_restore_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.call_report_archive_restore_checks FROM PUBLIC,anon,authenticated;
