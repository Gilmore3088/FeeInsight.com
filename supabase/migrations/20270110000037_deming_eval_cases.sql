-- Deming's test-case store (Agentic OS PRD section 7). One row is one labeled example the
-- pipeline must keep getting right: a confirmed production mistake (regression), a hand-checked
-- fee (golden, holdout), a known hard layout (adversarial), or a fresh audit sample.
-- Written only by src/lib/agents/deming/regression.ts; read by Deming's daily replay and the
-- admin quality views.
--
--   case_key           dedupe key, e.g. 'takedown:<fee_published_id>:<check_name>'
--   dataset            golden | adversarial | regression | holdout | fresh_audit
--   status             candidate (labeled, not yet replayable), active (the deployed rule
--                      reproduces the catch; a later miss is a regression), retired
--   agent              the stage the case tests (knox, darwin, hamilton)
--   check_name         the rule that caught the mistake (hamilton.limit_guard, ...)
--   error_class        the reason code (limit_as_fee, amount_is_a_threshold, ...)
--   severity           critical | major | minor | info (PRD 7.4; src/lib/agents/deming/severity.ts)
--   input              frozen snapshot the checker replays; never updated after insert
--   expected           what a correct pipeline does with the input
--   label_provenance   takedown_confirmed | human | answer_key
--   source_text_hash   hash of the stored document text the label was made against
--   last_*             the newest replay of this case against the deployed code
--
-- Data: schema only. Creates an empty table and indexes; changes no existing rows.

CREATE TABLE IF NOT EXISTS public.eval_cases (
  id                  BIGSERIAL PRIMARY KEY,
  case_key            TEXT NOT NULL,
  dataset             TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'candidate',
  agent               TEXT NOT NULL,
  check_name          TEXT,
  error_class         TEXT NOT NULL,
  severity            TEXT NOT NULL,
  institution_id      BIGINT,
  source_document_id  BIGINT,
  source_url          TEXT,
  source_text_hash    TEXT,
  fee_published_id    BIGINT,
  fee_verified_id     BIGINT,
  fee_raw_id          BIGINT,
  input               JSONB NOT NULL,
  expected            JSONB NOT NULL,
  label_provenance    TEXT NOT NULL,
  origin_feedback_id  BIGINT,
  reviewer            TEXT,
  validated_at        TIMESTAMPTZ,
  agent_run_id        BIGINT,
  last_checked_at     TIMESTAMPTZ,
  last_caught         BOOLEAN,
  last_verdict        TEXT,
  last_run_id         BIGINT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT eval_cases_case_key_key UNIQUE (case_key),
  CONSTRAINT eval_cases_dataset_check
    CHECK (dataset IN ('golden', 'adversarial', 'regression', 'holdout', 'fresh_audit')),
  CONSTRAINT eval_cases_status_check
    CHECK (status IN ('candidate', 'active', 'retired')),
  CONSTRAINT eval_cases_severity_check
    CHECK (severity IN ('critical', 'major', 'minor', 'info')),
  CONSTRAINT eval_cases_label_provenance_check
    CHECK (label_provenance IN ('takedown_confirmed', 'human', 'answer_key'))
);

CREATE INDEX IF NOT EXISTS eval_cases_dataset_status_idx
  ON public.eval_cases (dataset, status);
CREATE INDEX IF NOT EXISTS eval_cases_check_idx
  ON public.eval_cases (check_name, status);
CREATE INDEX IF NOT EXISTS eval_cases_published_idx
  ON public.eval_cases (fee_published_id) WHERE fee_published_id IS NOT NULL;

ALTER TABLE public.eval_cases ENABLE ROW LEVEL SECURITY;
