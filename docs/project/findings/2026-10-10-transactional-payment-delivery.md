# Payment confirmation and its delivery obligations commit together

R03 / #983. Stacked after R04 (which already includes R02); this is a payment
reliability fix, not a new agent, provider platform, marketing flow, or fee pipeline.

The Stripe webhook now records immutable recipient-specific email envelopes in
the same transaction as event deduplication and payment changes. It sends only
after commit. A repeated signed event drains the existing obligations instead
of skipping them, and returns 503 while safe retries are pending. Existing Stripe
redelivery plus administrator retry advances the queue; no new scheduler runs.
Historical processed events are NOT automatically backfilled or replayed.

Workers claim a 90-second lease with FOR UPDATE SKIP LOCKED and record receipts
only while still owning that lease. Requests to the email provider time out after
10 seconds. Retried sends reuse the same envelope and provider idempotency key.
There are at most six attempts; ambiguous attempts older than 23 hours require
operator review rather than resend beyond the provider's 24-hour guarantee.
No system can infer whether an unreceipted external email was sent after that
window, so the queue explicitly refuses to guess. Provider acceptance is not
inbox delivery; the existing send log/webhooks remain the delivery-event record.

Customer and administrator messages have separate rows. A failed recipient does
not resend another accepted recipient. Missing email configuration does not consume
attempts. A paid report without a link becomes a visible review item rather than
a false completed delivery. Refunded customer messages are canceled when claimed;
this is a pre-send state check, not a claim of atomicity with a later refund.

Administrators see the latest 50 jobs in Publishing, retry eligible pending work,
and can record manual resolution of review items with their authenticated user id
and a required note. Non-admin callers cannot invoke recovery actions or read this
new panel. Review jobs cannot be blindly retried by changing form inputs.
Migration 20270110000043 adds a private, RLS-enabled table with API-role access
revoked. Payloads include email content and private report links: treat them as
sensitive operational records. No public queue endpoint is introduced.

Deploy Pinnacle migrations 40/41 first, then reviewed checkout migration 42 and payment outbox migration 43 before code activation. Direct migration-history reads show production still ends at 20270110000039. Pinnacle's preview has 40/41 and the R04 preview has the superseded checkout 40. The canonical payment files are now 42/43; no payment migration was applied to production. Do not delete the outbox or replay Stripe history during rollback.
If rolling back the application, pause checkout/fulfillment and reconcile pending
obligations manually; the former webhook lacks recovery guarantees.

Executed tests cover transactional rollback, post-commit interruption, acceptance
without a recorded receipt, concurrent workers, stale-worker fencing, independent
recipients, missing configuration, safe-window expiry, attempt limits, refunds,
missing report links, admin authorization, and denied public database access.
Database tests use disposable loopback PostgreSQL with a deterministic email double.
They do not demonstrate live Stripe/Resend behavior, inbox delivery, production
migration execution, authenticated browser usability, or fee-data accuracy.

Activation telemetry remains best effort and runs only for a freshly committed
event, never for a delivery retry. Payment state remains the authoritative
activation record; email retry is not a new sale.

Provider contract: https://resend.com/docs/dashboard/emails/idempotency-keys
