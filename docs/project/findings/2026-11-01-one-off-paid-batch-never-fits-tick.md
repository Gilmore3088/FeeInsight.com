# 2026-11-01: an approved one-off paid batch never got a fresh tick
**What happened:** James approved two one-off paid batches on Nov 1: the answer-key re-key (run 17839, queued 18:30 UTC) and the Darwin release-review sample (run 17912, queued 22:31 UTC). Neither started. Each tick deferred them with `step.deferred`: "needs about 260 s (200 s) and the tick has 35-83 s left" (16 deferrals for 17839 by 22:34).
**Cause:** `executeQueuedAgentRuns` ranks queued runs by lanes idle over 15 minutes, runs already under way, direct runs and lane priority. A fresh one-off run has none of those, so it was reached only after the tick's lanes had used most of its 270 s, and its one long step never fit what was left.
**Fix:** PR #2851: one-off paid batch sources (`ONE_OFF_PAID_BATCH_SOURCES` in `run-store.ts`) rank ahead of lanes once queued 30 minutes, so they get a fresh tick. Each is still one run at a time, capped by its own scheduler, and held by the provider stop and budget.
**Lesson:** A step that needs most of a tick must be ranked to get the tick's front, or it waits forever; check a new long step's place in the tick order before calling an approved batch scheduled.
**Guard:** `src/lib/agents/one-off-batch-order.test.ts` (the list names each batch's own source).
**Agent lesson:** atlas/one-off-batch-gets-fresh-tick
