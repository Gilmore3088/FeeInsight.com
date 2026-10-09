-- NIELSEN's contact ranking, stored (growth steps `growth-contacts` and `growth-contact-picks`,
-- `refreshContactPicks` in src/lib/agents/growth/contacts.ts).
--
--   confidence  high / medium / low, from `contactConfidence`
--   pick        'primary' or 'backup' for the institution's first and second buyer contact
--               (`pickContacts`: decision-makers in `rankContacts` order); null for the rest
--   ranked_at   when the agent last wrote role, confidence and pick on this row
--
-- The role stays in the existing `role` column; the agent rewrites it with today's rules.
--
-- Data: schema only. Adds three nullable columns; no existing row changes. Existing rows are
-- filled by the `growth-contact-picks` step on the run ledger, not by SQL.

ALTER TABLE public.prospect_contacts
  ADD COLUMN IF NOT EXISTS confidence text CHECK (confidence IN ('high', 'medium', 'low')),
  ADD COLUMN IF NOT EXISTS pick text CHECK (pick IN ('primary', 'backup')),
  ADD COLUMN IF NOT EXISTS ranked_at timestamptz;
