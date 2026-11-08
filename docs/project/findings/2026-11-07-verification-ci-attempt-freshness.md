# A same-commit CI rerun invalidates an earlier success

**Cause:** the GitHub evidence collector read a successful CI run and latest jobs once, then rechecked only the PR commit. A rerun can change attempt/status without changing that commit, leaving cached success authoritative.

**Evidence:** independent Codex review of `c5144c0042133260b51dc01226d46d1a80c6366e` reproduced attempt 1 reported as passed while attempt 2 was running. Regressions for running and failed reruns failed against that implementation.

**Fix:** fetch jobs for the exact collected attempt, require each required job to carry the same run/attempt/head, and reread both the native run and newest selected workflow run before returning. A changed attempt, newer run, failed read or incomplete result blocks evidence.

**Guard:** `src/lib/engineering-verification/github.test.ts` covers both rerun states, newer same-head runs and mismatched job lineage. Native reads are bounded observations rather than an atomic lock on later GitHub changes. Tracked with Foundation #1048 in PR #2995.
