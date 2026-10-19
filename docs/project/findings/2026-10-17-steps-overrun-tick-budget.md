# 2026-10-17: agent steps overrun the tick's 300 s limit
**What happened:** On 2026-10-17, TX's state lane (run 8004) started its publish step (43559) at 20:03:28, 163 s into a tick that began at 20:00:45. Vercel killed the tick at 20:05:45 ("Task timed out after 300 seconds").
- The transaction rolled back, and the step sat `running` until stale-step recovery re-queued it at 20:20 (attempt 2 of 3).
- The re-run took 278 s.
- Another tick hit the same limit at 20:15:45, in run 8029's extract.

Across the 24 hours to 20:45 UTC (prod `agent_run_steps` and `agent_run_events`, read-only):

| Step | Setting | p50 | p90 | p99 | Max |
|---|---|---|---|---|---|
| publish | 105 s | 38 s | 133 s | 221 s | 278 s |
| extract | 40 s | 22 s | 82 s | 161 s | 212 s |
| classify | 25 s | 32 s | 140 s | 157 s | 180 s |
| discover-paid | 10 s | 65 s | 143 s | 160 s | 165 s |

- Four more steps also ran past their setting at p99: discover, extract-paid, fetch and read.
- 40 steps were reaped in all. 21 started inside a tick: 13 classify, 4 extract, 2 discover-paid and 2 publish. The other 19 (13 classify, 5 hamilton-answer-eval, 1 discover-paid) started outside a tick's first 300 s, from another route. Each reap meant a step killed, then 15 minutes stalled before its retry.

**Cause:** the tick starts a step only when `now + STEP_EXPECTED_MS[step]` fits its 270 s budget (`STEP_FINISH_BUDGET_MS`). The settings dated from 2026-10-07 and 2026-10-15, and the steps have grown since:
- Knox's lesson read averages 53 s per call (`pg_stat_statements`).
- Darwin's selection averages 38 s.
- Every publish step runs about 50 sweeps before and after its row loop, and in a state lane it reads the whole catalog a second time to top up from other states (16–24 s).

A step measured at 105 s that really takes 278 s passes the check late in a tick, and is then killed.

**Fix:** #1844 (Foundation, step timing). Not merged at the time of writing.
- `STEP_EXPECTED_MS` is set at about the 24-hour p99 for eleven steps.
- The publish row loop stops 120 s into the step (`PUBLISH_ROW_DEADLINE_MS`), once it has decided 50 rows. The rows left get no attempt and publish on the next step. A step past that point also skips the cross-state top-up.
- The publish step records `phase_ms` (`sweeps_before`, `publish_rows`, `sweeps_after`) and `publish_time_box`.
- A held step writes a `step.deferred` event.

**Lesson:** expected runtimes drift as steps gain work. Re-measure them from `agent_run_steps` whenever a step grows, at p99 rather than p90, and whenever `step.reaped` events appear. A long step needs its own time box, not just a good estimate. A step that cannot be told where its time goes needs `phase_ms` before anyone can shorten it.
