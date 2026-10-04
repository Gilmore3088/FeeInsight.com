-- Payment-failure grace period for Pro subscribers.
--
-- users.past_due_since records when a subscription first went past_due (first
-- invoice.payment_failed). Access stays open for 7 days from then (see
-- src/lib/access.ts PAST_DUE_GRACE_DAYS) while the subscriber is shown an
-- "update card" banner; it is cleared when the subscription is active again.
--
-- Additive and idempotent. The app reads the column through to_jsonb(users.*), so
-- code deployed before this migration keeps working.

BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS past_due_since TIMESTAMPTZ;

UPDATE public.users
   SET past_due_since = NOW()
 WHERE subscription_status = 'past_due'
   AND past_due_since IS NULL;

COMMIT;
