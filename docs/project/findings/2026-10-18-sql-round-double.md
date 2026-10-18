# 2026-10-18: SQL ROUND(x, n) on a double fails the fee revenue page
**What happened:** /research/fee-revenue-analysis failed on every load. Vercel logged
`function round(double precision, integer) does not exist` on GET /research/fee-revenue-analysis
at 09:20 UTC on Oct 18 (James's site audit, issue #1950).
**Cause:** Postgres defines `round(numeric, integer)` but no two-argument `round` for
`double precision`. The fee revenue reads take `AVG` over a `PERCENTILE_CONT` result, and
`PERCENTILE_CONT` always returns `double precision`, so `ROUND(AVG(...), 2)` had no matching
function. The same shape sat in `derived-analytics.ts` and the admin query presets.
**Fix:** `claude/fee-revenue-round-fix` casts the first argument of every two-argument SQL `ROUND`
to `::numeric`; `src/lib/data-store/sql-round.test.ts` fails on any uncast `ROUND(x, n)` in
`src/lib/data-store`.
**Lesson:** In SQL, write `ROUND((expr)::numeric, n)` whenever you round to places. Mocked-SQL
tests never reach Postgres, so a type error like this only shows on prod; pin the SQL text.
