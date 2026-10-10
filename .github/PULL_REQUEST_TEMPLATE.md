<!-- Complete these exact field names. One issue is the canonical work item.
Read docs/project/BACKLOG.md before coding. Do not put approval claims in these fields. -->
Work item: #
Owner: <one implementing agent/person>
Area: <correctness | experience | maintenance | outreach>
Scope: <one coherent outcome and the paths you own>
Duplicate search: <existing open/closed PRs, branches and main checked; what was reused>
Overlap review: <none, or #PR plus the coordinated boundary for every shared-file PR>
Verification: <commands/results and anything NOT tested>
Rollback: <how to reverse the code change; separate data recovery when applicable>

## Customer / operator outcome

What changes, and what is explicitly out of scope?

## Acceptance evidence

- [ ] Relevant automated tests pass for this head commit.
- [ ] UI changes have desktop/mobile evidence; data changes have provenance and validation.
- [ ] SQL/data/credentials/billing impact is explicitly stated (including none).
- [ ] Other agents' active work is preserved; no duplicate implementation was started.

## Release and retirement

This PR is not permission to merge. James must approve the identified change after evidence is ready.
Record superseded PRs, retained unique work and the source branch/head SHA before retirement.
Do not delete a branch, force-push, enable auto-merge or change production data under this template.
