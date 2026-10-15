# 2026-10-15: global scans in every lane and stale step budgets slowed lanes
**What happened:** Lane throughput dropped from about 14 an hour (Oct 14 daytime) to 9 to 11 an hour after #1291 deployed. In the 03:00 to 04:00 hours on Oct 15 it fell to 4 to 7 an hour (`agent_run_steps`, read-only). A lane's median extract step went from 7 s to 29 to 43 s. Every lane reported the same "1,336 candidates at 317 banks" for the superseded re-file sample.

**Cause:** two problems.
- **Unscoped scans.** Two scans in the extract step read every bank, because a lane passes a state but no institution: `refileSupersededRows` (#1291; a read-only sample then, switched on by #1377 on Oct 15) and `previewHeldNameRules` (#1322).
- **Stale budgets.** `STEP_EXPECTED_MS` still held the Oct 7 values:
  - publish was budgeted 30 s against about 80 s;
  - read 110 s against about 6 s;
  - discover-paid 200 s against about 2 s.
  - `hamilton-answer-eval` had no entry, so it was budgeted 120 s. It runs 200 to 370 s. The tick always gives its first run a step, so the eval sometimes started there and killed ticks: runs 6483 and 6552 failed after three tries.

**Fix:** the throughput PR (Lane B), code only.
- Both scans are scoped to the lane's state; a Read-now run's are scoped to its bank. With the re-file pass on, each state's rows are re-filed on its lane's next extract step. Switched off, a lane skips the sample.
- The budgets were re-measured.
- The tick no longer starts `hamilton-answer-eval`. Its own route runs it, first picking up any queued eval run from any hour, so a reaped retry is never stranded.
- The scorecard skips an eval that asked 0 institutions.

**Lessons:**
- An extract or publish sub-pass added to every step must take the step's `stateCode` and `institutionId`.
- Re-measure `STEP_EXPECTED_MS` when a step's p90 moves. A budget under the real time lets a step start too late and run past the tick limit. A budget over it makes lanes give up their slot.
