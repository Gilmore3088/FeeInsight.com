# 2026-10-19: an expired read budget could start another lazy read

**Cause:** The deadline race used a real timer, while `remaining()` recomputed its
answer from the supplied clock. After the timer expired, an earlier clock reading
could still report time left and start a later lazy factory. Observing zero and then
moving the clock backward had the same problem. The supported injected clock
reproduced both paths in the actual helper; an ordinary successful read was the
positive control. This does not establish the cause of the separate public native
test's earlier CI HTTP 500. Its exact cause remains unknown; the independent five-case
native diagnostic did not reproduce that failure.

**Fix:** Expiry is terminal for one budget after its own timer fires or `remaining()`
observes zero. Later clock movement cannot revive it. A read's unrelated error,
including its own `ReadDeadlineError`, does not expire the budget. Existing optional
fallbacks, required-error catch-and-continue, started-work retention and numerical
deadlines stay unchanged. No reads are cancelled, retried or newly scheduled.

**Guard:** `src/lib/read-deadline.test.ts` covers real-timer expiry with an earlier
injected clock, observed zero followed by rollback, and an unrelated source deadline
error. Its existing ordinary/error/sibling controls remain. The unchanged
`src/lib/public-read-budget.test.ts` and `src/lib/public-read-budget.db.test.ts` cover
the adapter and five actual Next/HTTP/owned PostgreSQL lifecycle modes. Native tests
use SELECT/advisory locks only, preserve their original assertions and time limits,
and make no application-data writes. This is a helper contract repair, not a claim
that database saturation or every intermittent request failure is resolved.
