# 2026-11-02: a public read made inside another cached read was never cached

**Lesson:** A cache wrapper must hold for every caller, not only top-level ones. Next skips the
data cache for an `unstable_cache` called while another one computes, so a shared cached list
read from inside a per-institution cached read went to the database every time. Check how often
the query behind a cached read actually runs (`pg_stat_statements`) after it ships, rather than
assuming the wrapper worked.

**What happened:** #2849 moved peer membership onto the cached fee-publisher list
(`getFeePublishingInstitutionIds`, `src/lib/data-store/peer-sets.ts`). After it shipped, the
list's query (`SELECT DISTINCT institution_id FROM published_fee_catalog WHERE review_status = $1`)
still ran about 16 times a minute at 1-2 s each: 131,902 calls at 14:03 UTC on Nov 2 and 132,011
at 14:10 (`pg_stat_statements`). The cached reads that use it (the peer explorer and peer set
reads) are themselves `cachedPublicRead`s, and Next's `unstable-cache.js` marks a call made
inside another one as nested and skips the cache ("when we are nested inside of other
unstable_cache's we should bypass cache"). The repo knew this one call at a time: the comment
above `getHeadlineCoverageRowsCached` in `public-cached-reads.ts` says to read beside another
cache, never inside it. #2933 hit it again with the sample report's market reads.

**Fix:** `cachedPublicRead` (`src/lib/data-store/public-read-cache.ts`) now gives a call made
inside another cached read a scope of its own (`outsideEnclosingCache`). Next treats it as a
cache whose result will be stored: a fresh entry is served from cache, and a stale one is
recomputed before the outer read uses it, so the outer entry is never stored from an inner value
a takedown already made stale. Only Next's `unstable_cache` code sees that scope; the inner
computation runs in the scope Next makes for it.

**Guard:** `src/lib/data-store/public-read-cache.test.ts`: a mock that skips the cache for a
nested call, as Next does, shows the inner read runs once for three outer calls (it runs three
times on the old code), and Next's own `willConsumerServerCache` confirms the inner scope waits
for a stale entry's recompute.

**Still open:** the scope relies on Next internals (`workUnitAsyncStorage`, store types) as of
16.4.2; a Next upgrade must re-run this test. Re-measure the list query's call rate after deploy.
