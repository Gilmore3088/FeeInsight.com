-- 001-payments.sql: Add Stripe payment columns and webhook event log
-- Forward-only migration. Rollback requires table rebuild or Litestream restore.

-- Extend users table with payment-related columns
-- These columns may already exist if migration ran partially; ALTER TABLE ADD COLUMN
-- in SQLite is a no-op if the column exists (will error, caught by runner).

ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE users ADD COLUMN subscription_status TEXT DEFAULT 'none';

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email
  ON users(email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_stripe_customer
  ON users(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

-- Webhook event log for idempotent processing
-- id: Stripe event ID (evt_xxx), used for INSERT OR IGNORE idempotency
CREATE TABLE IF NOT EXISTS stripe_events (
  id                TEXT PRIMARY KEY,
  event_type        TEXT NOT NULL,
  stripe_customer_id TEXT,
  payload_json      TEXT NOT NULL,
  processed_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_stripe_events_type ON stripe_events(event_type);
