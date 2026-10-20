# 2026-10-19: Hamilton publish selection read every eligible row's attempts to pick 100

**What happened:** a read-only prod review of `pg_stat_statements` (14 days) found Hamilton's
publish selection (`selectVerifiedFees`, `hamilton/publish.ts`, the query starting
`WITH eligible AS`) at 1,265 calls, 16.5 s mean, 20,917 s total and 6.77 B shared buffer touches.
No `EXPLAIN ANALYZE` was run on prod for this finding.

**Cause:** the `eligible` CTE computed every output column for every eligible verified row, then
the whole-document batch kept about `limit` (100) of them. That included two correlated look-ups
into `pipeline_attempts` (2.4M rows; `twin_recheck`, `same_line_reselect`, neither filtered by
strategy) and the row snapshot `to_jsonb(fv)`. It also read `companion_source_id` through
`to_jsonb(sd)`, a stopgap from before the column existed; the column is in
`20270109000000_companion_fee_pages.sql`.

**Fix:** `perf/hamilton-publish-eligibility`. `eligible` is now a materialized CTE of the
selection columns only (id, batch key, created time) with the same filters; the batch picks
documents from it, and the full columns and both look-ups run only on the picked rows. The
statement reads one snapshot, so the picked rows and their values are the same. The
"undecided at this rule version" check is unchanged and still runs on every candidate (the
schema-decision note in `2026-10-17-lane-publish-and-discover-reads.md` still applies).
Local synthetic check: 40,000 pending one-row batches, limit 100, 530 ms to 63 ms.

**Lesson:** in a batch query, filter and pick on narrow columns first, and compute costly
per-row reads only for the rows the batch keeps.

**Guard:** `src/lib/agents/hamilton/publish-selection.db.test.ts` (real PostgreSQL, CI e2e job)
pins which rows are picked, in which order, and their re-check, same-line, free-read, companion
and batch values.
