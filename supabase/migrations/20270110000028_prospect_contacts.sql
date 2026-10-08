-- NIELSEN's contact finder (growth step `growth-contacts`, src/lib/agents/growth/contacts.ts).
--
--   prospect_contacts        email addresses an institution publishes on its own website, with
--                            the name and title printed beside each one when the page shows them
--   prospect_contact_checks  one row per institution: when its site was last read and what it gave
--
-- Only published addresses are stored; nothing is guessed. Nothing sends from these tables:
-- they feed outreach drafts that James reads and sends himself.
--
-- Data: creates two empty tables. No existing row changes.

CREATE TABLE IF NOT EXISTS public.prospect_contacts (
  id bigserial PRIMARY KEY,
  institution_id bigint NOT NULL,
  email text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('person', 'general')),
  name text,
  title text,
  role text NOT NULL,
  source_url text NOT NULL,
  context text,
  agent_run_id bigint,
  found_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (institution_id, email)
);

CREATE INDEX IF NOT EXISTS prospect_contacts_role_idx ON public.prospect_contacts (kind, role);

CREATE TABLE IF NOT EXISTS public.prospect_contact_checks (
  institution_id bigint PRIMARY KEY,
  checked_at timestamptz NOT NULL DEFAULT now(),
  pages_fetched integer NOT NULL DEFAULT 0,
  emails_found integer NOT NULL DEFAULT 0,
  outcome text NOT NULL CHECK (outcome IN ('found', 'none', 'blocked', 'unreachable')),
  agent_run_id bigint
);

-- Server-side only: the app reads and writes these through its own database connection.
ALTER TABLE public.prospect_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_contact_checks ENABLE ROW LEVEL SECURITY;
