# feeschedule-hub — Bank Fee Index

## Brand
Fee Insight is the company and site (feeinsight.com). Bank Fee Index is its product
(the dataset/index); Hamilton is the Pro workspace. Never name the site as the product.
Brand strings live in `src/lib/constants.ts`; `scripts/ci-guards.sh brand-kill` enforces it.
Contact stays hello@bankfeeindex.com until feeinsight.com mail exists.

## Design
Headings never wrap a single word onto its own line. `src/app/globals.css` and
`Reports/studio/template.html` balance h1-h4 (`text-wrap: balance`) and give body text
`text-wrap: pretty`; don't override that per page. `scripts/ci-guards.sh heading-wrap-kill` enforces it.

## Migrations
`supabase/migrations/` must match prod's migration history (`supabase_migrations.schema_migrations`)
file for file, so Supabase's GitHub deploy never re-runs applied SQL. Name a new file with a
14-digit number one higher than the highest file already there (e.g. `20270109000000_name.sql`),
never a lower or duplicate number. A file run by hand in the SQL editor also needs its history
row recorded (a sql-to-run issue). `scripts/ci-guards.sh migration-version-kill` enforces the names.

## Money-Thesis
A bank/CU marketing or product manager pays ~$300 for a competitive fee report for
their market. Why us: live verified fee data (published_fee_catalog) + banking domain
expertise. Kept fully separate from the CSI day job.

## Status
ACTIVE (slot 1 of 1). Milestone: all 25 competitive fee reports RENDERED
(Reports/studio/out/, brand-matched to Hamilton system). Distance to first dollar:
your review pass + finding contacts + sending.

## Next action
Review the 25 PDFs in Reports/studio/out/ (flag any narrative to fix), then find one
contact per institution and send using Reports/studio/outreach-template.md. Log
everything in outreach-log.md.

# Agent Guidance

This repo no longer uses the Python `fee_crawler` runtime, Modal workers,
`ops_jobs`, or generic CLI job launchers as active execution paths.

## Current Runtime

- Next.js 16 / React 19 / TypeScript is the application and agent control plane.
- Vercel/Next API routes are the runtime boundary; Supabase Edge Functions are
  not an active product or agent execution surface in this repo.
- Supabase Postgres is the source of truth for institutions, fee data,
  `agent_runs`, `agent_run_steps`, `agent_run_events`, provider usage, and
  review queues.
- The active worker contract is `EXECUTION_BACKEND=agentic_v1`.
- Provider SDK/model construction is centralized in `src/lib/ai-provider.ts`;
  direct Anthropic SDK imports elsewhere are blocked by `provider-kill`.
- Current Postgres data access is `src/lib/data-store`; do not reintroduce the
  retired crawler-named data module.
- App code uses the physical semantic tables `institution_sources`,
  `source_documents`, `source_collection_runs`, and `agent_source_texts` for
  source/institution/document/text access.
- Knox, Darwin, and Hamilton use `raw_fee_observations`,
  `verified_fee_observations`, and `published_fee_records` as their fee-tier
  write/read boundaries.
- Atlas creates visible runs; Magellan discovers/fetches; Rosetta reads
  fetched HTML/text and extractable PDF text, while scanned/image-only PDFs are
  marked `needs_ocr`; Knox extracts conservative raw fee observations and
  performs conservative ready-review; Darwin verifies canonical-hinted raw rows;
  Hamilton publishes eligible verified observations into published fee records.
  Product/report/research fee reads use `published_fee_catalog`.
  Scanned-PDF OCR, provider-assisted extraction, adversarial handling for
  ambiguous rows, report rendering, and durable queue fan-out remain explicit
  follow-up work.

## Hard Rules

- Do not add Modal endpoints, Modal env vars, or `.modal.run` URLs.
- Do not reintroduce `fee_crawler`, `python -m fee_crawler`, Python crawler
  tests, or pytest setup.
- Do not add Supabase Edge Functions as a parallel runtime; use typed Next
  routes and agent modules with run-ledger visibility.
- Do not use `ops_jobs`, `ops_job_id`, `modal_call_id`, `modalCallId`, or
  `spawnJob`.
- Do not make hidden provider calls while billing/provider health is broken.
- Every agent action must create or update a visible agent run/step/event.
- Do not reintroduce a public prelaunch proxy gate that serves a parallel static
  site instead of the App Router pages.
- Do not read `extracted_fees` anywhere. It was renamed to an archive table and
  `fee-read-model-kill` blocks it; product, report, Scout, public API, research,
  market, peer, state, and analytics reads must use `published_fee_catalog`.
- Two separate controls gate agent work (`src/lib/automation-control.ts`): the
  `global` provider stop blocks only provider steps (`PROVIDER_STEP_KEYS` in
  `src/lib/agents/types.ts`, paid model calls), and the `pipeline` control pauses
  deterministic steps. The cron tick checks the provider budget policy only when
  a provider step is queued. Do not gate deterministic work on provider budget.
- Do not query historical source tables directly from app code. `source-read-model-kill`
  scans all of `src/`; use the semantic source contracts instead.
- Document agents must use `institution_id`, `source_document_id`, and
  `agent_source_texts`. `agent-source-contract-kill` blocks crawler-era source
  column names in Magellan fetch, Rosetta read, Knox extract, and Atlas run-store.
- Fee-tier agents must use semantic tier contracts. `fee-tier-contract-kill` blocks
  direct `fees_raw`, `fees_verified`, `fees_published`, and `crawl_event_id`
  usage in Knox extract, Darwin verify, Hamilton publish, and Atlas run-store.

## Current Source Of Truth

- `AGENTS.md` (agent roster, data boundaries, product rules, verification gates)
- `src/lib/agents/AGENTS.md` and per-agent `AGENTS.md` files (pipeline architecture:
  Atlas -> Magellan -> Rosetta -> Knox -> Darwin -> Hamilton)
- `docs/plans/agentic-codebase-cleanup-2026-08-13.md`
- `src/lib/agents/run-store.ts`
- `src/lib/ai-provider.ts`
- `src/lib/data-store/connection.ts`
- `src/lib/execution-backend.ts`
- `scripts/ci-guards.sh`

Historical docs that reference Modal, `fee_crawler`, SQLite, or `ops_jobs` live
under `docs/archive/` and are not current implementation guidance.

The only current scripts are the production-route build check and CI guardrails.
Do not add one-off data mutation, dedupe, migration, crawler, or provider
scripts; those belong in typed agent modules with run-ledger visibility.
