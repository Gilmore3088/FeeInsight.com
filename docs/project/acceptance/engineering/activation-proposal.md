# Engineering verification activation proposal

This proposal separates the foundation merge from enforcement. James selected Claude or Codex for independent agent review. That review must name the exact commit; a review posted through the PR author's GitHub account remains an advisory agent assessment in the GitHub identity check.

## Observed repository controls

The read-only ruleset inspection, refreshed on 2026-11-11, found active default-branch ruleset `25335023`, named `main`. It prevents deletion and non-fast-forward updates and requires `app-tests`; it has no bypass actors. Required pull-request approvals, stale-review dismissal, code-owner approval and the engineering verification check are not configured in that ruleset. The earlier collaborator inventory returned only `Gilmore3088` as administrator.

## Foundation merge

PR #2995 and its follow-ups have merged; their exact authorizations and receipts are in [the implementation plan](plan-validation.md). The later #3006 approval covers only its frozen baed head and the stated one-time bootstrap exception. That exception was consumed by the first proof attempt. The proposed `1048-v3` revision changes the controlled execution chain and needs fresh exact-head review and protected owner authorization. No successor exception is granted by this proposal.

The proposed workflows request only `contents: read`, `pull-requests: read`, `actions: read` and `checks: read` where needed. Source execution receives no token. The audit workflow does not publish checks. `policy.json` keeps `enforcement_enabled: false`; merging this foundation does not change the ruleset, add an account or activate a paid provider.

Each controlled merge receipt must identify the reviewed head and record James's authorization. Registered trusted-main execution and independent artifact corroboration remain required; retrospective proof stays distinct from proof obtained before merge. Successful local runs, green repository CI and current source registration cannot supply missing native proof or formal reviewer identity.

## Machine-review enrollment before enforcement

An existing connected GitHub installation is visible for the account, but its presence does not show whether Codex Code Review is enabled for this repository. The separate direct installation lookup returned HTTP 403, and sampled PRs had no native review records. The current feature setting remains unknown. No settings or review-trigger messages have been changed or sent.

Prepare enrollment against the chosen machine review product, without requiring a second human account:

1. Confirm the repository's actual review configuration and the selected product's available native result format. If activation or a review-trigger message is needed, present its exact repository scope, action and any cost before requesting the applicable authorization.
2. Bind a real review to the exact PR/head, frozen contract and policy, full changed-path scope and authenticated product actor/result. Native GitHub review/comment identity can supply provenance when it supports those bindings; a private product task API is not a source requirement. Retain findings and their dispositions. A bot display name, authored completion marker or undocumented no-findings state cannot grant formal machine approval. Preserve the technical design's separately attributable human-owner fallback when a distinct GitHub review identity is technically unavailable; an agent posting under the owner's credential remains advisory.
3. Freeze the observed supported protocol and implement its validation. Demonstrate stale-head, wrong-product/actor, changed contract/scope, forged completion, unresolved findings and revoked/superseded-result rejection. Missing native provenance remains advisory or blocked.
4. Demonstrate how an eligible machine result satisfies the verification check before proposing required-check activation. Do not configure a native approval requirement that the selected product has not been shown to satisfy. James's separate protected owner authorization remains required for controlled changes.

## Enforcement change after trusted proof

Prepare a separate exact diff and API payload after the trusted proof cycle works:

1. Record the authorized reviewer principal or GitHub App identity. A display name such as Claude or Codex is insufficient to authenticate a GitHub event; do not relabel the owner's event as another actor.
2. Add `checks: write` only to the metadata audit job, pass its existing guarded `--publish true` option, and enable the reviewed policy. Candidate source execution continues with no token and no check-write capability.
3. Protect the agent instruction, skill, verification, workflow, CODEOWNERS and acceptance-contract paths through the approved owner policy. Preserve the current deletion/non-fast-forward protections and the existing `app-tests` requirement.
4. Add `engineering-verification` as a required check only after observing it on an eligible PR, bound to its actual authorized publisher. Enforce exact-head machine review through the validated path. Add native approval and code-owner requirements only after their eligible actors and behavior are demonstrated; preserve the separate protected owner boundary.
5. Rehearse a new push after approval, an altered frozen fixture, a protected Markdown change, an author-account approval and a missing/expired artifact. Each must block its applicable gate. Read back applied settings and keep the exact authorization and API receipts.

This document is a review proposal. It does not write repository settings or grant authorization. Production migrations, data changes, reruns, paid activation and outreach retain their existing separate boundaries.
