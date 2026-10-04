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
`registry-<source>` steps. Each step processes exactly one partition, records it
in `registry_ingest_partitions`, and keeps lineage (`source_url`, `agent_run_id`).
Steps never call a provider and stay out of `PROVIDER_STEP_KEYS`.

| Step | Partition | Writes |
| --- | --- | --- |
| `registry-fdic-universe` | `current` (weekly) | `institution_sources`: identity, holding company, regulator; adds charters, marks closed/merged inactive |
| `registry-fdic-financials` | quarter `2026Q2` | `institution_financial_records` (`fdic`, thousands, quarterly) |
| `registry-ncua-financials` | quarter | `institution_financial_records` (`ncua`, thousands, income YTD); newest quarter also syncs the credit-union universe |
| `registry-fdic-sod` | year | `institution_branch_deposits` |
| `registry-cfpb` | year | `institution_identity_links` (`cfpb_company`), `institution_complaint_records` |
| `registry-sec-links` | `current` | `institution_identity_links` (`sec_cik`), `institution_sources.sec_cik` |
| `registry-sec-filings` | `batch-0`..`batch-7` | `institution_filings`, `holding_company_financials` |
| `registry-beige-book` | release `YYYYMM` | `fed_beige_book` |
| `registry-fred` | `current` | `fed_economic_indicators` (FRED-native series only) |
| `registry-state-regulators` | `current` | `state_regulators`, credit-union charter agency |

- Pure HTTP clients and parsers are in `src/lib/regulatory/` and never write to the DB.
- `src/lib/agents/registry-scheduler.ts` runs from the cron tick and keeps one registry run in flight. It merges candidates round-robin across sources, newest partition first, and backfills to `REGISTRY_BACKFILL_FROM` (default `2010Q1`).
- Identity matching (`registry/identity.ts`) accepts only unambiguous names. Shared names are stored as `needs_review` and never used until a person accepts them. Links with `verified_by` set are never overwritten.
- Operator view: `/admin/magellan/registry`. Manual queue: `POST /api/admin/registry/run` with `{ source, partition_key?, dry_run? }`.
- Add a source: write a client in `regulatory/`, a worker in `registry/`, an entry in `REGISTRY_SOURCES` (`registry/index.ts`), a scheduler partition list, and a `narrate.ts` sentence. `run-store.ts` dispatches every `registry-*` key automatically.
