# Darwin's classify step slowed twentyfold and now times out state lanes

**Found:** 2026-10-17, checking the morning brief's "28 state lanes are overdue by more than 6 hours".

**What happened.** Darwin's `classify` step inside each state lane averaged 7 s on Oct 11-13,
16 s on Oct 15, 80 s on Oct 16 and 138 s on Oct 17 (`agent_run_steps`, workflow lanes). It
finished 377 times on Oct 12 and 46 times on Oct 17 by 12:00 UTC. Thirteen lane runs failed in that
step with "canceling statement due to statement timeout" between 22:45 Oct 16 and 11:55 Oct 17
(DE, AK, MS, WA, WY, NV x3, ID x3, MO, PR = atlas job #7726). Every failure is in `classify`.

**Why lanes look overdue.** Lanes are due an hour after their last pass and run one at a time.
With each pass about 2.5 minutes longer and one in five failing, about 4 lanes finish an hour
against 55, so 50 were due and 28 more than 6 hours late at 12:00 UTC. The tick itself is healthy
(9-12 successful ticks an hour, none blocked). It is not the Magellan October cap: Magellan has
spent $161.78 of $225 this month, and its "blocked" rows are a per-run call cap.

**Likely cause (inferred from `pg_stat_statements`, not yet proven with EXPLAIN ANALYZE).**
`pipeline_attempts` holds 2.32M rows (1.3 GB), about 300k of them `verify.rules` v3, growing by up
to 100k verify rows a day since Oct 15. Two classify reads scan it without a fitting index:
- `selectHeldFees` in `src/lib/agents/darwin/release-held.ts`: 408 calls, mean 37 s, max 119 s
  (the 120 s timeout). The state filter applies only after joining every held verify attempt.
- Knox's lessons read in `src/lib/agents/knox/lessons.ts` (the `restored AS MATERIALIZED` query
  over `pipeline_feedback`): 542 calls, mean 53 s.
Ad-hoc analysis reads of 60-118 s on the same day add load.

**Fix needed (not in this PR).** A partial index on `pipeline_attempts` for held verify attempts
(stage `verify`, decision `needs_review`) and a look at the lessons read. An index is a migration,
so it needs James's yes; Darwin and Knox belong to the Data quality lane.
