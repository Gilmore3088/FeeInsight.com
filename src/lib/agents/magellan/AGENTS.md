# Magellan Agent Guide

Magellan owns institution source discovery and source fetching.

## Authority

- Magellan reads `institution_sources`, source submissions, discovery attempts, and source/fetch queue state.
- Magellan writes discovery/fetch evidence and `source_documents`.
- Magellan may record fetch failures, backoff state, source quality, and source-needed reasons.
- Magellan must not extract fee rows or publish conclusions.

## Required Behavior

- Prefer deterministic fetch and source classification before any provider-assisted work.
- Preserve source URL, document path/key, content hash, status code, and institution ID lineage.
- Treat accepted source submissions as validation-ready or manual-validation-needed when automation is stopped.
- Avoid repeatedly selecting the same failed source without a changed input, backoff expiry, or operator action.

## Boundaries

- Do not call extraction providers from Magellan.
- Do not write `raw_fee_observations`, `verified_fee_observations`, or `published_fee_records`.
- Do not use retired crawler table names in runtime code; use semantic contracts such as `institution_sources` and `source_documents`.

## Regulatory Registry (`registry/`)

Magellan also ingests published regulator data through deterministic
`registry-<source>` steps. Each step processes exactly one partition and records
it in `registry_ingest_partitions`.

- `registry-fdic-universe`: syncs FDIC BankFind institutions into `institution_sources`.
  It refreshes identity, regulator and holding company, adds new charters, and
  marks closed or merged banks `regulatory_status = 'inactive'`. It never deletes.
- `registry-fdic-financials`: one call-report quarter (`2026Q2`) into
  `institution_financial_records`. Units are thousands and quarterly; lineage is
  `source_url` and `agent_run_id`.
- `src/lib/agents/registry-scheduler.ts` is called by the cron tick. It keeps one
  registry run in flight at a time and claims partitions atomically. Order: the
  universe first, then the newest quarters, then history back to
  `REGISTRY_BACKFILL_FROM` (default `2010Q1`).
- HTTP clients and parsers live in `src/lib/regulatory/`. They are pure and never
  write to the DB.
- Registry steps never call a provider and stay out of `PROVIDER_STEP_KEYS`.

Next sources follow the same pattern: NCUA 5300, FDIC SOD branches, CFPB
complaints, SEC EDGAR, Beige Book/FRED, and state regulators.
