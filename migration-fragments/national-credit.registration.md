# national-credit: registration snippets

Four sources in one module, parser version 1 (`NATIONAL_CREDIT_PARSER_VERSION`), all writing to
`area_statistics` through `upsertAreaStats`. No new tables and no migration.

| Source | Partitions | Geography | Refresh (set by the step) |
| --- | --- | --- | --- |
| `national-series` | the current month only, e.g. `2026-10` (new key each month) | nation | 7 days; empty 24 h |
| `nyfed-household-debt` | `current` | state + nation (if the workbook has a US row) | 14 days; empty 7 days |
| `nyfed-sce-credit` | `current` | nation | 30 days; empty 7 days |
| `cfpb-credit-trends` | `current` | nation | 30 days; empty 7 days |

Why one month partition for FRED: every graph CSV carries the series' whole history, so each run
re-reads everything since 2000-01-01 and upserts in place. A per-month key gives one ledger row per
month (what that month's runs saw: series returned, series missing), and the weekly refresh inside
the month picks up new H.8/PMMS weeks. Last month's key drops off the list and keeps its last result.

## 1. `src/lib/agents/magellan/registry/index.ts`

Import:

```ts
import { NATIONAL_CREDIT_DEFINITIONS, runRegistryNationalCredit } from "./national-credit";
```

`REGISTRY_SOURCES` entries (next to the `...ECONOMY_DEFINITIONS.map(...)` block):

```ts
  ...NATIONAL_CREDIT_DEFINITIONS.map((definition): RegistrySourceDefinition => ({
    source: definition.source,
    stepKey: `registry-${definition.source}`,
    title: definition.title,
    fixedPartition: definition.fixedPartition,
    run: async (input) => {
      const r = await runRegistryNationalCredit({
        source: definition.source,
        partitionKey: input.partitionKey,
        runId: input.runId,
        dryRun: input.dryRun,
        db: input.db,
      });
      return {
        summary: r.summary,
        detail: {
          ...r.detail,
          source_url: r.sourceUrl,
          rows: r.rows,
          written_rows: r.writtenRows,
          missing_fields: r.missingFields,
          unexpected_fields: r.unexpectedFields,
          empty: r.empty,
          empty_reason: r.emptyReason,
        },
      };
    },
  })),
```

## 2. `src/lib/agents/registry-scheduler.ts`

Import:

```ts
import { NATIONAL_CREDIT_DEFINITIONS, NATIONAL_CREDIT_PARSER_VERSION } from "@/lib/agents/magellan/registry/national-credit";
```

`REGISTRY_PARSER_VERSIONS`:

```ts
  ...Object.fromEntries(NATIONAL_CREDIT_DEFINITIONS.map((d) => [d.source, NATIONAL_CREDIT_PARSER_VERSION])),
```

`registryPartitionsBySource` (`dynamic`; the three `current` sources use `fixedPartition`):

```ts
    ...Object.fromEntries(NATIONAL_CREDIT_DEFINITIONS.filter((d) => !d.fixedPartition).map((d) => [d.source, d.partitions(now)])),
```

`national-series` makes ~35 sequential FRED requests per run (one per configured series).

## 3. `src/app/admin/data-feeds-panel.tsx`

```ts
  // FEED_LABELS
  "national-series": "National credit series (FRED: H.8, PMMS, SLOOS, large-bank cards, CRE)",
  "nyfed-household-debt": "NY Fed household debt by state",
  "nyfed-sce-credit": "NY Fed consumer credit access survey",
  "cfpb-credit-trends": "CFPB Consumer Credit Trends originations",
  // FEED_GROUP_OF
  "national-series": "economy",
  "nyfed-household-debt": "economy",
  "nyfed-sce-credit": "economy",
  "cfpb-credit-trends": "economy",
```

## 4. `src/lib/agents/magellan/AGENTS.md` versions table

```md
| `NATIONAL_CREDIT_PARSER_VERSION` | — | v1 | `magellan/registry/national-credit.ts` (4 sources: national-series, nyfed-household-debt, nyfed-sce-credit, cfpb-credit-trends) |
```

## 5. Optional URL overrides (not keys; every source is keyless)

- `NYFED_HHDC_STATE_XLSX_URL`: the state-level Household Debt and Credit workbook, if the default is wrong.
- `NYFED_SCE_CREDIT_XLSX_URL`: the SCE Credit Access chart-data workbook, if the default is wrong.

Unset, the step tries the remembered default; a 404/403 records the partition empty with the
URL tried and the variable to set. Nothing fails.

## 6. What could not be confirmed (every publisher site was unreachable from the sandbox)

1. **FRED series ids.** Each CSV header must name the id asked for, so a wrong id shows up as
   `<ID> (HTTP 404)` or `<ID> (header names …)` in `missing_fields` and loads nothing. Fairly sure:
   DPSACBW027SBOG, TOTLL, TOTCI, MORTGAGE30US, MORTGAGE15US, DRTSCILM, DRTSCIS, DRSDCILM, DRSDCIS,
   DRTSCLCC, DEMCC, STDSAUTO, DEMAUTO, CREACBW027SBOG, DRCRELEXFACBS, DRCCLACBS, DRCLACBS.
   Less sure (sibling-pattern guesses): DPSLCBW027SBOG, DPSSCBW027SBOG, LLBLCBW027SBOG,
   LLBSCBW027SBOG, CCLACBW027SBOG, CLSACBW027SBOG, RREACBW027SBOG, CRELCBW027SBOG, CRESCBW027SBOG,
   DRTSCLNG, DRTSSP, BOGZ1FL893065505Q, BOGZ1FL763065505Q. Least sure: all five Philadelphia Fed
   large-bank card ids (RCCCBAPRAVGPCTGP, RCCCBBALTOT, RCCCBUTILAVGPCT, RCCCBPMTMINPCT,
   RCCCBPMTFULLPCT). The first run's `per_series` detail says exactly which came back; fix the
   list in `NATIONAL_SERIES` from that, never by substituting.
2. **FRED frequencies and units** are configured, not read: H.8 weekly billions of dollars (SA),
   PMMS weekly percent, SLOOS/LBCCM/Z.1/delinquency quarterly. A date that does not fit the
   configured frequency is counted in `skipped_records` (`<ID>:date_not_quarterly`), not loaded.
   LBCCM total balances are stored as `billions_dollars` and Z.1 levels as `millions_dollars`,
   both unconfirmed.
3. **NY Fed household debt workbook**: URL `…/householdcredit/data/xls/area_report_by_year.xlsx`,
   one sheet per loan type (`auto`, `creditcard`, `mortgage`, `studentloan`, plus `_delinq`
   twins), a `state` column and period columns (`Q4_2003` style). The parser reads any period
   label (`Q4_2003`, `2003Q4`, `03:Q1`, bare `2003`, which stays an annual period `2003`, not
   assumed Q4). It checks for a "per capita" / "90" label above each table and names it in
   `missing_fields` when absent; unknown sheets and columns go to `unexpected_fields`. Whether
   the file is quarterly or annual (Q4 only) and whether it has a US row are unconfirmed; with no
   US row, the state-vs-nation aggregate returns `national_value: null` (it never averages
   states into a national figure).
4. **NY Fed SCE credit access**: URL
   `…/sce/sce/downloads/data/frbny-sce-credit-access-chart-data.xlsx` is a guess. Every sheet with
   a date-like heading is read; series keys are built from the sheet and column names, so the
   exact keys are known only after the first run. Values are stored with unit `as_published`
   because the shares may be percents or fractions. Required labels checked: application,
   rejection, discouraged.
5. **CFPB Consumer Credit Trends**: `files.consumerfinance.gov/data/consumer-credit-trends/<dir>/
   {num,vol}_data_{CRC,AUT,MTG,STU}.csv` with columns `month,date,num,num_unadj` (vol likewise).
   Directory spellings `credit_cards`/`credit-cards` etc. are both tried. Volume is stored with
   unit `as_published` (dollars vs millions unconfirmed).
6. **Delinquency from CFPB**: not loaded. The Consumer Credit Trends downloads I know of cover
   originations (count, volume, by score/age/income/geography), not delinquency; I did not invent
   a file name. Bank delinquency rates (credit cards, consumer, CRE) come in through
   `national-series` instead (DRCCLACBS, DRCLACBS, DRCRELEXFACBS), and NY Fed 90+ day delinquency
   by state through `nyfed-household-debt`.

## 7. Row estimates (estimates, not counts)

- `national-series`: ~35 series since 2000. Weekly (15 series) ~1,400 rows each ≈ 21,000;
  quarterly (~20 series) ~100 rows each ≈ 2,000 (LBCCM starts ~2012, so fewer). Total ≈ 23,000,
  fewer for every id FRED does not return.
- `nyfed-household-debt`: 8 sheets × ~52 states/areas × ~21 years (annual) ≈ 8,700; if quarterly,
  ≈ 35,000.
- `nyfed-sce-credit`: ~30 waves since 2013 × ~20–60 columns ≈ 600–1,800.
- `cfpb-credit-trends`: 4 markets × 2 files × 2 columns × ~310 months ≈ 5,000.
