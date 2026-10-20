-- GLEIF LEI links for tracked institutions (#1868).
-- Schema only: one new empty table, its indexes and RLS. Changes no existing data.
--
-- One row per tracked institution (institution_sources.id) that the GLEIF registry step has
-- checked. It says which LEI the institution is, and on what basis, or why none was linked:
--   status 'linked'    : exactly one LEI; match_basis says how it was found.
--   status 'ambiguous' : more than one candidate LEI (candidate_leis), or one key shared by
--                        several tracked institutions. Nothing is picked.
--   status 'unmatched' : checked and no LEI found.
-- Rows with status 'ambiguous' or 'unmatched' are the one review queue for LEI links.
--
-- match_basis, strongest first:
--   own_lei      institution_sources.lei
--   rssd         the GLEIF record is registered with the Fed's National Information Center under
--                the institution's RSSD id
--   fdic_cert    registered with the FDIC under the institution's certificate number
--   ncua_charter registered with the NCUA under the institution's charter number
--   name_state   GLEIF's legal name equals the institution's name (case, spacing and punctuation
--                aside) and the legal address is in the institution's state, with exactly one
--                such record. Never a name alone.
-- A key basis always replaces a name_state row. The registry step writes rows in bounded
-- batches under a statement timeout; nothing is written by this migration.
-- RLS on with no policies: service-role reads only, like the other registry tables.
CREATE TABLE IF NOT EXISTS public.institution_lei_links (
  institution_id BIGINT PRIMARY KEY REFERENCES public.institution_sources(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  lei CHAR(20),
  match_basis TEXT,
  -- The key or name|state the match used (an RSSD id, a cert, a charter, or "NAME|ST").
  match_key TEXT,
  candidate_leis TEXT[] NOT NULL DEFAULT '{}',
  -- Plain reason for an ambiguous or unmatched row; null when linked.
  reason TEXT,
  source_url TEXT,
  agent_run_id BIGINT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT institution_lei_links_status_check CHECK (status IN ('linked', 'ambiguous', 'unmatched')),
  CONSTRAINT institution_lei_links_basis_check CHECK (
    match_basis IS NULL OR match_basis IN ('own_lei', 'rssd', 'fdic_cert', 'ncua_charter', 'name_state')
  ),
  CONSTRAINT institution_lei_links_linked_check CHECK (
    (status = 'linked' AND lei IS NOT NULL AND match_basis IS NOT NULL) OR (status <> 'linked' AND lei IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS institution_lei_links_lei_idx
  ON public.institution_lei_links (lei) WHERE lei IS NOT NULL;
CREATE INDEX IF NOT EXISTS institution_lei_links_review_idx
  ON public.institution_lei_links (status, checked_at) WHERE status <> 'linked';

ALTER TABLE public.institution_lei_links ENABLE ROW LEVEL SECURITY;
