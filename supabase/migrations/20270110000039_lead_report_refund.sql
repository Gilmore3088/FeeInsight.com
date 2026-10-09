-- When Stripe refunded a paid institution report in full (charge.refunded webhook).
-- A refunded request's private report link stops opening. Adds one nullable column;
-- changes no existing rows.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS refunded_at timestamptz;
