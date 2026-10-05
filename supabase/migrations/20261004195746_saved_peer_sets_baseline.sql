-- saved_peer_sets baseline. The table was created at runtime by
-- src/lib/data-store/saved-peers.ts (CREATE TABLE IF NOT EXISTS on every read); it is
-- declared here instead so reads issue no DDL. Idempotent: matches the runtime
-- definition exactly, and adds the index the per-user lookups use.

BEGIN;

CREATE TABLE IF NOT EXISTS public.saved_peer_sets (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  tiers         TEXT,
  districts     TEXT,
  charter_type  TEXT,
  created_by    TEXT NOT NULL,
  created_at    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_peer_sets_created_by ON public.saved_peer_sets (created_by, created_at DESC);

ALTER TABLE public.saved_peer_sets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.saved_peer_sets FROM PUBLIC, anon, authenticated;

COMMIT;
