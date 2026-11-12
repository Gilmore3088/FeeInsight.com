Issue: #

## What changes
What this PR does for a visitor, a customer or the pipeline, and what is out of scope.

**Should move:** the scorecard number (`/admin/scoreboard`, query name such as
`goal.wrong_after_publish_7d`) this PR should change, and the expected direction and size. For
example: "`goal.knox_passes_7d` share at $0, 70% → 80%". Docs-only and process PRs write "none".
Name it in `src/lib/agents/deming/should-move.json` in this PR too: Deming's daily
`deming-change-outcomes` step records the number when it first sees the entry and checks it 7 days
later (moved as expected, no change, or the wrong way; #1106).

**Fixes errors:** an extract fix also names the error rows it fixes in
`src/lib/agents/deming/error-fixes.json` (the merge day, the Knox rules version it bumps to, and the
`pipeline_feedback` kinds, checks or ids raised by a check the re-check re-runs). After merge, those banks are re-run and Deming's daily
`deming-error-fix-recheck` step closes each error whose fee now matches the bank's document and
reports the rest (#2058). Other PRs write "none".

## Verification
- Commands run and their results (`npm run guard:legacy`, tests, typecheck, lint).
- What was not tested.
- Frozen engineering contract: exactly one `<!-- engineering-contract: CONTRACT_REVISION_KEY -->` marker and raw contract hash. Replace the placeholder with an explicit registered revision, such as `1048-v3`; the issue number does not select its latest revision.
- Current runnable proof is separate from historical evidence. The preserved `1048`, `2285` and `1048-v2` revisions cannot verify current code after their execution chain changes; registration alone is not acceptance or owner authorization.
- Actual changed-path risk, independent test designer, source authority and requirement coverage.
- Baseline assertion failure and exact-head GREEN: authenticated workflow/artifact links, or explicit BLOCKED.
- Exact-head reviewer and finding dispositions; owner sign-off is recorded separately.
- Deployment, Deming, Atlas and Bayes receipts, or PRODUCTION_UNVERIFIED with next safe action.

## Data, SQL and spend
- [ ] None, or: what SQL or production data changes, whether it waits for James, and any effect
      on provider spend.

## Rollback
How to undo it.
