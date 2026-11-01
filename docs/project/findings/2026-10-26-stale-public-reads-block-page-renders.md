# 2026-10-26: stale public reads made every institution page wait on catalog-wide recomputes

**Lesson:** A cached page render waits for a stale cache entry to be recomputed. On an ISR
render, Next's `unstable_cache` recomputes a stale entry in the foreground rather than serving
it. So a tag that agents invalidate on every takedown must never make a page wait on a
catalog-wide aggregate. Serve the last good value after a short grace, run one recompute at a
time, and keep per-lookup catalog scans out of page reads.

**What happened:** after the crawler was challenged (Attack Challenge Mode, 03:51 UTC Oct 26;
[crawler finding](2026-10-26-crawler-fee-explorer-starves-institution-pages.md)), its `/fees`
traffic fell about 95%. Institution pages still missed their 15-second read budget in bursts,
for example five pages between 04:02:02 and 04:02:38 UTC.

- **The trigger.** Agent takedowns call `invalidatePublicReadCache()` (about 50 call sites
  across Darwin, Knox and Hamilton). That marks every public aggregate stale.
- **Why renders waited.** In Next 16.4 `unstable_cache` serves a stale entry and refreshes it in
  the background only for plain request renders. When the consumer will cache its own output,
  as an ISR page render does (`willConsumerServerCache`), it awaits the recompute.
- **What the recompute costs.** The national category summaries, comparable market index, peer
  indexes, peer fee values, headline counts and state directory each take 10-50 s under load.
  Each render that met a stale entry ran its own copy. The postgres slow-query log shows the same
  aggregate starting two or three times within a second (03:56:55, 04:01:49, 04:02:07). That
  piled more load on a database already contended.
- **The cost since the Oct 5 stats reset** (`pg_stat_statements`):
  - `getFeeCategorySummaries`: 11,305 calls, 23 s on average. The snapshot is cached for an
    hour, so this means about 540 recomputes a day, not 24.
  - The headline counts: 10,632 calls, 10 s on average.
- **The largest single cost.** The "closest in assets" peer lookup scanned the published-fee
  catalog inside every call (`resolvePeerInstitutionIds`). It ran 123,712 times at 3.3 s on
  average, and each institution page runs one. The scan alone takes 1.5 s on an idle database
  for 4,027 institutions.

**Fix:**
- `cachedPublicRead` (`src/lib/data-store/public-read-cache.ts`):
  - It keeps each server's last good value per call.
  - When a recompute takes longer than `STALE_GRACE_MS` (2 s), the render shows that value and
    calls `shortenPageLife()`, so the page is rebuilt from the refreshed entry a minute later. A
    read that fails within the grace still fails, so the health check still reports it.
  - The recompute keeps running via `after()`.
  - Concurrent misses of the same call on one server share one database read.
  - The cache's tag and lifetime still attach to the page, because the cached call is still made
    on every render.
- The fee-publishing institution list behind "nearest" peers (`src/lib/data-store/peer-sets.ts`)
  is now one cached public read. Each lookup passes the ids instead of scanning the catalog.

**Still open:**
- A server that has never read a value (a cold instance) still waits on a recompute.
- Takedowns still invalidate every public aggregate at once. Batching those invalidations
  (at most one every few minutes), or precomputing the snapshot in the publish step as
  `fee_index_cache` already does for the national index, would remove the recomputes rather
  than hide them.
- `/fees` should become cacheable (crawler finding).

**Guard:** `src/lib/data-store/public-read-cache.test.ts`:
- a slow refresh serves the last good value;
- a fast refresh is waited for;
- a fast failure is still reported;
- concurrent misses share one read.

`src/lib/data-store/peer-sets.test.ts`: the nearest query no longer reads `published_fee_catalog`.
