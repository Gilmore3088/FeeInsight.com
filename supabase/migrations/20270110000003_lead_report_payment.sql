-- Institution report paid by card through Stripe (James, 6 Oct 2026).
-- James types the quoted price on a report request in /admin/leads; the requester pays
-- through Stripe Checkout at /pay/report/<signed token>; the Stripe webhook records the
-- payment. The price charged is read from quote_amount_cents, never from the link.
-- Additive and nullable: no existing row changes, and every reader treats a missing
-- column as "not quoted", so the app works before and after this runs.

BEGIN;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS quote_amount_cents INTEGER;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS quote_institution_id BIGINT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS quote_sent_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT;

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_quote_amount_positive;
ALTER TABLE leads ADD CONSTRAINT leads_quote_amount_positive
  CHECK (quote_amount_cents IS NULL OR quote_amount_cents > 0);

COMMIT;
