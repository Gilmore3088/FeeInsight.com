# Registration: small business lending and payment volume loaders

Four sources, one module each side (`src/lib/regulatory/smallbiz-payments.ts`,
`src/lib/agents/magellan/registry/smallbiz-payments.ts`), all into the existing
`area_statistics` table. No new table and no migration.

| Source | Partitions | Rows land as |
| --- | --- | --- |
| `kcfed-sb-lending` | `current` (whole history re-read monthly) | nation, quarterly, `kcfed_sbl_<sheet>_<label>` |
| `fed-sbcs` | report years 2026 back to 2017, newest first | nation (and state when a file has a State column), `fed_sbcs_<topic>_<metric>_<lender>`; `raw_json` holds `lender_type`, `metric_key`, `topic` |
| `fed-payments` | `fedach`, `fednow`, `fed-check`, `frps` | nation, `fedach_*`, `fednow_*`, `fed_check_*`, `frps_*` |
| `nacha-volume` | `ach-network`, `same-day-ach` | nation, `nacha_ach_network_*`, `nacha_same_day_ach_*` |

## 1. `src/lib/agents/magellan/registry/index.ts`

Import beside the economy import:

```ts
import { runRegistrySmallbizPayments, SMALLBIZ_PAYMENTS_DEFINITIONS } from "./smallbiz-payments";
```

Add to `REGISTRY_SOURCES`, right after the `...ECONOMY_DEFINITIONS.map(...)` block:

```ts
  ...SMALLBIZ_PAYMENTS_DEFINITIONS.map((definition): RegistrySourceDefinition => ({
    source: definition.source,
    stepKey: `registry-${definition.source}`,
    title: definition.title,
    fixedPartition: definition.fixedPartition,
    run: async (input) => {
      const r = await runRegistrySmallbizPayments({
        source: definition.source,
        partitionKey: input.partitionKey,
        runId: input.runId,
        dryRun: input.dryRun,
        db: input.db,
      });
      return {
        summary: r.summary,
        detail: { ...r.detail, source_url: r.sourceUrl, rows: r.rows, written_rows: r.writtenRows, empty: r.empty, empty_reason: r.emptyReason },
      };
    },
  })),
```

## 2. `src/lib/agents/registry-scheduler.ts`

Import:

```ts
import { SMALLBIZ_PAYMENTS_DEFINITIONS, SMALLBIZ_PAYMENTS_PARSER_VERSION } from "@/lib/agents/magellan/registry/smallbiz-payments";
```

In `REGISTRY_PARSER_VERSIONS`, after the economy line:

```ts
  ...Object.fromEntries(SMALLBIZ_PAYMENTS_DEFINITIONS.map((d) => [d.source, SMALLBIZ_PAYMENTS_PARSER_VERSION])),
```

In `registryPartitionsBySource`'s `dynamic` map, after the economy line (kcfed-sb-lending has a
fixed partition, so it is filtered out like the economy fixed sources):

```ts
    ...Object.fromEntries(SMALLBIZ_PAYMENTS_DEFINITIONS.filter((d) => !d.fixedPartition).map((d) => [d.source, d.partitions(now)])),
```

## 3. `src/app/admin/data-feeds-panel.tsx`

In `FEED_LABELS`:

```ts
  "kcfed-sb-lending": "KC Fed small business lending survey",
  "fed-sbcs": "Fed Small Business Credit Survey (by lender type)",
  "fed-payments": "FedACH, FedNow, Fed check and Payments Study volumes",
  "nacha-volume": "Nacha ACH Network and Same Day ACH volumes",
```

In `FEED_GROUP_OF`:

```ts
  "kcfed-sb-lending": "economy",
  "fed-sbcs": "economy",
  "fed-payments": "economy",
  "nacha-volume": "economy",
```

## 4. `src/lib/agents/magellan/AGENTS.md` (versions table)

```md
| `SMALLBIZ_PAYMENTS_PARSER_VERSION` | — | v1 | `magellan/registry/smallbiz-payments.ts` (kcfed-sb-lending, fed-sbcs, fed-payments, nacha-volume) |
```

## Optional configuration (no keys; all free)

Each step finds its file or page on its own. When a publisher moves it, point the step at the
current address; nothing else changes:

| Env var | Used for |
| --- | --- |
| `KCFED_SBLS_DATA_URL` | The survey's data workbook or CSV (skips the survey-page link search) |
| `FED_SBCS_DATA_URL` | SBCS chart-data file, with `{year}` for the report year |
| `FED_SBCS_STATE_DATA_URL` | SBCS state-level data file, with `{year}` |
| `FEDACH_VOLUME_URL`, `FEDNOW_VOLUME_URL`, `FED_CHECK_VOLUME_URL` | The frbservices.org quarterly statistics pages |
| `FED_PAYMENTS_STUDY_URL` | A Payments Study page or data file |
| `NACHA_ACH_VOLUME_URL`, `NACHA_SAME_DAY_ACH_URL` | Nacha's statistics pages |

## Not confirmed (publisher sites were blocked from the build sandbox)

Everything below is from memory and is checked at run time. Absent labels are listed in the
partition's `detail.missing_fields`; a page or file that cannot be found is recorded empty with
the reason and the env var to set. Nothing is filled in or defaulted.

- **KC Fed SBLS**: the survey page address, that it links an `.xlsx`/`.csv` data file (the step
  takes the first link whose text or address says "data"), and the sheet layout. Expected labels:
  interest rate, loan volume, credit standards, loan demand, C&I, CRE, equipment. If the survey
  publishes only PDFs, the partition stays empty with that reason. Fee series ("loan fees") were
  asked for; whether the survey reports them is unconfirmed, and no fee label is required.
- **SBCS**: the report-page addresses (`/reports/survey/<year>/<year>-report-on-employer-firms`
  and two fallbacks), whether each year's report links chart data as `.xlsx`/`.csv`, and the
  chart sheets' layout (lender types down the rows or across the header; a State column for
  state tables). If a year is PDF-only, it is recorded empty saying so. `period` is the report
  year (the survey is fielded the autumn before); `raw_json.report_year` says so. Values stored
  as decimals with no "%" get unit `ratio (as stored)` rather than being rescaled.
- **frbservices.org**: the three quarterly-statistics page addresses (the FedNow one least
  certain; a second address is tried) and their table layout (quarters down a column with the
  year in the heading above, or years and quarters across). Volume and value scale (thousands,
  millions) is taken from the column label or table heading; when neither states it the unit is
  plain `count` / `dollars`.
- **Fed Payments Study**: whether the study page carries HTML tables or links an `.xlsx`/`.csv`.
  Tables with a repeated year in one header (number and value side by side under one band) read
  only the columns that parse; a CAGR column is not loaded.
- **Nacha**: both page addresses, and whether the figures are HTML tables rather than images or
  PDF. If no table is found, the partition is empty with "No dated volume or value table found".

## Row estimate (an estimate, not a count)

- kcfed-sb-lending: about 20 to 40 series x 20 to 30 quarters, roughly 400 to 1,200 rows.
- fed-sbcs: about 30 to 120 national rows per report year (3 topics x 2 to 6 metrics x 5 to 6
  lender types), up to ~1,000 over 2017-2026; plus up to ~50 states x a few metrics per year if a
  state file is found.
- fed-payments: FedACH and Fed check about 4 to 8 series x 40 to 80 quarters each (300 to 600
  rows each); FedNow about 3 to 5 series x 13 quarters (~50 rows); Payments Study about 50 to 200.
- nacha-volume: about 2 to 6 series x 10 to 40 periods per page (20 to 240 rows each).
- Total if every source is found and readable: roughly 1,500 to 4,000 rows. If a page is PDF or
  image only, that source contributes none and says why.
