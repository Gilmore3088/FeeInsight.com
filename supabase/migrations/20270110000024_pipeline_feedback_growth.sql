-- Let growth, the marketing agent, write results and lessons to the shared learning store
-- (growth-os/BUILD-PLAN.md task 1.3).
--
-- Widens two checks on pipeline_feedback (first defined in 20270110000001_pipeline_feedback.sql;
-- no later migration changed them), keeping each constraint's name:
--   reported_by: adds 'growth'      (code: FEEDBACK_REPORTERS in src/lib/agents/learning/feedback.ts)
--   about_stage: adds 'marketing'   (code: FEEDBACK_STAGES = ATTEMPT_STAGES + 'marketing')
--
-- Data: changes no rows. Both checks only widen, so every existing row still passes.

ALTER TABLE public.pipeline_feedback DROP CONSTRAINT IF EXISTS pipeline_feedback_reported_by_check;
ALTER TABLE public.pipeline_feedback ADD CONSTRAINT pipeline_feedback_reported_by_check
  CHECK (reported_by IN ('atlas', 'magellan', 'rosetta', 'knox', 'darwin', 'hamilton', 'growth', 'human'));

ALTER TABLE public.pipeline_feedback DROP CONSTRAINT IF EXISTS pipeline_feedback_about_stage_check;
ALTER TABLE public.pipeline_feedback ADD CONSTRAINT pipeline_feedback_about_stage_check
  CHECK (about_stage IN ('discover', 'fetch', 'read', 'extract', 'verify', 'publish', 'marketing'));
