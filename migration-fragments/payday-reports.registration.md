# state-payday-reports: registration snippets

Module: `src/lib/agents/magellan/registry/payday-reports.ts`. It writes only to `area_statistics`
(state, report year); no SQL is needed.

## src/lib/agents/magellan/registry/index.ts

```ts
import { PAYDAY_REPORTS_SOURCE, runRegistryPaydayReports } from "./payday-reports";

{
  source: PAYDAY_REPORTS_SOURCE,
  stepKey: "registry-state-payday-reports",
  title: "Read state payday and small-dollar lending annual reports",
  run: async (input) => {
    const r = await runRegistryPaydayReports({ runId: input.runId, partitionKey: input.partitionKey, dryRun: input.dryRun, db: input.db });
    return {
      summary: r.summary,
      detail: { source_url: r.sourceUrl, rows: r.rows, written_rows: r.writtenRows, missing_fields: r.missingFields, dry_run: r.dryRun, empty: r.empty, empty_reason: r.emptyReason },
    };
  },
},
```

## src/lib/agents/registry-scheduler.ts

```ts
import { PAYDAY_REPORTS_PARSER_VERSION, PAYDAY_REPORTS_SOURCE, paydayReportsPartitions } from "@/lib/agents/magellan/registry/payday-reports";
// REGISTRY_PARSER_VERSIONS
[PAYDAY_REPORTS_SOURCE]: PAYDAY_REPORTS_PARSER_VERSION,
// partitions map
[PAYDAY_REPORTS_SOURCE]: paydayReportsPartitions(now),
```

## src/app/admin/data-feeds-panel.tsx

```ts
"state-payday-reports": "State payday and small-dollar lending reports (WA, TX)",
// group
"state-payday-reports": "economy",
```

## src/lib/agents/magellan/AGENTS.md

```
| `PAYDAY_REPORTS_PARSER_VERSION` | — | v1 | `magellan/registry/payday-reports.ts` |
```

## How figures are read, and what is not confirmed

- The reports are PDFs. Text comes from unpdf, with lines rebuilt by Rosetta's `layoutPageText`.
  A metric is stored only when its label sits on exactly one line and is followed by exactly one number.
  Anything else (no label, a label on several lines, a table row with several numbers) is named in
  `missing_fields` with the reason. Nothing is derived from totals.
- The metric labels are from memory, not from the PDFs. Expect the first run to show which ones read.
  The Texas OCCC report breaks its figures out by product (single payday, installment payday, auto title),
  so most Texas labels will likely repeat and be reported ambiguous rather than loaded. A Texas-specific
  table reader needs someone to look at the PDF first.
- File URLs: Washington 2018, 2023 and 2024 and Texas 2018-2020 and 2022-2025 come from search results.
  Other Washington years come from the reports index page (`dfi.wa.gov/reports/payday-lending-reports`)
  and require exactly one PDF link that names the year.
- Not wired, because no report file was confirmed: California DFPI (deferred deposit), Florida OFR
  (deferred presentment), Colorado, Illinois and others.

## Row estimate (an estimate)

At most 9 figures per state-year, so at most 2 states x 8 years x 9 figures = 144 values.
Realistically fewer, until the labels are checked against the PDFs.
