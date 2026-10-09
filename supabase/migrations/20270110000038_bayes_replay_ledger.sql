-- Bayes's replay ledger (Agentic OS PRD section 8). One replay_jobs row per declared change
-- (a rule or parser version that should reach records an older version processed), and one
-- replay_job_checks row each time Bayes counts it. Checks are appended, never rewritten, so a
-- job's history shows whether its queue is moving.
-- Written only by src/lib/agents/bayes/ledger.ts (the `bayes-replay-ledger` step).
--
--   change_key     '<manifest key>@<version>', e.g. 'knox.rules@62'; one job per change
--   unit           what one counted record is (a current-copy text, a registry partition, a run)
--   affected       records an older version processed (or the run the change needs)
--   done           records already processed at this version
--   queued         records the owning agent's own selection will process again
--   excluded       records the owner deliberately leaves on the older result, by reason
--   status         open | closed (nothing queued) | stuck (queue not moving) | not_counted
--
-- Data: schema only. Creates two empty tables and indexes; changes no existing rows.

CREATE TABLE IF NOT EXISTS public.replay_jobs (
  id               BIGSERIAL PRIMARY KEY,
  change_key       TEXT NOT NULL,
  manifest_key     TEXT NOT NULL,
  owner_agent      TEXT NOT NULL,
  stage            TEXT,
  strategy         TEXT,
  version          INTEGER,
  unit             TEXT NOT NULL,
  affects          TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'open',
  affected         INTEGER NOT NULL DEFAULT 0,
  done             INTEGER NOT NULL DEFAULT 0,
  queued           INTEGER NOT NULL DEFAULT 0,
  excluded         INTEGER NOT NULL DEFAULT 0,
  exclusions       JSONB NOT NULL DEFAULT '{}'::jsonb,
  note             TEXT,
  opened_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at        TIMESTAMPTZ,
  last_checked_at  TIMESTAMPTZ,
  last_run_id      BIGINT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT replay_jobs_change_key_key UNIQUE (change_key),
  CONSTRAINT replay_jobs_status_check CHECK (status IN ('open', 'closed', 'stuck', 'not_counted'))
);

CREATE INDEX IF NOT EXISTS replay_jobs_status_idx ON public.replay_jobs (status, manifest_key);

CREATE TABLE IF NOT EXISTS public.replay_job_checks (
  id            BIGSERIAL PRIMARY KEY,
  job_id        BIGINT NOT NULL REFERENCES public.replay_jobs (id),
  agent_run_id  BIGINT,
  status        TEXT NOT NULL,
  affected      INTEGER NOT NULL,
  done          INTEGER NOT NULL,
  queued        INTEGER NOT NULL,
  excluded      INTEGER NOT NULL,
  exclusions    JSONB NOT NULL DEFAULT '{}'::jsonb,
  note          TEXT,
  checked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS replay_job_checks_job_idx ON public.replay_job_checks (job_id, checked_at DESC);

ALTER TABLE public.replay_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.replay_job_checks ENABLE ROW LEVEL SECURITY;
