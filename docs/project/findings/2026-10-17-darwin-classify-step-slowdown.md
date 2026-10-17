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

**Cause (proven with EXPLAIN ANALYZE on prod).** `selectHeldFees` in
`src/lib/agents/darwin/release-held.ts`, run in every lane's classify step. Postgres estimates one
held attempt where there are 13,233 (the `detail` jsonb filters), so it put `institution_sources`
on the inside of a nested loop and filtered the state there: every held attempt scanned all 8,775
institutions, about 116M row checks. That took over 60 s for ID alone and grew with the held
backlog, until it crossed the 120 s statement timeout. No index is needed.

**Fix (this PR).** A state lane reads its state's institutions once, in a materialized CTE, and
joins the held attempts to that. ID: 1.6 s; TX (741 institutions, the largest): 4.8 s.
