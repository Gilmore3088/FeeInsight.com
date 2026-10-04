-- Answer key and scoreboard: the pipeline's measuring stick.
--
--   * answer_key_institutions: ~60 hand-checked institutions. Each holds the correct
--     fee document (URL, type, optional content hash), who confirmed it and when, and
--     a status: 'prefilled' (drafted from stored text, not yet checked by a person)
--     or 'confirmed' (a person checked the document and every fee row).
--   * answer_key_fees: the fees a correct pipeline must publish for that document,
--     one row per fee, keyed by canonical fee key (src/lib/fee-taxonomy.ts).
--     amount_kind says how the amount compares: 'fixed' (within 1 cent), 'free'
--     ($0) or 'varies' (category only; amount is NULL).
--   * answer_key_score_runs: one row per Atlas score-answer-key step. Precision and
--     recall overall (end to end: what Hamilton published), per stage, per fee
--     category, per document type and per institution.
--   * pipeline_scoreboard_snapshots: one row per day with the six scoreboard numbers
--     (coverage, right-document rate, Knox yield, depth, accuracy, freshness).
--
-- Additive and idempotent. The app probes for these tables before using them, so
-- deploying the code before this migration only hides the answer key and scoreboard.

BEGIN;

CREATE TABLE IF NOT EXISTS public.answer_key_institutions (
  id                BIGSERIAL PRIMARY KEY,
  institution_id    BIGINT NOT NULL REFERENCES public.institution_sources(id) ON DELETE CASCADE,
  document_url      TEXT NOT NULL,
  document_type     TEXT NOT NULL DEFAULT 'html',
  content_hash      TEXT,
  status            TEXT NOT NULL DEFAULT 'prefilled',
  notes             TEXT,
  prefill_source    TEXT,
  prefilled_at      TIMESTAMPTZ,
  confirmed_by      TEXT,
  confirmed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT answer_key_institutions_institution_key UNIQUE (institution_id),
  CONSTRAINT answer_key_institutions_document_type_check
    CHECK (document_type IN ('html', 'text_pdf', 'scanned_pdf', 'js_page')),
  CONSTRAINT answer_key_institutions_status_check
    CHECK (status IN ('prefilled', 'confirmed'))
);

CREATE TABLE IF NOT EXISTS public.answer_key_fees (
  id                          BIGSERIAL PRIMARY KEY,
  answer_key_institution_id   BIGINT NOT NULL REFERENCES public.answer_key_institutions(id) ON DELETE CASCADE,
  canonical_key               TEXT NOT NULL,
  amount                      NUMERIC(12,2),
  amount_kind                 TEXT NOT NULL DEFAULT 'fixed',
  frequency                   TEXT,
  conditions                  TEXT,
  source_line                 TEXT,
  uncertain                   BOOLEAN NOT NULL DEFAULT false,
  status                      TEXT NOT NULL DEFAULT 'prefilled',
  confirmed_by                TEXT,
  confirmed_at                TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT answer_key_fees_amount_kind_check
    CHECK (amount_kind IN ('fixed', 'free', 'varies')),
  CONSTRAINT answer_key_fees_amount_check
    CHECK ((amount_kind = 'fixed' AND amount IS NOT NULL AND amount >= 0)
        OR (amount_kind = 'free' AND (amount IS NULL OR amount = 0))
        OR (amount_kind = 'varies' AND amount IS NULL)),
  CONSTRAINT answer_key_fees_status_check
    CHECK (status IN ('prefilled', 'confirmed'))
);

CREATE INDEX IF NOT EXISTS answer_key_fees_institution_idx
  ON public.answer_key_fees (answer_key_institution_id);

CREATE TABLE IF NOT EXISTS public.answer_key_score_runs (
  id                BIGSERIAL PRIMARY KEY,
  agent_run_id      BIGINT,
  scorer_version    INTEGER NOT NULL DEFAULT 1,
  banks_scored      INTEGER NOT NULL DEFAULT 0,
  fees_expected     INTEGER NOT NULL DEFAULT 0,
  precision         NUMERIC(6,4),
  recall            NUMERIC(6,4),
  by_stage          JSONB NOT NULL DEFAULT '{}'::jsonb,
  by_category       JSONB NOT NULL DEFAULT '{}'::jsonb,
  by_document_type  JSONB NOT NULL DEFAULT '{}'::jsonb,
  by_bank           JSONB NOT NULL DEFAULT '[]'::jsonb,
  scored_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS answer_key_score_runs_scored_at_idx
  ON public.answer_key_score_runs (scored_at DESC);

CREATE TABLE IF NOT EXISTS public.pipeline_scoreboard_snapshots (
  id                        BIGSERIAL PRIMARY KEY,
  snapshot_date             DATE NOT NULL,
  agent_run_id              BIGINT,
  coverage_rate             NUMERIC(6,4),
  coverage_numerator        INTEGER,
  coverage_denominator      INTEGER,
  right_document_rate       NUMERIC(6,4),
  right_document_numerator  INTEGER,
  right_document_denominator INTEGER,
  knox_yield                NUMERIC(8,4),
  knox_yield_fees           INTEGER,
  knox_yield_priced_lines   INTEGER,
  knox_yield_sample_size    INTEGER,
  depth_median_categories   NUMERIC(8,2),
  depth_live_institutions   INTEGER,
  accuracy_precision        NUMERIC(6,4),
  accuracy_recall           NUMERIC(6,4),
  accuracy_score_run_id     BIGINT,
  freshness_median_days     NUMERIC(10,2),
  freshness_live_fees       INTEGER,
  detail                    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pipeline_scoreboard_snapshots_date_key UNIQUE (snapshot_date)
);

ALTER TABLE public.answer_key_institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.answer_key_fees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.answer_key_score_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_scoreboard_snapshots ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.answer_key_institutions, public.answer_key_fees,
  public.answer_key_score_runs, public.pipeline_scoreboard_snapshots FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.answer_key_institutions, public.answer_key_fees,
      public.answer_key_score_runs, public.pipeline_scoreboard_snapshots FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.answer_key_institutions, public.answer_key_fees,
      public.answer_key_score_runs, public.pipeline_scoreboard_snapshots FROM authenticated;
  END IF;
END $$;

COMMIT;
