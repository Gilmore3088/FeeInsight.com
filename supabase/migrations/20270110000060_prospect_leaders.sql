-- NIELSEN's contact finder also keeps named leaders (growth step `growth-contacts`,
-- src/lib/agents/growth/contacts.ts). Most bank and credit union sites print their leadership
-- team's names and titles but no email address (138 of 154 comparison-ready sites read by Oct 17).
--
--   prospect_leaders                       a decision-maker's name and title as the institution's
--                                          own leadership page prints them, with no address
--   prospect_contact_checks.leaders_found  leaders the last read kept; null for reads made before
--                                          leaders were kept, so those sites are read again
--
-- Only printed names and titles are stored; no address is guessed from a name. Nothing sends
-- from this table: James reaches a named leader himself.
--
-- Data: creates one empty table and adds one nullable column. No existing row changes.

CREATE TABLE IF NOT EXISTS public.prospect_leaders (
  id bigserial PRIMARY KEY,
  institution_id bigint NOT NULL,
  name text NOT NULL,
  title text NOT NULL,
  role text NOT NULL,
  source_url text NOT NULL,
  context text,
  agent_run_id bigint,
  found_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (institution_id, name)
);

ALTER TABLE public.prospect_contact_checks
  ADD COLUMN IF NOT EXISTS leaders_found integer;

-- Server-side only: the app reads and writes it through its own database connection.
ALTER TABLE public.prospect_leaders ENABLE ROW LEVEL SECURITY;
