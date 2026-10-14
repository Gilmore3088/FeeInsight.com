-- Every change names the number it should move, and is checked a week later (#1106 step 2,
-- approved by James on 2026-10-12).
--
-- One row per (PR, metric) named in src/lib/agents/deming/should-move.json. Deming's
-- `deming-change-outcomes` step (Atlas's daily scoreboard run) writes the row the first day it
-- sees the entry, with that day's scoreboard value, and 7 days later the after value and a
-- verdict: moved_as_expected, no_change or wrong_way (unreadable when the scoreboard does not
-- hold the number).
--
-- Data: schema only. Creates an empty table; changes no existing rows.

CREATE TABLE IF NOT EXISTS public.change_outcomes (
  id                    BIGSERIAL PRIMARY KEY,
  pr_number             INTEGER NOT NULL,
  issue_number          INTEGER,
  metric                TEXT NOT NULL,
  direction             TEXT NOT NULL,
  min_change            NUMERIC,
  note                  TEXT,
  first_seen_date       DATE NOT NULL,
  before_snapshot_date  DATE,
  before_value          NUMERIC,
  after_snapshot_date   DATE,
  after_value           NUMERIC,
  verdict               TEXT NOT NULL DEFAULT 'pending',
  checked_at            TIMESTAMPTZ,
  agent_run_id          BIGINT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT change_outcomes_pr_metric_key UNIQUE (pr_number, metric),
  CONSTRAINT change_outcomes_direction_check CHECK (direction IN ('up', 'down')),
  CONSTRAINT change_outcomes_verdict_check
    CHECK (verdict IN ('pending', 'moved_as_expected', 'no_change', 'wrong_way', 'unreadable'))
);

CREATE INDEX IF NOT EXISTS change_outcomes_verdict_idx ON public.change_outcomes (verdict, first_seen_date);

ALTER TABLE public.change_outcomes ENABLE ROW LEVEL SECURITY;
