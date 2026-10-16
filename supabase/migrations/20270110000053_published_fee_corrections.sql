-- #978 H03-T03: versioned admin corrections to published fees, and the review queue for a newer
-- source that disagrees with one.
--
-- A correction never edits a published row. It publishes a new `published_fee_records` row with the
-- corrected values (same lineage), quarantines and closes the old row with an `admin_correction:` reason, and
-- records one version row here: the values before and after, the source document, the excerpt and
-- where it sits, the shared source check's result, the reason, who and when. A reversal is a new
-- version too. Every version of one fee shares `fee_chain_id` (the published row the first
-- correction replaced); exactly one version per chain is current.
--
-- Hamilton's publish step reads the current version before it publishes a re-read of the same fee:
-- a re-read of the old (or the same) source is not published, and a re-read of a newer source that
-- disagrees is written to `published_fee_correction_conflicts` for an admin to review.
--
-- Data: this file only adds two new, empty tables. It changes no existing row and writes none.
-- Code tolerates the tables being absent: the admin Correct action says corrections are not on yet,
-- and publishing skips the correction check. Re-running is safe (IF NOT EXISTS throughout).
-- Rollback: DROP TABLE public.published_fee_correction_conflicts, public.published_fee_corrections;
-- (only before any correction is made; afterwards the quarantined rows' history lives here).

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.published_fee_corrections (
  id                         BIGSERIAL PRIMARY KEY,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fee_chain_id               BIGINT NOT NULL,
  version                    INTEGER NOT NULL,
  action                     TEXT NOT NULL,
  status                     TEXT NOT NULL DEFAULT 'current',
  institution_id             BIGINT NOT NULL,
  fee_audience               TEXT NOT NULL DEFAULT 'unknown',
  variant_type               TEXT,
  previous_fee_published_id  BIGINT NOT NULL REFERENCES public.published_fee_records(fee_published_id),
  fee_published_id           BIGINT NOT NULL REFERENCES public.published_fee_records(fee_published_id),
  before_canonical_fee_key   TEXT NOT NULL,
  before_fee_name            TEXT NOT NULL,
  before_amount              NUMERIC(12,2),
  before_frequency           TEXT,
  before_conditions          TEXT,
  canonical_fee_key          TEXT NOT NULL,
  fee_name                   TEXT NOT NULL,
  amount                     NUMERIC(12,2) NOT NULL,
  frequency                  TEXT,
  conditions                 TEXT,
  source_document_id         BIGINT REFERENCES public.source_documents(id),
  source_excerpt             TEXT,
  source_location            TEXT,
  source_check               JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason                     TEXT NOT NULL,
  actor_user_id              BIGINT NOT NULL,
  actor_name                 TEXT NOT NULL,
  idempotency_key            TEXT NOT NULL,
  agent_run_id               INTEGER REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  superseded_at              TIMESTAMPTZ,
  superseded_by_id           BIGINT REFERENCES public.published_fee_corrections(id),
  CONSTRAINT published_fee_corrections_idempotency_key_key UNIQUE (idempotency_key),
  CONSTRAINT published_fee_corrections_fee_published_id_key UNIQUE (fee_published_id),
  CONSTRAINT published_fee_corrections_chain_version_key UNIQUE (fee_chain_id, version),
  CONSTRAINT published_fee_corrections_version_check CHECK (version >= 1),
  CONSTRAINT published_fee_corrections_action_check CHECK (action IN ('correct', 'reverse')),
  CONSTRAINT published_fee_corrections_status_check CHECK (
    (status = 'current' AND superseded_at IS NULL)
    OR (status = 'superseded' AND superseded_at IS NOT NULL)),
  CONSTRAINT published_fee_corrections_amount_check CHECK (amount >= 0),
  CONSTRAINT published_fee_corrections_reason_check CHECK (length(btrim(reason)) >= 5),
  -- A correction carries its evidence; a reversal returns to values already on record.
  CONSTRAINT published_fee_corrections_evidence_check CHECK (
    action = 'reverse'
    OR (source_document_id IS NOT NULL
        AND length(btrim(COALESCE(source_excerpt, ''))) > 0
        AND length(btrim(COALESCE(source_location, ''))) > 0))
);

CREATE UNIQUE INDEX IF NOT EXISTS published_fee_corrections_current_idx
  ON public.published_fee_corrections (fee_chain_id) WHERE status = 'current';
CREATE INDEX IF NOT EXISTS published_fee_corrections_institution_idx
  ON public.published_fee_corrections (institution_id, status);

COMMENT ON TABLE public.published_fee_corrections IS
  'Admin corrections to published fees (#978 H03): one row per version, never updated except to mark it superseded. The live value is the current version''s fee_published_id.';

CREATE TABLE IF NOT EXISTS public.published_fee_correction_conflicts (
  id                         BIGSERIAL PRIMARY KEY,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fee_chain_id               BIGINT NOT NULL,
  correction_id              BIGINT NOT NULL REFERENCES public.published_fee_corrections(id),
  institution_id             BIGINT NOT NULL,
  fee_verified_id            BIGINT NOT NULL,
  source_document_id         BIGINT,
  canonical_fee_key          TEXT NOT NULL,
  fee_name                   TEXT NOT NULL,
  amount                     NUMERIC(12,2),
  frequency                  TEXT,
  agent_run_id               INTEGER REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  status                     TEXT NOT NULL DEFAULT 'open',
  resolved_at                TIMESTAMPTZ,
  resolved_by_user_id        BIGINT,
  resolved_by_name           TEXT,
  resolution_reason          TEXT,
  resolved_by_correction_id  BIGINT REFERENCES public.published_fee_corrections(id),
  CONSTRAINT published_fee_correction_conflicts_candidate_key UNIQUE (fee_chain_id, fee_verified_id),
  CONSTRAINT published_fee_correction_conflicts_status_check CHECK (
    (status = 'open' AND resolved_at IS NULL)
    OR (status IN ('accepted', 'dismissed') AND resolved_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS published_fee_correction_conflicts_open_idx
  ON public.published_fee_correction_conflicts (institution_id) WHERE status = 'open';

COMMENT ON TABLE public.published_fee_correction_conflicts IS
  'A newer source document that disagrees with an admin correction (#978 H03-T07). Hamilton does not publish it; an admin accepts it (by correcting from that document) or dismisses it with a reason.';

ALTER TABLE public.published_fee_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.published_fee_correction_conflicts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.published_fee_corrections, public.published_fee_correction_conflicts FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.published_fee_corrections, public.published_fee_correction_conflicts FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.published_fee_corrections, public.published_fee_correction_conflicts FROM authenticated;
  END IF;
END $$;
