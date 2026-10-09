# One queue, one implementation

Owner: James. Control issue: [#984](https://github.com/Gilmore3088/FeeInsight.com/issues/984).
Decision recorded 2026-10-09 UTC (2026-10-10 in Hong Kong). This is repository
coordination, not another application agent, product runtime or marketing system.

## What James should have to do

Describe the problem, review a small result with evidence, and approve a named
merge or retirement batch. The implementing agent handles GitHub mechanics.
Do not make James reconcile hundreds of branches or repeat decisions to each agent.
The control issue is the entry point, not a second Notion board or another spreadsheet.

## Before any code is written

1. Read this guide, AGENTS.md, CLAUDE.md, the latest checkpoint and #984.
2. Search open AND closed PRs/issues, branch names and current main for the same
   outcome and affected files. A closed PR may contain deliberately parked work.
3. Reuse the existing canonical issue and implementation when they cover the need.
   Otherwise create one scoped issue with acceptance evidence. Record one implementer,
   branch, affected paths and status in the issue before coding. A reviewer is not a
   second implementer. An issue comment is coordination, not an atomic distributed lock.
4. Resolve overlapping ownership before starting. Do not rewrite someone else's branch
   or silently replace an existing implementation. At most three implementation PRs per
   area: correctness, experience or maintenance. Outreach is parked, not a fourth stream.
5. Use an issue-linked branch (`fix/<issue>-<slug>` or `chore/<issue>-<slug>`), open one
   draft PR early and complete the intake fields. Existing branches need not be renamed.
   Push subsequent work to that PR. Do not create a new PR for every iteration.

Priority: correctness and data trust, then usable customer journeys and payments, then
maintainability. No outreach, prospecting, campaigns or speculative expansion unless
James explicitly changes that decision. This does not alter production marketing controls.

## What the checks do

`backlog intake / work-intake` checks new PRs for a canonical open issue, owner,
area, scope, duplicate-search evidence, verification, rollback and overlap disposition.
It rejects another open PR with the same work item and flags unacknowledged shared
files. It blocks new outreach intake and over-limit work in an area. Older PRs are
not retroactively blocked. Shared files are a coordination signal, not proof of duplicate
logic; different files can still implement the same feature. Agents must do the actual
preflight review. Passing this check is neither code approval nor proof of correctness.

`backlog inventory` reads every branch and all paginated PR history against a pinned
main SHA. It produces a JSON report, complete branch and PR CSVs, Markdown evidence,
and a job summary. Ordinary ancestry and exact-head merged-PR evidence are distinguished
so squash/rebase merges are not mistaken for automatically unmerged work. No approximate
patch equivalence is treated as proof. Missing commits/API errors are not silently safe.
PRs based on another branch protect that dependency. Ref movement is recorded.

The weekly run is Monday 16:17 UTC. A manual run is also available. Both update only
the marked report section of #984 and retain evidence as a 90-day Actions artifact.
The setup PR runs the inventory read-only as a bootstrap; it cannot write the dashboard.
Scheduled/manual availability begins only after the workflow is approved and merged
into the default branch. No separate paid service, personal token or AI-model call is needed.
GitHub Actions runner usage still counts toward the repository's applicable usage limits.

## Retirement states and evidence

| Disposition | Required evidence / next action |
|---|---|
| MERGE | Still needed; current diff reviewed; relevant CI at head; UX/data checks; explicit James approval. |
| REWORK | Useful but incomplete. Keep the canonical work item and salvage existing work rather than duplicating it. |
| SUPERSEDED | Cite the current implementation or replacement PR proving this change is obsolete. Close with a receipt. |
| ARCHIVE / PARK | Record why, exact branch/head, restart condition and preserved work. Close the PR, preserve the branch. |
| DELETE candidate | No unique work being discarded, no open head/dependent PR, no protected/current work; exact-SHA review and separate approval. |

Initial cutoff: 2026-10-09 18:04 UTC. Do not shift it during the initial cleanup.
For subsequent reports protect at least the last three hours of observed activity.
Branch creation dates are not provided by normal branch listings or Git; an old commit
is not an old branch. Unknown-age branches are protected, and historical PR association
is evidence of prior use, not proof a ref has never been recreated. Never auto-delete.

Before any approved deletion: refresh the head and open/dependent PRs, verify the exact
approved SHA has not moved, save a recovery ref/tag and receipt, then delete only that
identified branch. Recheck main incorporation at execution time. Preserve unique work,
red-team, recovery, release and unknown-history branches. A closed PR alone is not a backup
policy; the first version leaves all branches intact. No deletion executor is included.

## Receipts from the first cleanup

| PR | Disposition | Preserved head | Reason |
|---|---|---|---|
| #635 | SUPERSEDED / closed | `d183b63efe442e1cf1cbd6e807266e4ba130eb91` | Old ProPlanCards grid replaced by PurchaseCard; chooser/checkout precede the collapsed pricing table on main. Source comparison, not a fresh browser audit. |
| #669 | PARKED / closed | `12041890e078b353c64e58fc50189dd821718f9e` | Outreach is not a current priority; preserve for an explicit restart. |
| #227 | PARKED / closed | `47ec2a034132e64b6ee19a623ab9649848ac405d` | Existing owner decision deferred federation; live verification still required. |
| #339 | PARKED / closed | `4e2165248d5264c6b9d94f80b05741db405060a1` | Unverified state-law work remains disabled and deferred. |

Each PR carries its own receipt and source branch. No branch was deleted or merged.
Remaining initial older PRs: #963 and #939 (reconcile layout overlap), #810 (PDF evidence),
#811 (quality-metric disclosure). These are not approvals. Newer or newly active work,
including #972, #973 and #974, is outside the initial cleanup.

## Non-negotiable release boundary

Green CI is necessary, not authorization. No auto-merge, production merge, direct main
push, force-push, branch deletion or data change without James's explicit approval for
that action. This supersedes the previous CLAUDE.md statement permitting fixes to merge
as soon as CI is green. Closing a demonstrably obsolete or owner-parked PR with preserved
code is backlog administration, not a product release.

At the initial read, GitHub reported main as unprotected. Repository instructions and
checks are not a server-enforced merge barrier by themselves. After this PR is approved,
configure a main ruleset requiring PRs, `app-tests` and `work-intake`, resolving review
conversations, blocking force-push/deletion and restricting bypass. Do not require James
to approve his own PR via GitHub's review button: the same account cannot self-approve.
Use an independent reviewer for a formal approval requirement, or owner-controlled merge
plus explicit recorded approval. Settings were not changed by this implementation.

## Operator commands (agents run these; James need not)

```sh
node --test .github/scripts/backlog.test.mjs
node .github/scripts/backlog.mjs inventory
# Full-history checkout plus GH_TOKEN/GITHUB_TOKEN with read access is required.
# Optional initial review cutoff:
BACKLOG_CUTOFF=2026-10-09T18:04:00Z node .github/scripts/backlog.mjs inventory
```

No status auto-close bot: inactive work is surfaced, not silently discarded. Successful
cleanup is 100% accounted-for history, not an artificially small branch count.
