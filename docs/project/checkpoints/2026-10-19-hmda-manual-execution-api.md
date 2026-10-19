# HMDA identity repair: manual execution contract

Prepared for review under #2264 and #2232. No production repair, preview run, queue request, migration, or control change has been made. Apply and rollback are disabled in `src/lib/agents/hoovie/hmda-repair-release.ts`.

The server owns the manifest at `docs/project/evidence/2026-10-19-hmda-rerun-manifest.json`. Its digest is exported as `HMDA_REPAIR_MANIFEST_DIGEST`. Callers supply that digest, never a replacement manifest or a list of banks. The reviewed scope is ten canonical LEI fills, ten annual lender identities, 85 origination identities and 39 cost identities for 2025 across all existing states.

## Queue request

`POST /api/admin/registry/hmda-identity-repair` requires an authenticated admin with `trigger_jobs`. Cron secrets do not authorize this route. Its JSON body is limited to 4,096 bytes:

```json
{
  "source": "hoovie.hmda-identity-repair",
  "mode": "preview",
  "manifest_digest": "<HMDA_REPAIR_MANIFEST_DIGEST from the reviewed deployed code>"
}
```

Modes are `preview`, `apply` and `rollback`. Apply and rollback additionally require `authorization_reference`; rollback requires the `apply_event_id` of its original atomic apply receipt. These fields record a separately obtained authorization; a string in a request is not authorization by itself. The current release refuses apply and rollback with HTTP 423 before creating a run.

A valid preview request creates or reuses a run and returns HTTP 202 with `runId`, `status`, `reused`, `mode`, `manifestDigest`, and `manualExecutionRequired: true`. Queueing writes the run ledger; it does not execute the repair. A preview executes checks without changing institution or HMDA source data, while its run/step/events remain visible in the ledger.

## Explicit advancement

After reviewing the queued configuration, an authenticated admin advances its single step using the existing `POST /api/admin/agents/runs/<runId>/execute` endpoint with `{ "maxSteps": 1 }`.

The step key is `hmda-identity-repair`, its source is `hoovie.hmda-identity-repair`, and its owner is Hoovie (with the existing recorded Magellan ledger fallback when the Hoovie registry row is absent). The cron tick excludes this key. No scheduler creates these runs, and the queue route never calls the executor. The pipeline pause holds this step, including previews; this route does not alter controls. Provider work is zero.

The runtime reads authority from `agent_runs.params_json`, validates an admin trigger and the mode's run kind, and never accepts step-input overrides. Before writing, the locked run and step must still be running, uncancelled, admin-created, and carry the same pinned configuration. Preview uses `dry_run`; apply and rollback use `manual_repair`. The core performs source verification before its bounded transaction and records successful apply/rollback receipts atomically with the identity changes. A killed attempt can be reaped and then advanced manually; its receipt prevents repeated writes.

The idempotency key combines the manifest digest and mode; rollback also includes the apply event ID. Terminal history is reused. Reposting after a terminal failure returns that failure for review rather than creating an unreviewed retry. Configuration or row drift must be resolved through a revised review, not a caller-supplied nonce or wider row set.

## Review before enabling writes

Keep the write gate disabled until the exact deployed head, manifest, authorization scope and fresh preview have been reviewed. The ordinary FDIC LEI, durable FDIC hold collection and HMDA identity rollout gates are separate and remain disabled; enabling the bounded pilot does not authorize their broader rollout. The #2266 hold schema is now a deployment prerequisite: preview and apply read all unresolved holds, and any held institution, certificate or implicated LEI disqualifies the pilot. Missing hold schema is an error. The migration itself requires separate authorization and has not been applied to production.

Any added, missing, changed or ambiguously owned row aborts the bounded operation. Source facts and timestamps remain unchanged. Rollback requires separate authorization and its own ledger run; it restores only the recorded before-images while every current post-image still agrees with the original apply receipt. It refuses to overwrite later work.

The reviewed canonical document digest is `6118ff5a567d8792bfbba691c13c95ff78664772fc3cce1c8ea34fed7795beb9`. A read-only production snapshot at 2026-10-19 15:06:05 UTC reproduced all four reviewed table hashes and exact 10/10/85/39 counts; the public FDIC response also retained the pinned SHA256. No noninternal write triggers or rewrite rules were present on the five scoped tables. These checks were performed without invoking this queue route or creating any production run/step/event rows. They do not authorize later execution.
