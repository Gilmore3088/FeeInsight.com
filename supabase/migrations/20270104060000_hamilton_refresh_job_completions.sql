-- Per-user completion of Hamilton refresh jobs.
--
-- hamilton_refresh_jobs rows are created per institution signal and shared by every
-- subscriber watching that institution. Completing one used to flip the shared row to
-- 'completed', clearing it for everyone. Completion is now recorded per user here; the
-- Monitor queue hides only the jobs the viewing user has completed.
--
-- Additive and idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS public.hamilton_refresh_job_completions (
  job_id        uuid NOT NULL REFERENCES public.hamilton_refresh_jobs(id) ON DELETE CASCADE,
  user_id       integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  completed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_hamilton_refresh_job_completions_user
  ON public.hamilton_refresh_job_completions(user_id, completed_at DESC);

ALTER TABLE public.hamilton_refresh_job_completions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hamilton_refresh_job_completions FROM PUBLIC, anon, authenticated;

COMMIT;
