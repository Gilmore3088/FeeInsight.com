# Persist checkout intent before contacting Stripe

R04 / #983. Builds on R02's existing customer lock and authoritative subscription
inventory; do not copy a second billing-state implementation into this branch.
Checkout now commits a user-scoped reservation before making a provider request,
then reuses its UUID, immutable request body, and Stripe idempotency key after
interruptions. A unique partial index and transaction advisory locks serialize
concurrent requests. Current subscriptions and older untracked open subscription
checkouts block a second purchase. Report-payment sessions are not subscriptions.

Changing the plan/institution expires the previous unpaid session before a new
reservation is created. A complete session remains blocked until its subscription
is positively confirmed canceled or incomplete_expired. Unknown ownership,
incomplete inventories, ambiguous expiration, and uncertain old attempts fail
closed. An unreceipted intent older than 23 hours moves to review instead of
reusing a provider key beyond its guaranteed 24-hour deduplication window.
No customer is charged, refunded, or emailed by the tests.

Migration 20270110000042 adds a private RLS-enabled checkout-intent table and
unique indexes. Generated with Supabase CLI and renumbered after the repository's
Pinnacle's reserved 20270110000040/41 migrations after direct history verification. It does not rewrite payments, users, fees, or
subscription state. Deploy the reviewed additive migration before code activation;
production still ends at 20270110000039; no payment migration has been run there. The existing R04 preview recorded the superseded checkout migration as 40, so version 42 validates that pre-existing preview table instead of rewriting preview history. Rolling code back leaves reservations for
recovery and returns to the old, unprotected checkout, so pausing checkout is safer
than dropping the new table while requests may still be running.

Verification includes focused regression tests, PostgreSQL tests on a disposable
loopback-only database, type checks, lint, and repository guards. The integration
suite verifies 16 simultaneous real database transactions create one session,
post-provider response loss recovery, independent customers, rollback survival,
the unique active-intent constraint, and denied access for anon/authenticated.
Stripe is a deterministic test double; real Stripe test-mode browser acceptance
remains required. A generic test run that skips the optional database suite is
not integration proof. Execute it with a disposable local database named
feeinsight_billing_test* and BILLING_TEST_DATABASE_URL explicitly set.

Stripe contract: https://docs.stripe.com/api/idempotent_requests
