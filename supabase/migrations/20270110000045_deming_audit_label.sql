-- Deming's fresh-audit misses become test cases and reach their owners (#1119, approved by
-- James on 2026-10-12).
--
-- Widens two checks, keeping each constraint's name:
--   eval_cases.label_provenance: adds 'deming_audit' (first defined in
--     20270110000037_deming_eval_cases.sql). A case with this label stays 'candidate' until a
--     person or a take-down confirms it (src/lib/agents/deming/audit-misses.ts).
--   pipeline_feedback.reported_by: adds 'deming' (last set in
--     20270110000024_pipeline_feedback_growth.sql; code: FEEDBACK_REPORTERS in
--     src/lib/agents/learning/feedback.ts).
--
-- Data: changes no rows. Both checks only widen, so every existing row still passes.

ALTER TABLE public.eval_cases DROP CONSTRAINT IF EXISTS eval_cases_label_provenance_check;
ALTER TABLE public.eval_cases ADD CONSTRAINT eval_cases_label_provenance_check
  CHECK (label_provenance IN ('takedown_confirmed', 'human', 'answer_key', 'deming_audit'));

ALTER TABLE public.pipeline_feedback DROP CONSTRAINT IF EXISTS pipeline_feedback_reported_by_check;
ALTER TABLE public.pipeline_feedback ADD CONSTRAINT pipeline_feedback_reported_by_check
  CHECK (reported_by IN ('atlas', 'magellan', 'rosetta', 'knox', 'darwin', 'hamilton', 'growth', 'human', 'deming'));
