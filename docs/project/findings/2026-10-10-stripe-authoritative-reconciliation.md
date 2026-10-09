# Reconcile subscription access from current Stripe state

R02 / issue #983. Subscription lifecycle events, subscription invoice payments,
and subscription invoice failures now share one reconciliation path. The handler
takes a customer-specific PostgreSQL transaction advisory lock before reading
Stripe, reads all current subscription pages, and writes the account state inside
the event-recording transaction. It never ranks deliveries by event.created or
applies an old status snapshot over newer state.

The inventory read has bounded pagination, an overall 20-second deadline, and
no hidden SDK retry loop. A truncated page or upstream failure throws, so the
existing transaction and event deduplication roll back and Stripe can redeliver.
Another active subscription wins over cancellation of an older one. invoice.paid
can recover a past-due account. Existing grace timing is retained; admin and
analyst rows are excluded from billing updates. One-off/report invoices do not
alter Pro access. Report payment, duplicate-payment, and refund code is retained.

Checkout links only its own user or legacy email and never replaces a different
customer id. Its welcome is conditional on current active state and a previously
non-active account, so a delayed checkout cannot resurrect canceled access.

Regression coverage includes delayed failures, delayed active snapshots, current
multi-subscription state, lock-before-read ordering, pagination failure, staff
exclusion, grace preservation, invoice recovery, free checkouts, institution
anchoring, and the existing report/refund cases. Tests use isolated doubles;
real PostgreSQL lock contention and Stripe test-mode end-to-end verification
remain acceptance requirements, not results claimed by this change.

Stripe event delivery contract: https://docs.stripe.com/webhooks
