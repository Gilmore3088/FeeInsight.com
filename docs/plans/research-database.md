# Research database and publishing

The research implementation extends the existing Postgres readers and report jobs. It adds no
production migration, provider calls, external service, or parallel ingestion system.

## Operator workflow

1. Open `/admin/hamilton/research-database`. Review Hoovie's source receipts and run the
   read-only table profile. A contract alone never establishes populated or complete data.
2. Prepare a national edition or select an institution's numeric ID for a footprint brief.
   The research run appears in the normal Hamilton run ledger. Source failures fail the job.
3. Open the resulting job page, reload after preparation, and review the figures and coverage.
   The deterministic verification step replays frozen inputs, not today's changing database.
4. Publish only after editorial review. The existing Publish action records reviewer ID,
   review time and snapshot hash in the same locked transaction as publication.
5. Public `/reports/[slug]` pages show the full findings and methodology, plus an open PDF.
   The customization link opens `/pro/reports/research`, preserving the originating report
   and selected institution through the existing authentication/subscription flow.

Paid customization requires an active subscription in the server action. Private exports check
the job owner server-side. Existing owners retain API access to completed artifacts after
cancellation. Preparing a private report never publishes it.

## Data and methods

- `research_v1` is an edition in `report_jobs.params`; existing `national_index` and
  `monthly_pulse` storage types remain compatible with production constraints.
- `research-render` and `research-verify` are deterministic Hamilton ledger steps, followed
  by `report-close`. They obey the pipeline pause and do not need provider budget.
- Research reads run in a read-only repeatable-read transaction. Frozen inputs, calculations,
  metric version, fee-statistics version, git commit and hashes live in the job manifest.
- Initial curated models cover ACS county population/income, QCEW jobs/establishments,
  bank branch deposits, reported HMDA county originations, FDIC/NCUA assets, ROA, annual
  asset growth, equity/assets, loans/deposits, five verified fee categories, and directly
  loaded BLS unemployment and Federal Reserve effective funds rates.
- Financials filter to the existing authoritative FDIC/NCUA sources and matching charter.
  Balance-sheet amounts become dollars from stored thousands. Bank and credit union cohorts
  remain separate. Income-flow comparisons are not introduced, avoiding YTD/quarter mixing.
- Bank footprints use the latest SOD release. Credit union footprints use only offices in
  the latest NCUA release, with county placement accepted only for the current address hash.
  Every mapped branch county participates; missing counties are disclosed. This new research
  footprint does not change the older fee-chat competitor tool's narrower market contract.
- County medians remain county figures. Totals require complete footprint coverage. There is
  no inferred credit union branch deposit share, causal claim or composite opportunity score.
- Benchmarks require ten institutions. Fee calculations reuse `summarizeFees`, its source,
  audience, charging-basis and shared-schedule rules. Dollar and percentage fees stay separate.
- National macro observations require evidence of original-publisher ingestion after the
  recorded cutover. Transitional FRED-era fallback observations cannot enter research.
- Monthly labels compare reporting periods with the preceding public edition. A fee catalog
  refresh never becomes a claim that an institution changed a price.
- HTML, PDF and JSON exports use the same saved snapshot. Archived read verification checks
  stored hashes; new publication additionally replays calculations under the supported method.
  Preserve old method implementations when introducing a new research version.

Source and observation timestamps describe the evidence actually retained. Existing source
tables are not a complete historical revision archive: a report cannot reconstruct information
known before its capture. Frozen snapshots preserve editions going forward. The evidence cap
is 25 MB per report; exceeding it fails explicitly rather than dropping observations.

## Cadence and rollout

`RESEARCH_SCHEDULE_ENABLED=true` enables draft preparation through the existing agent tick.
It defaults off. Monthly drafts are prepared once per UTC month. Quarterly drafts are prepared
in March, June, September and December, allowing time after quarter-end filings. A transaction
lock and stable edition key prevent concurrent ticks from creating duplicate editions.
Failed editions require an operator retry; no scheduled path publishes a report.

Before enabling it, run one national pilot and one bank and credit union footprint pilot on the
deployed database. Verify exact table profiles, period freshness, county matching, benchmark
populations, HTML/PDF agreement, public downloads, account handoff and private ownership guards.
Use the run ledger for preparation failures and source readiness for ingestion failures. The
monthly/quarterly request can be made manually while rollout remains disabled.

Report views, PDF clicks, upgrade clicks, signup, completed analysis and checkout events flow
through existing Vercel Analytics. Browser-local report attribution expires after 90 days,
contains no personal data, and does not establish cross-device attribution.

## Validation and current evidence

Automated tests cover calculations, missing observations, mixed periods, identity requirements,
duplicates, zero fees, peer minimums, escaping, frozen-input replay, tampering, cancellations,
interrupted assembly, cadence and attribution. API ownership and publication gates are tested
separately. Run the normal agentic, type, lint and full-suite checks before release.

Local PostgreSQL acceptance now covers the exact readers and three synthetic pilot reports,
plus rendering and verification of a persisted report job. The first database run exposed a
manifest comparison bug missed by the original mocks; the fixed verifier retains the original
JSON preimage, with both unit and real-database regression coverage.

Three Chromium journeys pass against the dedicated local acceptance database: operator
preparation/review/publication, public reading/PDF download/login handoff, and subscriber
customization/export with another subscriber refused access. The PDF preview uses an
authenticated snapshot renderer rather than relying on a presigned HTML artifact.

Reproduce with a current local schema in `feeinsight_research_acceptance`:

```sh
DATABASE_URL="$E2E_DATABASE_URL" npx vitest run src/lib/research-database/research.db.test.ts
HAMILTON_E2E_SERVER=dev HAMILTON_E2E_CHROMIUM=/usr/bin/chromium \
  HAMILTON_E2E_REPORT_STORE=http://127.0.0.1:3320 \
  npm run test:hamilton-journeys -- research.pw.ts
```

The browser test starts a loopback-only S3 fixture; provider, billing and email credentials
remain blank. Artifacts and screenshots are in `test-results/research-acceptance/`. Their
economic values are synthetic fixtures and must never be published as research findings.

The workspace's configured connection is `localhost:5433/bfi_test`, not production. Its stopped
PostgreSQL container has been restored. Live coverage, real pilot findings and production
publication remain unverified until the production project is connected. No production data
or schema was changed during implementation.

Copy review: neutral descriptions; every displayed statistic comes from a saved result; source
periods, coverage and method are shown. CTAs describe paid customization without promises of
performance, turnaround or accuracy. No outreach is sent.
