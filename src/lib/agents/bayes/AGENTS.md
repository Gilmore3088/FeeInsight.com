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
entry with `count: null` and a `notCounted` reason.

## Boundaries

- Bayes never re-processes anything itself and never writes fee rows. The owning agent re-runs
  inside its own budgets and pause controls; Bayes only counts and reports.
- A count that fails is reported in the step detail and not written as a check, so it never
  reads as a stalled queue.
