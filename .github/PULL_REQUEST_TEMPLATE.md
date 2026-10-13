Issue: #

## What changes
What this PR does for a visitor, a customer or the pipeline, and what is out of scope.

**Should move:** the scorecard number (`/admin/scoreboard`, query name such as
`goal.wrong_after_publish_7d`) this PR should change, and the expected direction and size. For
example: "`goal.knox_passes_7d` share at $0, 70% → 80%". Docs-only and process PRs write "none".
Name it in `src/lib/agents/deming/should-move.json` in this PR too: Deming's daily
`deming-change-outcomes` step records the number when it first sees the entry and checks it 7 days
later (moved as expected, no change, or the wrong way; #1106).

## Verification
- Commands run and their results (`npm run guard:legacy`, tests, typecheck, lint).
- What was not tested.

## Data, SQL and spend
- [ ] None, or: what SQL or production data changes, whether it waits for James, and any effect
      on provider spend.

## Rollback
How to undo it.
