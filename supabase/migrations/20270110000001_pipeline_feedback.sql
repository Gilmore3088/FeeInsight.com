-- One shared learning store for every agent (Knox, Magellan, Darwin, Hamilton, Rosetta).
-- One row is one judgement about one agent's output: a fee Hamilton took down, a Darwin
-- category reject, an answer-key fee, a link that produced live fees. It sits beside
-- pipeline_attempts (what an agent did); this records whether it turned out right.
-- Agents write it only through src/lib/agents/learning/feedback.ts.
--
-- Data: creates an empty table and indexes; changes no existing rows.

CREATE TABLE IF NOT EXISTS public.pipeline_feedback (
  id                 BIGSERIAL PRIMARY KEY,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- The output being judged: the stage and strategy that produced it.
  about_stage        TEXT NOT NULL,
  about_strategy     TEXT,
  about_version      INTEGER,
  about_attempt_id   BIGINT,
  signal             TEXT NOT NULL,
  kind               TEXT NOT NULL,
  -- Who judged it, and with which check.
  reported_by        TEXT NOT NULL,
  check_name         TEXT,
  institution_id     BIGINT,
  source_document_id BIGINT,
  source_url         TEXT,
  fee_raw_id         BIGINT,
  fee_verified_id    BIGINT,
  fee_published_id   BIGINT,
  canonical_fee_key  TEXT,
  amount             NUMERIC,
  weight             NUMERIC NOT NULL DEFAULT 1,
  evidence           JSONB NOT NULL DEFAULT '{}'::jsonb,
  agent_run_id       BIGINT,
  dedupe_key         TEXT NOT NULL,
  CONSTRAINT pipeline_feedback_dedupe_key_key UNIQUE (dedupe_key),
  CONSTRAINT pipeline_feedback_about_stage_check
    CHECK (about_stage IN ('discover', 'fetch', 'read', 'extract', 'verify', 'publish')),
  CONSTRAINT pipeline_feedback_signal_check
    CHECK (signal IN ('wrong', 'right', 'missed', 'restored')),
  CONSTRAINT pipeline_feedback_reported_by_check
    CHECK (reported_by IN ('atlas', 'magellan', 'rosetta', 'knox', 'darwin', 'hamilton', 'human'))
);

CREATE INDEX IF NOT EXISTS pipeline_feedback_strategy_idx
  ON public.pipeline_feedback (about_stage, about_strategy, about_version, signal);
CREATE INDEX IF NOT EXISTS pipeline_feedback_institution_idx
  ON public.pipeline_feedback (institution_id);
CREATE INDEX IF NOT EXISTS pipeline_feedback_document_idx
  ON public.pipeline_feedback (source_document_id);
CREATE INDEX IF NOT EXISTS pipeline_feedback_url_idx
  ON public.pipeline_feedback (source_url);
CREATE INDEX IF NOT EXISTS pipeline_feedback_raw_idx
  ON public.pipeline_feedback (fee_raw_id) WHERE fee_raw_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pipeline_feedback_published_idx
  ON public.pipeline_feedback (fee_published_id) WHERE fee_published_id IS NOT NULL;

ALTER TABLE public.pipeline_feedback ENABLE ROW LEVEL SECURITY;
