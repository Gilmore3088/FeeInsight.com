# 2026-11-02: shared-cache recomputes took every connection, so a page's own reads failed

**Lesson:** A server's connection pool is shared by every read a render makes. A read that can
take tens of seconds (a catalog-wide recompute) must not be able to hold all of it, or a burst
turns into errors on reads that take milliseconds. Cap the slow class below the pool size, so the
fast reads keep two connections free from catalog-wide recomputes.

**What happened:** Institution pages had a median of 2.4-3.2 s from 15:05 to 16:10 UTC on Nov 2.
Then, from 16:10 to 16:20, the 5-minute median rose to 20 s, p95 rose to 57 s, and 2 requests
returned 500. The 500s came from Vercel's function duration metrics and request counts.

- **The burst:** a crawler loaded about 20 institution pages a minute. The pooler logged 45
  logins from 8 addresses at 16:14.
- **Catalog-wide recomputes ran at the same time.** The Postgres slow-query log shows them
  concurrently between 16:14 and 16:16:
  - the U.S. comparable index (`getComparableMarketIndex`): four copies at 40-47 s;
  - the fee category summaries: three copies at 25 s;
  - the fee-share cohort and state directory reads: 11-14 s.
- **Each server has 5 connections** (`DATABASE_POOL_MAX`), and those recomputes held all of them.
- **One-row reads queued behind them.** On the same servers, `getPublicInstitutionForPage`
  ("institution", a 10 s required read) and "rate fees" (15 s) waited for a connection and missed
  their deadlines. The page threw, which is the two 500s. Optional reads such as the holding
  company and enforcement actions missed theirs too, so those pages rendered with sections hidden.
- **Nothing was refused.** The pooler refused no connection in this window; the waiting was inside
  each server.

**Fix:** reads marked catalog-wide now run their recomputes in a lane. They are marked with
`cachedPublicRead(..., { catalogWide: true })` in `src/lib/data-store/public-read-cache.ts`, and
the lanes are in `src/lib/data-store/recompute-lanes.ts`.

- **Two fewer lanes than connections:** 3 lanes for a pool of 5, at least 1.
- **Which reads are marked:**
  - the comparable market index;
  - the state and district fee indexes;
  - the fee-share cohort;
  - the headline coverage rows and the peer rank values;
  - the sample report candidates;
  - the fee-publisher list;
  - the deposit totals by state.
- **One query each.** Each marked read runs one query at a time, so between them they hold at
  most three connections.
- **Per-institution reads are not marked,** so they never queue behind a 40 s scan.
- **Waiting costs nothing.** A recompute waiting for a lane holds no connection. A render that
  already has a last good value still stops waiting after the 2 s grace.
- **Nesting runs at once.** A recompute that reads another shared entry from inside its own
  computation does not wait for a second lane.
- **Promotion.** A recompute holding a lane may find the entry it needs already waiting for a lane,
  because a caller outside any lane asked first. It then starts that entry at once. Without this,
  every lane can end up held by a recompute waiting on one that cannot start (found in review).
- **The wait cap drops, it does not run.** A recompute still waiting after 60 s is dropped, not run
  without a lane, because by then every render has given up. The next request asks again.
- **Shared pool size.** The pool size is read once, from `src/lib/data-store/pool-size.ts`, by both
  the connection and the lanes.

**Guard:** `src/lib/data-store/recompute-lanes.test.ts` and `src/lib/data-store/public-read-cache.test.ts`.
- `recompute-lanes.test.ts` tests:
  - the lane count and the queue;
  - a failed recompute freeing its lane;
  - nesting and promotion;
  - the wait cap dropping a waiter.
- `public-read-cache.test.ts` checks:
  - five concurrent catalog-wide recomputes peak at 3 (fails without the lane);
  - unmarked reads take no lane;
  - a queued shared read is promoted when every lane holder needs it (without promotion it waits
    for the cap).

**Still open:**
- **The lane is not a hard connection limit.** Some unmarked reads run several queries in parallel
  (the state and district hubs run 8), and so does the public snapshot (fee summaries plus counts,
  three queries). The snapshot is left unmarked for that reason.
- **Each server still recomputes a stale catalog-wide entry on its own.** During a burst, several
  servers can each run the same 40 s scan. That is database load, not the starved pool fixed here.
- **Computing these aggregates once in the pipeline** would remove the scans from page renders
  entirely, the way `fee_index_cache` does for the national index. That needs a table, so a
  migration.
