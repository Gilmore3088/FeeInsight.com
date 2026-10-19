# Bayes Guide

Bayes is the replay and recovery tooling of the Agentic OS PRD (section 8). When a rule or parser
version changes, Bayes counts what the older version processed and whether today's version has
reached it. It runs as an Atlas step (agent `atlas`, `/api/admin/crew/bayes`, daily); it is
deterministic and makes no model calls.

## What it owns

- `replay_jobs` (one row per change, keyed `<manifest>@<version>`) and `replay_job_checks` (one
  appended row per count). Checks are never rewritten.
- `manifests.ts`: the impact manifests. Each versioned rerun declares its owner, unit and what it
  affects, and counts affected / done / queued / excluded-by-reason. "Queued" comes from the
  owner's own selection (Knox's due-text query via `countKnoxRereadsDue`, the registry
  scheduler's stale-parser test), so it means work the owner will really pick up.
- `ledger.ts`: the `bayes-replay-ledger` step. A job closes when nothing is queued (done and
  excluded are terminal) and is `stuck` when nothing settled across `STUCK_AFTER_CHECKS` counts.
  A rerun whose reach cannot be counted yet is `not_counted`, with the reason, never closed.

## Adding a manifest

A new version constant that makes an agent reprocess old records needs a manifest entry in the
same PR. Count with the owner's own selection; when that selection is not shared yet, add the
entry with `count: null` and a `notCounted` reason. A version whose bump redoes nothing goes in
`VERSIONS_WITHOUT_REPLAY` with the reason. `scripts/ci-guards.sh bayes-manifest-kill` (in
`npm run guard:legacy`) fails a PR that adds or changes a Knox, Darwin, Hamilton, Magellan or
Rosetta version constant that neither names (registry parsers count through
`REGISTRY_PARSER_VERSIONS`).

Rosetta's five reader versions and Darwin's `verify.rules` and `verify.peer_range` have
manifests (#1120) that are not counted yet: the owners' re-read and re-verify selections are not
shared as counts. They show as `not_counted` until a counter is added.
The scoped stacked-PDF repair (#2219, `rosetta.pdf_stacked_repair`) is counted with
Rosetta's complete current-copy due query. Successful checks include unchanged geometry;
failed access/hash/layout checks retain the earlier text and are exclusions requiring
review. Neither result certifies downstream fees or retires old published mistakes.

## Boundaries

- Bayes never re-processes anything itself and never writes fee rows. The owning agent re-runs
  inside its own budgets and pause controls; Bayes only counts and reports.
- A count that fails is reported in the step detail and not written as a check, so it never
  reads as a stalled queue.

## Current versions

The version each rules or reader constant is at now. `scripts/ci-guards.sh guide-version-kill`
fails a PR that changes one of these constants without updating its line here (#1109).

| Constant | Strategy | Version | File |
|---|---|---|---|
| `BAYES_LEDGER_VERSION` | — | v1 | `bayes/ledger.ts` |
