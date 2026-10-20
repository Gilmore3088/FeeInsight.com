# 2026-10-20: call-report readers recomputed every quarter on every request

**What happened:** A read-only review of prod `pg_stat_statements` (14 days to Oct 20) found the
call-report aggregate family (`src/lib/data-store/call-reports.ts` and the district/state hub's
`loadRevenue` in `district-hub.ts`) averaging 3.66 s a call over about 10,468 calls: 38,302 s in
all, 4% of all database time, and most of about 3.2 TB of temp-file spill at `work_mem` 7 MB.
`getRevenueTrend` alone had taken 10 s on average and up to 38 s before its Oct 8 year bound.

**Cause:** Every request re-read hundreds of thousands of `institution_financial_records` rows,
cast the TEXT `report_date` to a date row by row, and ran LAG windows (or a prior-quarter
self-join) to turn NCUA 5300 year-to-date income into quarters. That work only changes when a
quarterly load or a universe sync changes the filings, a few times a quarter, yet it ran on
every page read.

**Fix:** The draft PR `perf/call-report-quarterly-summaries` (HOLD for James: it adds migration
`20270110000073_call_report_quarterly_income.sql`). Hoovie's `registry-call-report-summaries`
step stores each filing's standalone quarter once per load, under both rules the readers used
(the 80-100 day window rule and the exact prior-quarter-end rule), rebuilding only the
regulator-years whose filings changed, in one transaction. The readers read the summary and fall
back, with a logged warning, to the old per-request SQL only while it is missing or empty. The
raw filings are unchanged. Not merged.

**Lesson:** A figure derived only from loaded regulator data is computed when the data loads,
not when a page is read. A new reader of call-report income reads `call_report_quarterly_income`
(the twins in `call-reports-summary.ts` show how), never its own LAG over the raw filings.

**Guard:** `src/lib/data-store/call-report-quarters.db.test.ts` runs every summary-backed reader
and the hub SQL against the old per-request SQL (`call-reports-legacy.ts`, `hubRevenueLegacySql`)
on NCUA year-to-date fixtures with missing quarters, FDIC rows, an off-quarter refiling, ffiec
duplicates and an unmatched filing, and fails on any difference, including the intensity reads'
30-month cutoff pinned to five dates.
