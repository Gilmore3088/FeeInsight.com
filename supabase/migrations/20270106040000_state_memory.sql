-- State experts: one agent design, one memory per state (50 states, DC, PR, VI, GU, AS).
--
-- The `state-expert` lane step (Atlas, deterministic, no provider calls) refreshes a
-- state's row at the start of each full lane pass:
--   expert_name / expert_bio  the state's named expert (roster in src/lib/agents/state-expert/roster.ts)
--   regulator                 chartering agency from state_regulators
--   platforms                 common website platforms among the state's banks
--   strategies                finder/reader strategies ranked by success in pipeline_attempts
--   peer_levels               p25/median/p75 and count per canonical fee and asset-size tier,
--                             from published_fee_catalog
-- Darwin's peer check and Hamilton's report hook read it. Code tolerates this table
-- being absent: the step reports "memory not stored" and Darwin computes peer levels
-- from published_fee_catalog directly.

CREATE TABLE IF NOT EXISTS public.state_memory (
  state_code          TEXT PRIMARY KEY,
  expert_name         TEXT NOT NULL,
  expert_bio          TEXT NOT NULL,
  regulator           JSONB NOT NULL DEFAULT '{}'::jsonb,
  platforms           JSONB NOT NULL DEFAULT '[]'::jsonb,
  strategies          JSONB NOT NULL DEFAULT '{}'::jsonb,
  peer_levels         JSONB NOT NULL DEFAULT '[]'::jsonb,
  institution_count   INTEGER NOT NULL DEFAULT 0,
  published_fee_count INTEGER NOT NULL DEFAULT 0,
  last_agent_run_id   BIGINT,
  refreshed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT state_memory_state_code_check
    CHECK (state_code = upper(state_code) AND length(state_code) BETWEEN 2 AND 3)
);

ALTER TABLE public.state_memory ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.state_memory FROM anon, authenticated;
