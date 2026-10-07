-- Custom peer groups: a bank picks its own peers and every Pro chart follows that choice.
-- Adds nullable columns to saved_peer_sets for hand-picked institutions, states, the
-- workspace (institution) a set belongs to so teammates share it, and a default flag.
-- Schema only: adds columns and indexes and changes no existing data. Existing rows keep
-- their values; the new columns read NULL (is_default reads false).

BEGIN;

ALTER TABLE public.saved_peer_sets
  ADD COLUMN IF NOT EXISTS institution_ids INTEGER[],
  ADD COLUMN IF NOT EXISTS states          TEXT[],
  ADD COLUMN IF NOT EXISTS institution_id  INTEGER REFERENCES public.institution_sources(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_default      BOOLEAN NOT NULL DEFAULT false;

-- Workspace sets are read by institution.
CREATE INDEX IF NOT EXISTS idx_saved_peer_sets_institution
  ON public.saved_peer_sets (institution_id, created_at DESC)
  WHERE institution_id IS NOT NULL;

-- One default per workspace.
CREATE UNIQUE INDEX IF NOT EXISTS saved_peer_sets_one_default_per_institution
  ON public.saved_peer_sets (institution_id)
  WHERE is_default AND institution_id IS NOT NULL;

-- One default per user among their personal (no workspace) sets.
CREATE UNIQUE INDEX IF NOT EXISTS saved_peer_sets_one_personal_default_per_user
  ON public.saved_peer_sets (created_by)
  WHERE is_default AND institution_id IS NULL;

ALTER TABLE public.saved_peer_sets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.saved_peer_sets FROM PUBLIC, anon, authenticated;

COMMIT;
