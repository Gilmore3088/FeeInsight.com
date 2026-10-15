# 2026-10-14: a join to the live catalog nested-looped for 3.9 s
**What happened:** `coverageGroupsSql` (the scorecard's state × size groups, read hourly by
`refreshLanePriorities` and on each paid and state-expert step) took 3,893 ms on prod, and
4,683 ms with the seven-days-ago columns (read-only `EXPLAIN (ANALYZE, BUFFERS)`, 2026-10-14).
3.6 s of it was one nested-loop left join that discarded 25,343,087 rows.
**Cause:** Postgres estimates 43 rows from the `institution_sources` filter (active, with a
state and an asset size under $10B) where 8,331 pass. On that estimate it inlined
`SELECT DISTINCT institution_id FROM published_fee_catalog` and rescanned the 3,887 live ids
once per institution.
**Fix:** #1264. The live list is `WITH live AS MATERIALIZED (...)`, which forces one read and a
hash join: 314 ms hourly and 491 ms with the week-ago columns. The 160 result rows hash the same
before and after, read in one snapshot. A failed priority refresh now leaves a
`lane.priorities_failed` event on the ledger instead of returning 0.
**Lesson:** a plain subquery over `published_fee_catalog` joined to a filtered institution list
can go quadratic on a bad row estimate. Materialize the catalog side when you join it to
institutions, and check the plan with `EXPLAIN (ANALYZE)` on prod before an hourly query ships.
