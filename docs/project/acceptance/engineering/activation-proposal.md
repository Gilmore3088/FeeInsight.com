# Engineering verification activation proposal

This proposal separates the foundation merge from enforcement. James selected Claude or Codex for independent agent review. That review must name the exact commit; a review posted through the PR author's GitHub account remains an advisory agent assessment in the GitHub identity check.

## Observed repository controls

The read-only inspection found active default-branch ruleset `25335023`, named `main`. It prevents deletion and non-fast-forward updates and requires `app-tests`; it has no bypass actors. Required pull-request approvals, stale-review dismissal, code-owner approval and the engineering verification check are not configured in that ruleset. The collaborator inventory returned only `Gilmore3088` as administrator.

## Foundation merge

Review the exact PR #2995 head, successful repository checks, historical pilot receipts and threat review before authorization. This change introduces read-only proof/audit workflows, tightens changed-path CI classification, adds an admin-only evidence reader and deployment lineage, and hardens source request boundaries. It also supplies scorecard and browser-evidence mechanisms.

The proposed workflows request only `contents: read`, `pull-requests: read`, `actions: read` and `checks: read` where needed. Source execution receives no token. The audit workflow does not publish checks. `policy.json` keeps `enforcement_enabled: false`; merging this foundation does not change the ruleset, add an account or activate a paid provider.

The merge receipt must identify the reviewed head and record James's authorization for the workflow/security-sensitive bootstrap. After merge, run the registered workflow from `main` and corroborate authentic artifacts for both pilots. Retrospective proof remains distinguished from proof obtained before merge.

## Enforcement change after trusted proof

Prepare a separate exact diff and API payload after the trusted proof cycle works:

1. Record the authorized reviewer principal or GitHub App identity. A display name such as Claude or Codex is insufficient to authenticate a GitHub event; do not relabel the owner's event as another actor.
2. Add `checks: write` only to the metadata audit job, pass its existing guarded `--publish true` option, and enable the reviewed policy. Candidate source execution continues with no token and no check-write capability.
3. Protect the agent instruction, skill, verification, workflow, CODEOWNERS and acceptance-contract paths through the approved owner policy. Preserve the current deletion/non-fast-forward protections and the existing `app-tests` requirement.
4. Add `engineering-verification` as a required check only after observing it on an eligible PR. Configure required distinct approval, stale-approval dismissal and approval of the most recent push; choose code-owner requirements only after the actual owner/principal is configured.
5. Rehearse a new push after approval, an altered frozen fixture, a protected Markdown change, an author-account approval and a missing/expired artifact. Each must block its applicable gate. Read back applied settings and keep the exact authorization and API receipts.

This document is a review proposal. It does not write repository settings or grant authorization. Production migrations, data changes, reruns, paid activation and outreach retain their existing separate boundaries.
