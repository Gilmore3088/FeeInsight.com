# 2026-11-01: The fresh official-source audit never read a bank

**What happened:** The daily live-source diagnostic (#2061) froze 500 fees on 9 of the 13 days from
Oct 20 to Nov 1, but it never read one. Prod has 9 `live_fee_audit.draw` events and no
`live_fee_audit.claim`, `live_fee_audit.chunk` or `live_fee_audit.capture_requested` event at all.
The scoreboard showed `attempted 0, unattempted 500` and `capture.requested 0` every day.
(Read-only queries of `agent_runs`, `agent_run_steps` and `agent_run_events`, 2026-11-01 ~20:30 UTC.)

**Cause:** Three problems. The first one hides the other two.

1. **The chunk step never fit the tick.** `deming-live-source-audit` and
   `magellan-live-audit-capture` were priced at 150 s in `STEP_EXPECTED_MS`, and this workflow
   always respects the deadline, even as the tick's first run. The tick's step budget is 270 s,
   and the diagnostic run ranked with ordinary queued work. When its turn came, the tick had
   30-149 s left (p50 68 s, p90 106 s). There were 929 `step.deferred` events for the step from
   Oct 20 to Nov 1. Admission allows one active diagnostic run at a time, so each deferred run
   also blocked the next one. A run waited 9 to 226 deferrals (2 hours to 4 days) before a tick
   happened to have 150 s free. Run 17124, queued Oct 31 18:00, had still not run by Nov 1 20:30.
2. **By then the draw was expired or no longer valid.** All 12 chunk steps that ever ran finished
   with `not_due_or_claimed`, `claimed: false`, 0 groups. Seven of them ran after their draw's
   24-hour deadline. The other five (runs 10735, 11012, 11094 and 11127 on draw 191784, and run
   13701 on draw 231569) ran before it, and they still wrote no claim. The draw was `ready` and its
   cursor was at 0, so the draw had to fail `latestLiveAuditDraw` validation. That check requires
   `detail.series` to equal the current `LIVE_SOURCE_AUDIT_SERIES`, and that series includes the
   source-check, category-guard, name-retidy and fresh-audit versions. The series changed between
   consecutive daily draws in 5 of 8 cases (category 79 → 80 → 81 → 94 → 101). So a deploy that
   bumps one of those versions inside the 24-hour window makes the draw unusable. This is
   inferred: we have no exact deploy times, but no other gate in `claimLiveAuditChunk` fits.
3. **The draw step itself failed on 4 of the 13 days.** On Oct 25 and Oct 28 it failed with
   `live_audit_sql_budget_exhausted`. On Oct 29 and Nov 1 it was cancelled because an earlier
   scoreboard step failed. On Nov 1 that step was `deming-sunday-maintenance` (13:00-13:03 UTC): `loadLabelQueue`
   hit a statement timeout and left the transaction aborted ("current transaction is aborted").
   That cancelled the draw, `atlas-lesson-sync`, `atlas-city-repair` and `atlas-storage-retention`.
   `loadLabelQueue` is a separate follow-up; the draw no longer depends on it.
   No pause, gate, env switch or provider budget held any of this work:
   the steps are deterministic and the pipeline control was on.

**Fix (this PR, #2836):**
- The chunk now fits the room a tick has. External work is 70 s, and workers start no new
  institution after 40 s. Groups already started finish, and groups not started stay unattempted
  for the next chunk, so they don't become unknown. With the 10 s receipt phase the step is 90 s
  (`LIVE_SOURCE_AUDIT.stepMs`), and both live steps are priced from that constant. The lease is
  90 s.
- A queued diagnostic run ranks ahead of state lanes, after storage work and a waiting scoreboard,
  unless the tick also holds the publish-sweeps run, which needs the tick's front for its 205 s.
- Admission skips a draw frozen under an older series, so a dead draw no longer holds the one
  active slot.
- Each receipt's summary now carries `examples`: ten attempted fees in the draw's own seeded
  order, with our row, the bank line read and its link.
- **The draw has its own producer.** The diagnostic's admission queues a one-step draw run when no
  draw of the current series exists for the UTC day and none is still open. The scoreboard's
  draw step reuses that draw. An earlier scoreboard failure can no longer cancel it (cause 3).
- **The draw and archive receipts get 25 s instead of 10 s.** Successful draws took about 4 s;
  the two failed ones ran into the 8 s working limit. When the scoreboard's draw step runs out of
  SQL budget it now completes without a draw instead of failing the scoreboard's later steps.
- **Series change redraws (cause 2).** A draw keyed by day and series means a version bump takes
  a fresh draw under the new series, at most 3 a UTC day, and that draw gets its own 24-hour
  window. The day is not voided. We chose this over carrying one draw across series, which would
  mix checkers within a draw and still drop every verdict made after the bump from that day's
  score. Admission and maintenance also skip older-series draws, which can never be claimed or
  archived.

**Proof on prod (after merge):** `live_fee_audit.claim` and `live_fee_audit.chunk` events within
the first ticks after the next draw. Then the scoreboard's
`goal.liveSourceAudit.summary.attempted` should reach at least 450 of 500 before the deadline.

**Lesson:** A measurement can only run if its step fits the room the scheduler actually gives it.
Price the step against the measured time left at its turn, not against its own worst case, and
check that a "completed" step did some work. Here, twelve completed steps did nothing.

**Guard:** `src/lib/agents/deming/live-source-audit-run.test.ts`, `src/lib/agents/run-store.test.ts`
(live-source pricing), `src/lib/agents/scoreboard-execution.db.test.ts` (90 s deadline),
`src/lib/data-store/live-source-audit.db.test.ts` (redraw on series change, daily cap, the admission's own draw)

**Agent lesson:** deming/issue-2061-price-the-step-for-the-room-it-gets
