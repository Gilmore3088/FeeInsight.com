# HMDA loader: snippets for the lead

Two registry sources: `hmda` (year + state partitions, e.g. `2025-CA`) and `hmda-apor`
(one fixed partition, `current`). Tables are in `migration-fragments/hmda.sql`.

## src/lib/agents/magellan/registry/index.ts

Import:

```ts
import { HMDA_APOR_PARTITION, HMDA_APOR_SOURCE, HMDA_SOURCE, runRegistryHmda, runRegistryHmdaApor } from "./hmda";
```

REGISTRY_SOURCES entries (after the FDIC SOD entry, so branch counties exist first):

```ts
  {
    source: HMDA_SOURCE,
    stepKey: "registry-hmda",
    title: "Pull HMDA mortgage originations by lender, county and metro (one year and state)",
    run: async (input) => {
      const r = await runRegistryHmda({ runId: input.runId, partitionKey: input.partitionKey, dryRun: input.dryRun, db: input.db });
      const gaps = r.missingFields.length > 0 ? `; fields never present: ${r.missingFields.join(", ")}` : "";
      const tie =
        r.reconciliationCountDifference === null
          ? "; could not check against the Data Browser count"
          : r.reconciliationCountDifference !== 0
            ? `; ${n(Math.abs(r.reconciliationCountDifference))} loans off the Data Browser count`
            : "";
      return {
        summary: r.empty
          ? `No HMDA originations loaded for ${r.partitionKey}: ${r.emptyReason}.`
          : `Magellan read ${n(r.originations)} HMDA originations for ${r.partitionKey} from ${n(r.lenders)} lenders: ${n(r.writtenOriginationRows)} lender-county rows and ${n(r.writtenCostRows)} loan-cost rows written, ${n(r.matchedLenders)} lenders matched to an institution we track${tie}${gaps}${dry(r.dryRun)}.`,
        detail: {
          source_url: r.sourceUrl,
          bytes: r.bytes,
          originations: r.originations,
          origination_amount: r.originationAmount,
          lenders: r.lenders,
          matched_lenders: r.matchedLenders,
          unmatched_lenders: r.unmatchedLenders,
          origination_cells: r.originationCells,
          cost_cells: r.costCells,
          written_origination_rows: r.writtenOriginationRows,
          written_cost_rows: r.writtenCostRows,
          removed_stale_rows: r.removedStaleRows,
          missing_fields: r.missingFields,
          panel_available: r.panelAvailable,
          cleaning: r.cleaning,
          empty: r.empty,
          empty_reason: r.emptyReason,
        },
      };
    },
  },
  {
    source: HMDA_APOR_SOURCE,
    stepKey: "registry-hmda-apor",
    title: "Pull CFPB average prime offer rate (APOR) tables",
    fixedPartition: HMDA_APOR_PARTITION,
    run: async (input) => {
      const r = await runRegistryHmdaApor({ runId: input.runId, partitionKey: input.partitionKey, dryRun: input.dryRun, db: input.db });
      return {
        summary: r.empty
          ? `No APOR rates loaded: ${r.emptyReason}.`
          : `Magellan read ${n(r.rates)} APOR rates through ${r.latestEffectiveDate}: ${n(r.writtenRows)} written${dry(r.dryRun)}.`,
        detail: { source_url: r.sourceUrl, rates: r.rates, latest_effective_date: r.latestEffectiveDate, written_rows: r.writtenRows, tables: r.tables, empty: r.empty, empty_reason: r.emptyReason },
      };
    },
  },
```

## src/lib/agents/registry-scheduler.ts

Import:

```ts
import {
  HMDA_APOR_PARSER_VERSION,
  HMDA_APOR_SOURCE,
  HMDA_PARSER_VERSION,
  HMDA_SOURCE,
  hmdaPartitions,
} from "@/lib/agents/magellan/registry/hmda";
```

REGISTRY_PARSER_VERSIONS:

```ts
  [HMDA_SOURCE]: HMDA_PARSER_VERSION,
  [HMDA_APOR_SOURCE]: HMDA_APOR_PARSER_VERSION,
```

`dynamic` in registryPartitionsBySource (hmda-apor uses its fixedPartition):

```ts
    [HMDA_SOURCE]: hmdaPartitions(now, from.year),
```

## src/app/admin/data-feeds-panel.tsx

Labels:

```ts
  "hmda": "HMDA mortgage lending by lender and metro",
  "hmda-apor": "CFPB average prime offer rates",
```

Scope map:

```ts
  "hmda": "national",
  "hmda-apor": "national",
```

## src/lib/agents/magellan/AGENTS.md (versions table)

```md
| `HMDA_PARSER_VERSION` | — | v1 | `magellan/registry/hmda.ts` |
| `HMDA_APOR_PARSER_VERSION` | — | v1 | `magellan/registry/hmda.ts` |
```

## What could not be confirmed (regulator sites are blocked from the sandbox)

1. Data Browser URLs and params (`/view/csv` and `/view/aggregations` with `states`, `years`, `actions_taken=1`) and the aggregations response shape (`aggregations[0].count/sum`); a shape miss is reported as a reconciliation note and stale rows are then kept.
2. Public LAR column names (`lei`, `derived_msa_md`, `county_code`, `loan_amount`, `total_loan_costs`, `origination_charges`, `discount_points`, `lender_credits`, ...); the header is checked and a missing required column loads nothing.
3. Panel snapshot URL (`files.ffiec.cfpb.gov/static-data/snapshot/{year}/{year}_public_panel_csv.zip`) and its RSSD column name (tries `ID_RSSD`, `RESPONDENT_RSSD`, `RSSD_ID`, `RSSD`); a missing panel falls back to LEI-only matching and is reported.
4. APOR file locations and layout (S3 `cfpb-hmda-public/prod/apor/YieldTable{Fixed,Adjustable}.txt`, then ffiec.cfpb.gov); delimiter is detected, a header without numeric term columns loads nothing.
5. Whether one state-year CSV (California 2020-2021, about 1M originations, maybe 700 MB+) streams inside the 300-second tick; the first run's `bytes` and duration will tell. If it does not, split the largest states by county.

## Row estimates (estimates, not counts)

- `hmda` per year-state partition: about 1,000-60,000 lender x county rows (small states low, CA/TX/FL high) and about 300-15,000 lender x MSA loan-cost rows; about 300,000-600,000 origination rows and 100,000-200,000 cost rows per year nationally; `hmda_lenders` about 4,000-5,000 per year.
- `hmda-apor`: about 2 tables x 50 terms x 52 weeks per year of history, so roughly 5,000 rows a year, perhaps 80,000-100,000 for the full history.
