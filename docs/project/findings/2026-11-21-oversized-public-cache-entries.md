# 2026-11-21: the largest /fees cache entries passed Next's 2 MB limit and were never stored

**Lesson:** A cached read is only cached if its entry fits. Next's data cache refuses an entry over
2 MB and returns the value anyway, so an oversized read silently re-runs on every request. Size a
cached payload against the largest key it will hold (the biggest category, not the usual one), and
cache what the page renders rather than every row it was computed from.

**What happened:** James saw "items over 2MB can not be cached" in the production logs for the
filtered `/fees` explorer and `/fees/safe_deposit_box` (Nov 21). Measured on prod the same day
(JSON size of the rows each read returns):
- `getFeeCategoryDetailCached` carried every fee row with its name, conditions and document link:
  about 4.5 MB for safe deposit box (8,150 rows) before schedule keys, and over 2 MB for stop
  payment, document reproduction, monthly maintenance, account research, NSF, dormant account and
  overdraft. `/fees/[category]` is rendered per request, so each view of those pages re-read the
  whole category. `/tools/price-check` and the national report read the same entry.
- `getIndexRowsCached` (the explorer and homepage card) repeated each institution's name and two
  schedule keys per row: about 3.1 MB for safe deposit box, 1.8 MB for stop payment.

**Fix:** the detail entry (`fee-category-detail-v3`) drops the rows and carries the page's national
figures computed from them (`categoryFeeSummary`, the same code the page ran), plus the row count
for the empty rule. The explorer rows are stored packed (`index-rows-pack.ts`: each string once,
rows as number tuples) and unpacked to the identical rows on read. Tests prove both give back what
the page computed before and keep an 8,150-row category under 1 MB.

**Guard:** `src/lib/data-store/index-rows-pack.test.ts` (an 8,150-row category packs under 1 MB and round-trips exactly), `src/lib/data-store/category-fee-summary.test.ts` (the cached figures equal the page's previous computation).

**Not proven:** the CPU share this explains, until the Vercel logs show the 2 MB message has
stopped and function duration for `/fees` falls after deploy.
