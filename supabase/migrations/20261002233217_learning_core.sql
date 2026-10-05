-- Learning core (Phase 1, PR 1a): the pipeline's memory.
--
--   * pipeline_attempts: one append-only row per agent attempt (fetch, read, extract, ...)
--     with a typed outcome, the strategy and version used, the input fingerprint
--     (content or text hash), the yield and the cost. Agents consult it before acting,
--     so an input that already failed with a given strategy version is never retried.
--   * institution_source_profiles gains the per-institution playbook: the learned
--     format, the best strategy per stage, per-strategy stats, the inputs not to retry,
--     the expected fee count and the cost to date.
--   * source_documents gains HTTP validators (etag, last_modified) and last_checked_at,
--     so Magellan can send conditional requests and record "unchanged" instead of
--     inserting a duplicate document. No unique (institution_id, content_hash) index
--     yet: existing duplicates would make it fail. A later dedupe workflow adds it.
--
-- Additive and idempotent. The app checks for these objects before using them, so
-- deploying the code before this migration degrades to the previous behavior.

BEGIN;

CREATE TABLE IF NOT EXISTS public.pipeline_attempts (
  id                    BIGSERIAL PRIMARY KEY,
  institution_id        BIGINT REFERENCES public.institution_sources(id) ON DELETE CASCADE,
  source_document_id    BIGINT REFERENCES public.source_documents(id) ON DELETE SET NULL,
  stage                 TEXT NOT NULL,
  strategy              TEXT NOT NULL,
  strategy_version      INTEGER NOT NULL DEFAULT 1,
  input_fingerprint     TEXT,
  outcome               TEXT NOT NULL,
  yield_count           INTEGER NOT NULL DEFAULT 0,
  cost_microusd         BIGINT NOT NULL DEFAULT 0,
  duration_ms           INTEGER,
  agent_run_id          BIGINT,
  agent_run_step_id     BIGINT,
  detail                JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pipeline_attempts_stage_check
    CHECK (stage IN ('discover', 'fetch', 'read', 'extract', 'verify', 'publish')),
  CONSTRAINT pipeline_attempts_outcome_check
    CHECK (outcome IN (
      'ok',
      'ok_partial',
      'unchanged',
      'invalid_url',
      'http_403',
      'http_404',
      'http_410',
      'http_429',
      'http_5xx',
      'http_other',
      'timeout',
      'network_error',
      'too_large',
      'blocked_bot',
      'js_required',
      'scanned_pdf',
      'empty',
      'parse_error',
      'unsupported_format',
      'wrong_document',
      'no_candidates',
      'low_yield',
      'evidence_mismatch',
      'budget_blocked'
    )),
  CONSTRAINT pipeline_attempts_nonnegative_check
    CHECK (yield_count >= 0 AND cost_microusd >= 0 AND strategy_version >= 1)
);

CREATE INDEX IF NOT EXISTS pipeline_attempts_institution_stage_idx
  ON public.pipeline_attempts (institution_id, stage, created_at DESC);
CREATE INDEX IF NOT EXISTS pipeline_attempts_input_idx
  ON public.pipeline_attempts (input_fingerprint, strategy, strategy_version);
CREATE INDEX IF NOT EXISTS pipeline_attempts_run_idx
  ON public.pipeline_attempts (agent_run_id)
  WHERE agent_run_id IS NOT NULL;

ALTER TABLE public.pipeline_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pipeline_attempts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.pipeline_attempts_id_seq FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.pipeline_attempts IS
  'Append-only learning log: one row per agent attempt with a typed outcome. See src/lib/agents/learning/AGENTS.md.';

ALTER TABLE public.institution_source_profiles
  ADD COLUMN IF NOT EXISTS format                 TEXT,
  ADD COLUMN IF NOT EXISTS platform               TEXT,
  ADD COLUMN IF NOT EXISTS layout_fingerprint     TEXT,
  ADD COLUMN IF NOT EXISTS best_strategy          JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS strategy_stats         JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS expected_fee_count     INTEGER,
  ADD COLUMN IF NOT EXISTS do_not_retry           JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS cost_to_date_microusd  BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_learned_at        TIMESTAMPTZ;

ALTER TABLE public.institution_source_profiles
  DROP CONSTRAINT IF EXISTS institution_source_profiles_format_check;
ALTER TABLE public.institution_source_profiles
  ADD CONSTRAINT institution_source_profiles_format_check
  CHECK (format IS NULL OR format IN (
    'pdf_text',
    'pdf_scanned',
    'html_static',
    'html_js',
    'docx',
    'text',
    'other'
  ));

COMMENT ON COLUMN public.institution_source_profiles.format IS
  'Format learned from document bytes by Rosetta. Profile sync never overwrites source_kind once this is set.';
COMMENT ON COLUMN public.institution_source_profiles.do_not_retry IS
  'JSON array of {stage, strategy, version, fingerprint, outcome, at}: inputs that failed permanently with that strategy version.';

ALTER TABLE public.source_documents
  ADD COLUMN IF NOT EXISTS etag             TEXT,
  ADD COLUMN IF NOT EXISTS last_modified    TEXT,
  ADD COLUMN IF NOT EXISTS last_checked_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS source_documents_institution_hash_idx
  ON public.source_documents (institution_id, content_hash)
  WHERE content_hash IS NOT NULL;

COMMIT;
