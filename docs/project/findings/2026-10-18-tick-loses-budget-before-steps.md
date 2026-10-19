# 2026-10-18: the first tick of each hour spends its budget before any step starts
**What happened:** On 2026-10-18 a Read-now publish (IA, run 8499, step 44517) started at 07:04:05, 200 s into a tick that began at 07:00:45. It was killed at 07:05:45 ("Task timed out after 300 seconds"), and its retry took 61 s.

Nothing in that tick had started a step before 07:04 (prod `agent_run_events`, read-only). The tick was running its hourly lane sync:
- `wakeLanesWithUncheckedLiveFees` hit the statement timeout at 07:02:48 (Vercel runtime log).
- The lane priority refresh query then ran 50.6 s and finished at 07:03:59 (Postgres log).

The pattern holds across 2026-10-18, measured from `step.deferred` events: tick start = event time + `ms_left` − 270 s, against the first `step.started` from a tick-driven run.

| Tick | Ticks measured | First step started, p50 | p90 | Max | Over 60 s |
|---|---|---|---|---|---|
| First tick of the hour (minute 0) | 23 (22 with a step) | 80 s | 171 s | 200 s | 16 |
| Every other tick | 115 | 6 s | 11 s | 76 s | 1 |

The two slow queries, from `pg_stat_statements` since 2026-10-05:
- The unchecked-live-fee query averages 17.7 s (max 75 s, not counting statement timeouts).
- The priority refresh query averages 14.0 s (max 113 s).

**Cause:** `scheduleDueStateLaneRuns` ran the nationwide sync before the step loop on any tick in minutes 0–4 (`shouldRunNationwideLaneSync`). The sync covers every state's profile and lane rows, both lane wakes and the priority refresh. The step loop's deadline is counted from the tick's start, so every second the sync took came out of the 270 s step budget:
- A 225 s lane publish could no longer start in those ticks.
- A step that did start began late, with no margin. That is how the IA publish, priced at 55 s with 70 s left, was killed when it ran long under a saturated database.

**Fix:** the Foundation PR "tick loses budget before steps":
- **Its own run.** The sync is the `lane-sync` step of its own hourly run (`atlas.lane_sync`), from its own cron route `/api/admin/crew/lane-sync` at minute 6. That falls between the :00 tick's end (about :05:15) and the :10 tick.
  - The tick never starts it (`TICK_EXCLUDED_STEP_KEYS`).
  - It is priced at 200 s, its measured in-tick maximum.
  - Its step detail records each part's milliseconds.
  - A failed priority refresh still goes on the newest lane run's ledger (#1264), and on the step itself.
- **Read-now publish price** (`RUN_SOURCE_STEP_EXPECTED_MS`) raised from 55 s to 120 s, its p99, as every other step is priced. Over the day, Read-now publishes ran p50 28 s, p90 64 s, p99 117 s, max 127 s. The two reaped Read-now publishes took 61 s and 58 s on retry.

**Replay (estimate, 2026-10-18 UTC):** with the sync out of the tick, each top-of-hour tick gets back its first-step delay less the 6 s baseline.
- The 16 ticks over 60 s get back 57–194 s each; 8 of them get back 80 s or more.
- In all, 1,809 s of step budget a day comes back.
- Of the 79 deferrals recorded in those top-of-hour ticks, 48 would have fit with the time back, 15 of them publishes. Each deferral was judged on its own, so this is an upper bound, not a simulation of the steps that would then have run.

**Lesson:** anything the tick does before its step loop comes out of every step's budget, and the deadline logic cannot see it as a step. Heavy periodic work belongs in its own visible step on its own schedule, priced and measured like any other step.
