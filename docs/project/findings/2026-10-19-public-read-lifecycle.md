# 2026-10-19: expired profile budgets still started optional database work

**What happened:** On Oct 19 at 17:42 and 17:43 UTC, canonical Morton profile
requests returned HTTP 500 on cold cache misses. Production logs showed the existing
8/10/15-second institution deadlines and the pooler's "No server connection available"
queue notice across unrelated institutions. A focused fee page was healthy, but that
does not establish a cache hit or a fee-data cause. This follows #1919's deadline repair;
#1811 owns wider ISR coverage. The independent signed-in client-manifest failure is #2319.

**Cause:** #2320 identifies a concrete amplification seam: eager promises start before
the budget can decline them. In the actual profile, optional financial context can
consume the remaining budget and the subsequent registry/index/sample reads still start.
The deadline race also drops its reference to pending work without retaining the request
lifecycle. A read-only production snapshot showed aged ClientRead waits on both route
audit INSERTs and an institution identity SELECT. ClientRead means the backend is awaiting
client protocol; it does not identify a particular HTTP request or prove all pool pressure
comes from this defect.

**Fix:** Read budgets accept lazy factories, and institution layout, metadata and page
use them at the existing call sites. Expired factories do not run. A Next adapter retains
an already-started abandoned promise with `after`, once across shared cached reads, and
logs late failure. The pure budget stays framework independent. Existing eager callers
remain compatible. Required/optional outcomes, numerical deadlines, query expressions,
fallbacks, page templates and cache controls stay the same. There is no cancellation,
retry, new query or timeout increase. The underlying statement can still fail or outlast
the platform's request lifetime; this is a bounded amplification/lifecycle repair, not a
claim that all database saturation is resolved.

**Lesson:** A deadline must govern whether optional work starts, as well as how long
the response waits. Keep already-started transport work attached to the request lifecycle.
Do not infer CPU activity or exact request attribution from a client-protocol wait alone.

**Guard:** `page-deadline.test.tsx` proves the actual profile starts no later registry,
index or sample reads after optional context exhausts the budget; `read-deadline.test.ts`
and `public-read-budget.test.ts` cover expiry, settled work, shared-promise retention,
late rejection and unavailable request context. `public-read-budget.db.test.ts` uses owned
loopback clients and an observed PostgreSQL lock dependency to prove late success/error
settle and the same client remains reusable, without cancellation or application writes.
