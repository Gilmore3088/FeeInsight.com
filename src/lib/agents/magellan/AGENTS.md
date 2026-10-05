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
- One stored document per (institution, content hash). Content matching the latest copy
  is `unchanged`; content matching an older copy (A, B, A) reuses that document
  (`reused_documents`) instead of inserting a new row. Older duplicates carry
  `duplicate_of_id`, and a unique partial index enforces the rule.
- Treat accepted source submissions as validation-ready or manual-validation-needed when automation is stopped.
- Avoid repeatedly selecting the same failed source without a changed input, backoff expiry, or operator action.

## Discovery (the find team)

The `discover` step (`discovery.ts`) searches banks with a website but no fee link.
For one bank it reads the homepage once, then calls the specialists in `finders.ts`
in order and stops at the first link that passes the fee-page check. Each specialist
that runs writes one `pipeline_attempts` row (stage `discover`, its own strategy and
version, a typed outcome, the URLs it tried with their verdicts in `detail.trail`,
and `detail.method_version`).

| Pass | Strategy | What it tries |
| --- | --- | --- |
| 1 | `discover.known_link` | The bank's previous (unlocked) link. A locked correction is used as is, without a fetch. |
| 1 | `discover.homepage_links` | Fee-like links on the homepage (homepage request logged here). |
| 1 | `discover.sitemap` | robots.txt `Sitemap:` entries, else `/sitemap.xml`; an index opens its page/document children. |
| 1 | `discover.hub_pages` | One hop through Disclosures / Rates & Fees / Documents / Forms pages. |
| 1 | `discover.platform_paths` | Paths for the detected platform (`platform-learning.ts`). |
| 1 | `discover.common_paths` | Guessed common paths, last. |
| 2 | `discover.peer_hint` | Paths that worked for banks on the same platform in the same state. |
| 2 | `discover.site_crawl` | Same-host crawl, at most 40 requests, one at a time with a pause, robots.txt Disallow rules for FeeInsightBot respected, negative links skipped. |
| 2 | `discover.second_document` | `second-document.ts`, after the main loop: live banks with fewer than 5 published fee categories get a search for a business or other-services fee document, stored in `institution_additional_sources` (never replaces the fee link). Each bank at most monthly. |
| 3 | `discover.paid_web_search` | `paid-find.ts`, the `discover-paid` provider step (below). |

- Fee-page check (`find-validate.ts`), shared by every finder and the paid pass: HTML
  must pass `scoreFeePage` and not be a rates page; PDFs are downloaded (up to 8 MB)
  and their first pages read, so a rate sheet or press release is rejected. A PDF with
  no readable text (a scan) is accepted only on a strong fee label.
- URLs in `institution_source_profiles.rejected_source_urls` are never proposed again
  for that bank and count against their path in per-platform learning.
- Platforms (Q2, Banno/Jack Henry, Fiserv, FIS, NCR, WordPress, Drupal, and others)
  are detected from homepage signals (`site-signals.ts`) and stored on
  `institution_source_profiles.platform` (and `institution_sources.cms_platform` when
  empty). Platform paths are `platform_registry.fee_paths` plus reusable paths found
  at two or more banks on the platform, minus paths Rosetta rejected. A find updates
  `platform_registry` (validated count, institution count, promoted paths).
- A redirect to a new domain searches the new site and updates `website_url`.
- Nothing is dead forever: pending/`retry_after` banks are re-checked after 12 hours;
  misses (`dead`) after 30 days, then 90 days after two misses in a row; and every
  miss at once (after 12 hours) when `DISCOVERY_METHOD_VERSION` is newer than its last
  search. Bump that version whenever a specialist changes. A search cut short by the
  per-bank (45 s) or per-step budget is `retry_after` (`out_of_time`), then a miss after
  repeated cut-offs.
- Pass 3 (`runMagellanPaidFind`): up to `PAID_PASS_ITEMS_PER_RUN` banks in the state
  that are `dead` after a search with the current method version and had no paid try
  this month. One `paidModelCall` per bank (agent `magellan`, `PAID_PASS_MODELS.find()`,
  server `web_search` tool, max 3 uses) asks for the consumer fee schedule on the bank's
  own domain as JSON. The answer must be on the bank's domain and pass the same
  fee-page check before it is stored. Each try is logged with its cost. A budget cap or
  the automation stop ends the step cleanly (`budgetStopped`); the unspent bank stays due.

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
