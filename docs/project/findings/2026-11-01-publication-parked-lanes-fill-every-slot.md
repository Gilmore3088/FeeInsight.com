# 2026-11-01: lanes parked at publish filled every lane slot
**What happened:** Issue #2199 saw all three lane slots held on Oct 19 by LA and TX waiting at publish and MA at discover, while 39 lanes were more than six hours overdue. A read-only measurement of prod (Supabase, Oct 25 to Nov 1, 2,017 five-minute samples of `workflow_lane` runs that were queued or running, each run's next step being its first step not finished at the sample time):

| Measure | Value |
|---|---|
| Samples with all 3 lane slots held | 1,477 of 2,017 (73%) |
| Samples with 2 or more of the 3 at publish | 412 (20%), 351 of them with 2+ waiting rather than publishing |
| Samples with all 3 at publish | 65 (3.2%, about 5.4 h), in 32 spells of 10 minutes on average and up to 40 minutes |
| Share of lane slot time whose next step was publish | 34.9%, 86% of that waiting, not running |
| Wait before a lane's publish starts (previous step's finish to publish start, 316 publishes) | p50 17.6 min, p90 56.6 min |
| Publish step time (316 publishes) | p50 223 s, p99 1,199 s |
| `step.deferred` events on lane `publish` steps | 588 on 312 runs, with on average 91 s left for a 225 s step |
| Lanes due at the time of the read (Nov 1, 23:30 UTC) | 50 of 55, 39 more than six hours overdue |

**Cause:** The tick runs one lane publish at a time: the publish steps share one database lock, so lanes side by side take turns (`createStepTurns`), and a 225 s publish fits a 270 s tick at most once. A lane whose publish does not fit stays queued and keeps its slot in `MAX_ACTIVE_STATE_LANE_RUNS`. When all three slots sat at publish, the scheduler counted the queue full and started no other lane, though at most one of the three could publish that tick and the other two side-by-side places were idle. The executor's group of three side-by-side lanes also took the next three lanes in order, so a fourth, working lane would have run only after the parked ones had used the tick.

**Fix:** `scheduleDueStateLaneRuns` counts the active lane runs whose next step is `publish`, and `freeStateLaneSlots` lets them take at most `MAX_ACTIVE_STATE_LANE_RUNS - STATE_LANE_SLOTS_RESERVED_FROM_PUBLICATION` (3 - 1 = 2) slots: when all three sit at publish, one due lane may start, and the queue is never longer than 4. `executeQueuedAgentRuns` puts at most one publish-bound lane in a side-by-side group (`sideBySideLaneGroup`), so the reserved lane runs beside the oldest parked publish; a publish-bound lane left out keeps its place and runs if the tick has room after the group. The tick still runs at most three lanes side by side, one publish at a time, the 225 s price and the tick deadline are unchanged, the pipeline pause still stops new lanes (the tick schedules lanes only while the pipeline control is on), and nothing here reads provider budget.

**Not fixed here:** The larger cause of the backlog is capacity: a publish takes a whole tick and lanes complete about 2-3 an hour. The publish-sweeps split that takes the catalog sweeps out of every lane publish was turned on on Oct 31 (`PUBLISH_SWEEPS_SPLIT_LIVE`); its effect on publish time needs a fresh measurement after a week. Extraction deadlocks and classification statement timeouts named in #2199 are separate causes with their own lock-order evidence still to gather.

**Lesson:** A slot cap counts runs, not work: a run waiting on a resource only one run can use per tick must count against a bounded share of the slots, or a queue full of runs waiting for that resource starves every other kind of work while the side-by-side places sit idle.

**Guard:** `src/lib/agents/state-lane-scheduler.test.ts` (reserved slot, ceiling and a multi-tick simulation) and `src/lib/agents/run-store.test.ts` (one publish-bound lane per side-by-side group).

**Agent lesson:** atlas/issue-2199-publication-gets-a-bounded-share-of-lane-slots
