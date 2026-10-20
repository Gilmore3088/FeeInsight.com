# 2026-10-19: Hoovie read "the fetch finished" as "the data is there"
**What happened:** Three Hoovie review findings, one cause. The `industry-events` partition
`ncua-mergers` ran on 2026-10-17 (run 8051). Both NCUA addresses returned 404 and the run recorded
it as `empty`. Source health counted that as a successful check, and the source's other families
kept it "fresh", so no credit union merger has ever loaded and nothing flagged it (#2306). Source
health also used the newest successful fetch, including old-period backfills, empty checks and
partial loads, as its only freshness signal, so a source could look healthy while its newest
period was missing (#2228). The generic archived call-report reader turned a blank value into 0
(#2315).
**Cause:** Each step recorded a finished run or read as valid data. `fetchPublishedList` returned
an empty list when no landing page answered. `getRegistryFeedFreshness` counted any unblocked
empty partition as a success. No reader compared the newest expected period with what had
actually loaded. `readColdCallRows` ran `Number(value)` before it checked whether a value was
there.
**Fix:** This PR. When every landing page fails, the loader now throws
`RegistryUnreachableError`, recorded as `failure_kind: landing_pages_unreachable` with the pages
it tried. Freshness counts those receipts, and older empty receipts whose every page failed, as
`unreachable`, never as a success, and source health fails the source and names the partition.
Each source now reports its newest-period completeness (`hoovie/period-completeness.ts`) apart
from fetch health. Daily-polled feeds carry `checkEveryHours`, so they go stale after 3 days
instead of the irregular 90. Archived rows with a missing value are left out and named, never
read as 0.
**Lesson:** Only rows actually loaded can show that data is there. A step that finished and found
nothing has to say why: the publisher had nothing new, no page answered, or the value was
missing. Only the first is a success.
**Guard:** `src/lib/regulatory/industry-events.test.ts` (all-404 lists throw),
`src/lib/agents/magellan/registry/failure.db.test.ts` (the run 8051 shape is never a success),
`src/lib/agents/hoovie/source-health.test.ts` and `period-completeness.test.ts` (no release yet,
late release, partial coverage, allowed-empty checks), `src/lib/data-catalog/cold-reads.test.ts`
(missing is not zero).
