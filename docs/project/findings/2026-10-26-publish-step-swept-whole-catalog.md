# 2026-10-26: every lane publish swept the whole live catalog

**What happened:** In the 7 days to 2026-10-26 (`agent_run_steps` and the `step.finished` events'
`phase_ms`, read-only), 432 state-lane `publish` steps completed in 203 s on average (p90 256 s),
24.3 server-hours. 153 s of the average went to sweeps before the rows, 41 s to sweeps after them,
and 8 s to publishing the rows. 13 more lane publishes ran past the tick three times and were marked
failed (4.3 hours). The hourly `publish-sweeps` dry run (138 completed, 125 s average, every
write check clean) ran the same 40 sweeps a third time to count them. #1070 measured 3,382 publish
steps at 23 s on average in the week to Oct 12; the lanes have since grown slower and fewer.

**Cause:** 40 of a publish step's 51 timed calls are scoped only by institution or not at all, so in
a state lane they ran over every state's live fees on every lane's publish. #2015 built the split
(`PUBLISH_SWEEPS_SPLIT_LIVE`, off) and an hourly dry run; live, it would still have run the sweeps
once per tick after every lane publish, and one sweep that threw failed the whole step.

**Fix:** #1070 (this PR): the `publish-sweeps` run starts at most once an hour, live or dry, after a
publish; each sweep in it runs in its own savepoint, so a failure is rolled back alone and recorded
as a `publish_sweeps.sweep_failed` event, and the sweeps that depend on the failed one wait for the
next run. The split switch itself stays off in this PR: turning it on is a one-line change
(`PUBLISH_SWEEPS_SPLIT_LIVE = true`) that needs its own explicit approval. Once on, a lane publish
keeps only its 11 state-scoped and own-row calls, about 51 s on the same week's per-call times
(an estimate from `sweep_ms`, not a measurement).

A trap found on the way: on postgres.js, a statement that fails on the outer transaction's handle
inside `tx.savepoint(...)` marks the whole transaction failed even after the savepoint rolls back
(checked against local PostgreSQL). Work inside a savepoint must write through the savepoint's own
handle.

**Lesson:** A publish step checks only what it publishes; catalog-wide upkeep runs on its own clock
in its own visible step, with each part isolated so one failure does not stop or hide the rest.

**Guard:** `src/lib/agents/hamilton/publish-sweeps.test.ts`, `src/lib/agents/hamilton/publish-sweeps-schedule.test.ts`, `src/lib/agents/hamilton/publish-sweeps-isolation.db.test.ts`

**Agent lesson:** hamilton/issue-1070-sweep-the-catalog-on-its-own-clock
