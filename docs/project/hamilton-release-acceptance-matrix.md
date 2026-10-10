# Hamilton release acceptance matrix

Version 1 · snapshot 2026-10-10 · related to #975 and #982 (H07).

This matrix is a routing/control artifact, not a completion scoreboard. The child
issues remain authoritative for actual task and acceptance evidence. A complaint
cannot be called fixed because its PR is green, because it has a preview, or because
a partial implementation exists.

The executable copy lives in `src/lib/hamilton/release-acceptance.ts`; its tests
fail if an original complaint disappears, is duplicated, loses stable task/case
links, has active status without an implementation PR, or drops a mandatory release
boundary.

| Complaint | Initiatives | Current implementation PRs at snapshot | Required acceptance |
| --- | --- | --- | --- |
| 1. Multiple Ask/follow-up inputs | H04, H05 | none yet | H04-AC1..4 + H05 review |
| 2. Research subject mislabeled as user's institution | H01, H06 | #985, #995 | H01-AC1..4 |
| 3. Peer request returns a report instead of a list | H02, H04 | #988 | H02-AC1..3, H04-AC2 |
| 4. Peer asset size/reporting context missing | H02, H06 | #988, #995 | H02-AC1/2/4 |
| 5. Word-heavy/inconsistent output | H05, H06 | none yet | H05-AC1..4 |
| 6. Fee correction requires engineering | H03, H06, H07 | none yet | H03-AC1..4, H07-AC3 |
| 7. Hamilton not ready for trustworthy research use | H06, H07 | #995, #993 | H06-AC1..4, H07-AC1/2/4 |

Every complaint requires all five release boundaries: exact-SHA CI,
authenticated preview, inspected output, explicit release approval, and
post-release read verification. No mandatory boundary can be inferred from another.

## Current release-protection snapshot

At main `a22efb7896772735e57f7dde59f070d304389ca6`, the GitHub branch API reported
`protected: false` and no required status contexts. Backlog intake and application
CI are useful process controls, but they are not a server-side merge barrier.
H07-T06 therefore remains open. This document does not authorize changing repository
rules; James's approval is required for permission/settings changes.

## Verified evidence already reusable

PR #993 exact head `1baaa27c1feac5924c4f16fe3452e431920d77df`:
tests run 38034839389 and backlog intake 38034839332 passed. Full suite: 604
files passed, 2 skipped; 5,397 tests passed, 4 skipped; pipeline E2E 3/3.
That is exact-head automated evidence only. Login/subscription restoration,
authenticated local/state/DC rendering, saved/reopened/downloaded report output
and integrated H01/H02 acceptance remain unverified.

PR #988 exact head `6f81da87a1a5a2f4b927c564659e0e10c3f89c00` has green peer-list CI,
including its real PostgreSQL cases, but H02-T08 exact-list follow-up/save/reopen
remains an integration gate.

## Update rule

When an initiative gets a PR or changes status, update the executable matrix and this
snapshot together. Do not mark `preview_verified` without the issue's required
browser/output proof, and never set `released_verified` until the deployed SHA and
post-release reads are recorded. Historical failures stay in the issue/PR audit trail.
