-- research_usage baseline. The table was created at runtime by
-- src/lib/research/history.ts; it now also backs the per-user daily Hamilton AI
-- quota (src/lib/hamilton/quota.ts), so it is declared here with the index the quota
-- query uses. Idempotent: matches the runtime definition exactly.

BEGIN;

CREATE TABLE IF NOT EXISTS public.research_usage (
  id                    SERIAL PRIMARY KEY,
  user_id               INTEGER,
  ip_address            TEXT,
  agent_id              TEXT NOT NULL,
  input_tokens          INTEGER NOT NULL DEFAULT 0,
  output_tokens         INTEGER NOT NULL DEFAULT 0,
  estimated_cost_cents  INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_research_usage_user_date ON public.research_usage (user_id, created_at);

ALTER TABLE public.research_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.research_usage FROM PUBLIC, anon, authenticated;

COMMIT;
