# A refunded report kept its paid status and its private link

**Found:** 9 Oct 2026, by UAT, after the first live $1 report sale (lead 23, paid 12:33:44 UTC, refunded 12:38:20 UTC).

**What happened:** `stripe_events` recorded the payment (`checkout.session.completed`) but no refund event. The live webhook endpoint subscribes to a list of events, and `charge.refunded` was not on that list. The webhook handler had no case for refunds either. Lead 23 stayed `paid`, and its private report link (an HMAC token tied to the institution, not to the lead) kept opening.

**Fix:** the webhook now handles `charge.refunded`. A full refund of a report charge sets `leads.refunded_at` (migration 20270110000039) and status `refunded`, and alerts James. `/market-report/<token>` and its CSV return 404 when every paid report for that institution has been refunded. The pay page says the payment was refunded. `/admin/stripe/webhook-check` now lists `charge.refunded` as required.

**Still needed by hand:** add `charge.refunded` to the Stripe webhook endpoint (Developers > Webhooks > the feeinsight.com endpoint > Add events). Until then Stripe sends no refund events.
