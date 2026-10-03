# Outstanding Agentic Cleanup Tasks

This file tracks active work only. Historical launch, crawler, and deployment notes belong under `docs/archive/`.

## Goal

Make Fee Insight run through one visible agentic system:

1. Operator or cron creates an `agent_runs` record.
2. Work advances through `agent_run_steps`.
3. Every meaningful state change writes `agent_run_events`.
4. Provider usage and provider failures attach to `ai_api_usage_events`.
5. No active runtime, prompt, config, script, or current plan points at retired external launchers, Supabase Edge Function product endpoints, or local crawler tooling.

## Active Plan

The 2026-09-30 pipeline audit (`docs/audits/2026-09-30-data-pipeline-audit.md`) is being
fixed under `docs/plans/pipeline-self-learning-plan-2026-10-02.md`: Phase 0 (restart and
S0 fixes), Phase 1 (learning foundation, idempotency, correct statistics), Phase 2 (scale
and the improvement loop), Phase 3 (paid extraction under a $300/month cap).

## Current Priorities

| Priority | Owner | Task | Done When |
|---|---|---|---|
| P1 | Rosetta | Add scanned-PDF OCR fallback | Image-only PDF rows move from `needs_ocr` to readable document text or explicit terminal failure. |
| P1 | Knox | Add bounded provider-assisted extraction fallback | Deterministic misses on readable documents get one metered fallback, with only anomalies sent to human review. |
| P1 | Darwin | Thin review pressure | Verification routes ordinary canonical rows forward and challenges only suspicious rows. |
| P1 | Hamilton | Publish data-quality summaries | Admin can distinguish no source, source fetched, PDF pending OCR, extracted, verified, and published. |
| P1 | Schema | Rename or baseline physical source storage | Empty database can be built around agentic source names without recreating retired table names as active infrastructure. |
| P2 | Schema | Audit FK/column compatibility names | Remaining physical FK/storage names are documented or replaced without breaking existing data. |
| P2 | Docs | Keep active docs current-only | `npm run guard:legacy` blocks stale active guidance and historical docs stay in archive. |

## Recently Shipped

| Owner | Shipped |
|---|---|
| Data flow (Phase 1b) | Fixed double-encoded JSON writes: Darwin had selected 0 Knox rows since launch, because `outlier_flags` was stored as a JSON string. The connection now passes JSON text through, and migration `20270103000000_repair_double_encoded_jsonb.sql` repairs stored values. Darwin logs every decision (`verify.rules@1`), so rejected rows no longer starve its batch. |
| Learning core (Phase 1a) | `pipeline_attempts` attempt log, the per-institution playbook on `institution_source_profiles`, and the strategy router (`src/lib/agents/learning/`). Magellan sends conditional GETs and records `unchanged` instead of inserting duplicate documents. Rosetta detects formats from bytes and marks thin-text PDFs `scanned_pdf`. Knox never re-extracts the same text with the same extractor version. Migration `20270102020000_learning_core.sql`. |
| Atlas | Visible run launch receipts plus pickup/stale status on `/admin/atlas/status`. |
| Magellan | Rescue/fetch batches rotate through retry windows instead of retrying the same failed rows. |
| Provider boundary | Recent Anthropic credit-balance failures block new calls before provider execution and record visible `blocked` usage events. |
| Rosetta | Readable HTML, text, and extractable PDF documents flow through semantic `agent_source_texts`; scanned/image-only PDFs are explicitly marked `needs_ocr`. |
| Public runtime | Production proxy no longer serves the retired static prelaunch page over public App Router routes. |
| Runtime boundary | Local Supabase Edge Function source removed; `guard:legacy` now fails if a tracked Edge Function runtime returns. |
| Script artifacts | Unreferenced standalone `scripts/migrations/*.sql` files removed; canonical DB history remains under `supabase/migrations`. |
| Source read model | Added `institution_sources`, `source_documents`, and `source_collection_runs`; migrated public stats, collection health, Hamilton admin status tools, admin query presets, and Magellan status counts; added `source-read-model-kill`. |
| Agent source paths | Magellan discovery/fetch, Rosetta read, and Atlas/run-store inventory now use semantic source views instead of historical source tables. |
| App source paths | Reporting, admin queries, data-store modules, Scout, institution commands, submit-fees lookups, alerts, and report APIs now use semantic source views; `source-read-model-kill` scans all of `src/`. |
| Agent document path | Magellan fetch, Rosetta read, Knox extract, and Atlas run receipts now use semantic `institution_id` / `source_document_id`; `agent-source-contract-kill` guards the path. |
| Agent fee tiers | Knox, Darwin, Hamilton, and Atlas run receipts now use semantic fee-tier views; `fee-tier-contract-kill` guards the path. |
| FMD audit | Rechecked the workspace; no `.fmd` or `*fmd*` files are present to audit. |

## Verification Gates

- `npm run guard:legacy`
- `npm run test:agentic`
- focused UI tests for agent launch receipts and live status
- `npm run build`
- production smoke: `/api/health` OK and unauthenticated admin execution routes return 401

## Not Active Guidance

Historical snapshots, old launch checklists, previous crawler planning, and retired deployment notes are archived under `docs/archive/`. Do not use them as implementation guidance.
