-- Email subscription state for leads captured by the contextual public placements.
-- Double opt-in: email_confirmed_at is set when the signed confirm link is used;
-- email_unsubscribed_at is set by the signed unsubscribe link or RFC 8058 one-click.
-- Additive and nullable: /api/leads capture does not depend on these columns, only
-- /api/leads/subscription does. Sales pipeline status stays in leads.status.

BEGIN;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_confirmed_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_unsubscribed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS leads_lower_email_idx ON leads (lower(email));

COMMIT;
