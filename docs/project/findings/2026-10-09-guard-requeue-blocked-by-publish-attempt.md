# 2026-10-09: Re-queued guard rejections were never selected for publish
**What happened:** PR 771's guard re-queue step ran at 01:38 UTC (step.finished event 53400:
scanned 180, requeued 9, still failing 171) and set the nine rows back to verified with
`category_guard_requeued:g51`, including the four returned-item rows 40440, 48556, 56589 and
63877. The publish steps at 01:39 and 01:43 did not publish any of them; UAT found no
deposited_item_return record for the four.
**Cause:** publish's learning filter skips a row once a `publish.rules` v2 attempt exists for it,
and each re-queued row carries the `rejected` attempt the category guard wrote when it turned the
row away (reason "Category guard (name_unsupported): ..."), under the same category. The filter's
only exception was Darwin's schedule re-file (an attempt under a different category), so the
re-queue step changed the row's status without changing what publish would read.
Also: the step detail is in `agent_run_events` (`step.finished`, keys `guard_requeue`,
`eval_verdict`), not `agent_run_steps.output_payload`, which is null for every publish step.
**Fix:** publish ignores a `rejected` attempt whose reason starts with "Category guard" when the
row carries a `category_guard_requeued:` flag (`hamilton/publish.ts`). This PR.
**Lesson:** a step that re-opens a row for another step has to check what that step's own
selection reads, not only the row's status; and prove the hand-off on prod the same hour.
