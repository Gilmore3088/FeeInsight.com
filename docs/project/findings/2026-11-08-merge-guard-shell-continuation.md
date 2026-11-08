# 2026-11-08: A failed merge diagnostic did not stop its shell

**What happened:** While merging routine R2 PR #3003, a final assertion over GitHub's open/draft/mergeability state failed. The shell continued to `gh pr merge`, which merged reviewed head `4442de546eb95c53ea7782358a28f4f665b5e013` as `751666ca4b4ae03947fd898ca8f22ea2d31033d8` at 05:07:47 UTC. The exact transient state was not saved and is unknown. Earlier independent exact-head review and all eight required CI jobs had passed; the merge's tree and base were subsequently verified.

**Cause:** Validation and mutation were separate commands in a shell without failure propagation. A failed Python assertion did not prevent the next shell command.

**Fix:** Record the failure and merge receipt in Foundation #1048. Future final validation, snapshot persistence and mutation must run in one process using checked subprocess calls, with the merge unreachable after any failed guard. Preserve the native snapshot before asserting so an unexpected state can be diagnosed. No permission, production-data or enforcement change was performed.

**Lesson:** A diagnostic is not a gate unless failure makes the mutation unreachable. Retain the input state before validation, then stop and reconcile every failure.

**Guard:** Foundation #1048's merge-process checklist: persist native final state first; perform validation and exact-head merge inside one fail-closed process; do not continue after a failed guard.
