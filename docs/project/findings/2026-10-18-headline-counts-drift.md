# 2026-10-18: the same headline count read four ways
**What happened:** James's site audit (Oct 18, `site-v3/site-audit-2026-10-18.csv`, #1951, #1928) found one
figure printed with different values: overdraft institutions 2,510 (homepage, /fees) vs 2,502 (/fees/overdraft,
/research, benchmark report, guides); fee categories 50 (homepage, /fees) vs 52 (/research, /api-docs); Florida
coverage 73 · 113 (directory, credit union filter on), 112 (/research), 109 of 188 (/research/state/fl).
**Cause:** each page computed the count from its own read with its own rule:
- Fee institution counts: /fees and the homepage card count `getIndexRows`, which did not select
  `STATS_SCHEDULE_KEYS`, so statistics rule 7 (sister charters on one schedule count once) never applied there;
  the snapshot (`getFeeCategorySummaries`) applies it. The benchmark report read `fee_index_cache`
  (`getNationalIndexCached`), a third cache entry with its own fill time.
- Categories: the snapshot counted every taxonomy type with an approved row (52); /fees and the homepage list
  the public top 50 (`publicFeeTypes`, James Oct 17).
- State coverage: the state page paired the state index's counted institutions (statistics rules, 109) with
  the hub's active-only headquartered total (188) under the words "publish verified fee schedules"; /research
  and the directory count any approved fee (112) of every headquartered institution.
- The institution page's U.S. counts come from `getComparableMarketIndex` (market-eligibility rules, its own
  cache entry), so they can sit one or two away from the snapshot's.
**Fix:** `src/lib/headline-counts.ts` holds one definition per count and the helpers pages use; the snapshot
states the public category count; the coverage read carries `counted_institutions`; the state page and the
benchmark report read the shared sources. Rule 7 on `getIndexRows` lands with #1879. PR for #1951.
**Lesson:** a number printed on more than one page gets one helper and one definition in
`headline-counts.ts`; a page never re-derives it from a different read, and a different population (the
institution page's comparable index) says so beside the number.

**Guard:** `src/lib/headline-counts.test.ts:48` (the category headline counts the public top 50, never every taxonomy type with data; the cases after it pin one definition each for fee institution counts and state coverage. A page that re-derives a count from its own read is not caught)
