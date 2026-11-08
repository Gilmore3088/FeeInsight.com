# A same-commit CI rerun invalidates an earlier success

**Cause:** the GitHub evidence collector read a successful CI run and latest jobs once, then rechecked only the PR commit. A rerun can change attempt/status without changing that commit, leaving cached success authoritative.

**Evidence:** independent Codex review of `c5144c0042133260b51dc01226d46d1a80c6366e` reproduced attempt 1 reported as passed while attempt 2 was running. Regressions for running and failed reruns failed against that implementation.

**Fix:** fetch jobs for the exact collected attempt, require each required job to carry the same run/attempt/head, and reread both the native run and newest selected workflow run before returning. A changed attempt, newer run, failed read or incomplete result blocks evidence.

**Guard:** `src/lib/engineering-verification/github.test.ts` covers both rerun states, newer same-head runs and mismatched job lineage. Native reads are bounded observations rather than an atomic lock on later GitHub changes. Tracked with Foundation #1048 in PR #2995.

## Native artifact expiry is not a new ninety-day lifetime at upload

The first registered-main proof runs exposed a second lifecycle assumption. Foundation
run `42446528857` and Knox run `42446530729` passed their actual baseline/target assertions.
Their native artifacts expire ninety days and one second after workflow creation, respectively
seventy and eighty-seven seconds before upload creation plus ninety days. The collector's
sixty-second upload-based tolerance rejected both genuine artifacts.

Use authenticated original workflow creation as the conservative ninety-day policy epoch,
and the native `expires_at` as an independent availability limit. Require valid ordered
run/attempt/upload timestamps and the same original creation epoch on the run and attempt.
A delayed upload or later attempt never resets the permitted age. Shortened retention,
expired artifacts, mismatched attempts and missing epochs still block. No larger timing
tolerance, provider setting or workflow permission is needed.

This observation does not establish a universal backend retention algorithm. The pinned
upload client requests an expiry relative to upload time; GitHub's returned expiry is the
actual availability evidence. [GitHub's artifact documentation](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/remove-workflow-artifacts#finding-the-expiration-date-of-an-artifact)
directs consumers to that API field. Regressions in `proof.test.ts` cover both observed
delays, later-attempt age, shortened retention, malformed epochs and exact expiry boundaries.

## Deployment labels retain their native and canonical identities

The same bootstrap's successful native GitHub deployment `7631323523` labels its environment
`Production`; the server-owned Vercel execution envelope and frozen policy use `production`.
Comparing those strings literally would reject this actual production deployment.

Only GitHub's exact `Production` and `production` labels map to the policy's canonical
`production` at the deployment boundary. Preserve the native labels, and keep policy and
runtime execution identities strict. Preview deployments, unknown aliases, disagreeing
statuses, missing lineage and incomplete observation windows still fail. The deployment
label regression belongs in `evidence.test.ts`; this mapping does not establish an observed
production outcome or authorize a replay.

## Historical CI preserves head association without inventing checkout identity

After PR #2995 merged, native run `42357473949` and its check suite returned empty
`pull_requests` arrays. The prior collector consequently lost CI association despite all
eight exact-head jobs still being available. Native commit-to-PR association and Git commit
trees independently establish that merged PR #2995's head and squash merge have identical
bytes.

A separate `historical_head_identity` path may use that evidence for an already merged PR.
It must retain exact repository/head/ref, workflow source, latest run/attempt and check/job
bindings; require native head-to-merged-PR association and equal head/merge trees; and recheck
the PR state and merge identity. This corroborates native CI associated with the exact
target head and its identical final merge tree. The actual historical checkout SHA/tree
and triggering PR remain unknown; a default event-time merge checkout may differ from
the head. It cannot rescue an open PR with missing association, certify the executed
checkout tree, infer coverage of a different final merge tree, or make a closed PR eligible
to merge again. Missing or inconsistent evidence stays blocked. `github.test.ts` guards
this separate boundary.
