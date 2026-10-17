# Registration: risk-and-cost area sources (worker/risk-costs)

Four new Magellan registry sources. All write to the existing `area_statistics` table through
`upsertAreaStats`; **no migration is needed**. None of them is registered yet: the snippets
below go into shared files.

| Source string | Module | Partitions |
|---|---|---|
| `uscourts-bankruptcy` | `src/lib/agents/magellan/registry/uscourts-bankruptcy.ts` | quarters, 2018Q1 to the latest quarter 45+ days past its end |
| `usda-farm` | `src/lib/agents/magellan/registry/usda-farm.ts` | the last 10 calendar years, current year first |
| `bls-oews` | `src/lib/agents/magellan/registry/bls-oews.ts` | May-estimate years, 2019 to latest (last year from May on) |
| `finra-nfcs` | `src/lib/agents/magellan/registry/finra-nfcs.ts` | waves 2024, 2021, 2018 |

Shared run path: `src/lib/agents/magellan/registry/risk-costs.ts` (`runRiskCostArea`).
Reads for Hamilton: `src/lib/data-store/risk-costs-aggregates.ts`.

## 1. `src/lib/agents/magellan/registry/index.ts`

Imports (top of file):

```ts
import { BLS_OEWS_SOURCE, runRegistryBlsOews } from "./bls-oews";
import { FINRA_NFCS_SOURCE, runRegistryFinraNfcs } from "./finra-nfcs";
import { runRegistryUsdaFarm, USDA_FARM_SOURCE } from "./usda-farm";
import { runRegistryUscourtsBankruptcy, USCOURTS_BANKRUPTCY_SOURCE } from "./uscourts-bankruptcy";
```

Entries in `REGISTRY_SOURCES` (e.g. after the IRS ZIP income entry):

```ts
  {
    source: USCOURTS_BANKRUPTCY_SOURCE,
    stepKey: "registry-uscourts-bankruptcy",
    title: "Pull US Courts bankruptcy filings by district (F-2)",
    run: async (input) => {
      const r = await runRegistryUscourtsBankruptcy({ runId: input.runId, partitionKey: input.partitionKey, dryRun: input.dryRun, db: input.db });
      return { summary: r.summary, detail: r.detail };
    },
  },
  {
    source: USDA_FARM_SOURCE,
    stepKey: "registry-usda-farm",
    title: "Pull USDA farm income by state and NASS cash rents",
    run: async (input) => {
      const r = await runRegistryUsdaFarm({ runId: input.runId, partitionKey: input.partitionKey, dryRun: input.dryRun, db: input.db });
      return { summary: r.summary, detail: { ...r.detail, nass_skipped_no_key: r.nassSkippedNoKey } };
    },
  },
  {
    source: BLS_OEWS_SOURCE,
    stepKey: "registry-bls-oews",
    title: "Pull BLS OEWS wages for bank occupations",
    run: async (input) => {
      const r = await runRegistryBlsOews({ runId: input.runId, partitionKey: input.partitionKey, dryRun: input.dryRun, db: input.db });
      return { summary: r.summary, detail: r.detail };
    },
  },
  {
    source: FINRA_NFCS_SOURCE,
    stepKey: "registry-finra-nfcs",
    title: "Pull FINRA NFCS state survey shares",
    run: async (input) => {
      const r = await runRegistryFinraNfcs({ runId: input.runId, partitionKey: input.partitionKey, dryRun: input.dryRun, db: input.db });
      return { summary: r.summary, detail: r.detail };
    },
  },
```

## 2. `src/lib/agents/registry-scheduler.ts`

Imports:

```ts
import { BLS_OEWS_PARSER_VERSION, BLS_OEWS_SOURCE, blsOewsPartitions } from "@/lib/agents/magellan/registry/bls-oews";
import { FINRA_NFCS_PARSER_VERSION, FINRA_NFCS_SOURCE, finraNfcsPartitions } from "@/lib/agents/magellan/registry/finra-nfcs";
import { USDA_FARM_PARSER_VERSION, USDA_FARM_SOURCE, usdaFarmPartitions } from "@/lib/agents/magellan/registry/usda-farm";
import {
  USCOURTS_BANKRUPTCY_PARSER_VERSION,
  USCOURTS_BANKRUPTCY_SOURCE,
  uscourtsBankruptcyPartitions,
} from "@/lib/agents/magellan/registry/uscourts-bankruptcy";
```

In `REGISTRY_PARSER_VERSIONS`:

```ts
  [USCOURTS_BANKRUPTCY_SOURCE]: USCOURTS_BANKRUPTCY_PARSER_VERSION,
  [USDA_FARM_SOURCE]: USDA_FARM_PARSER_VERSION,
  [BLS_OEWS_SOURCE]: BLS_OEWS_PARSER_VERSION,
  [FINRA_NFCS_SOURCE]: FINRA_NFCS_PARSER_VERSION,
```

In `registryPartitionsBySource` → `dynamic`:

```ts
    [USCOURTS_BANKRUPTCY_SOURCE]: uscourtsBankruptcyPartitions(now),
    [USDA_FARM_SOURCE]: usdaFarmPartitions(now),
    [BLS_OEWS_SOURCE]: blsOewsPartitions(now),
    [FINRA_NFCS_SOURCE]: finraNfcsPartitions(now),
```

## 3. `src/app/admin/data-feeds-panel.tsx`

In `FEED_LABELS`:

```ts
  "uscourts-bankruptcy": "US Courts bankruptcy filings",
  "usda-farm": "USDA farm income and cash rents",
  "bls-oews": "BLS wages for bank occupations",
  "finra-nfcs": "FINRA financial capability survey",
```

In `FEED_GROUP_OF`:

```ts
  "uscourts-bankruptcy": "economy",
  "usda-farm": "economy",
  "bls-oews": "economy",
  "finra-nfcs": "economy",
```

## 4. `src/lib/agents/magellan/AGENTS.md` — "Current versions" table

`scripts/ci-guards.sh guide-version-kill` fails until these rows are added:

```md
| `USCOURTS_BANKRUPTCY_PARSER_VERSION` | — | v1 | `magellan/registry/uscourts-bankruptcy.ts` |
| `USDA_FARM_PARSER_VERSION` | — | v1 | `magellan/registry/usda-farm.ts` |
| `BLS_OEWS_PARSER_VERSION` | — | v1 | `magellan/registry/bls-oews.ts` |
| `FINRA_NFCS_PARSER_VERSION` | — | v1 | `magellan/registry/finra-nfcs.ts` |
```

## Env vars (all optional)

| Var | Used for |
|---|---|
| `NASS_API_KEY` | NASS Quick Stats cash rents (free key). Unset: the `usda-farm` partition still loads ERS income; its detail records `nass.empty_reason = "no NASS_API_KEY set"`. The key is redacted from every stored URL. |
| `USCOURTS_F2_URL_TEMPLATE` | Overrides the F-2 workbook address; `{YYYY}`, `{MM}`, `{DD}` are the quarter end. |
| `USDA_FARM_INCOME_URL` | Direct ERS farm income CSV/zip, skipping the data-files page scan. |
| `NFCS_STATE_DATA_URL`, `NFCS_CODEBOOK_URL` | Direct 2024 respondent file and codebook, skipping the FINRA page scan (newest wave only). |

## What could not be confirmed (publisher sites are blocked from the sandbox)

Everything below is from memory and checked at run time; a gap shows up as `missing_fields`
or a named reason in the partition detail, never as a filled value.

- **US Courts F-2**: the workbook addresses (`bf_f2_three_MMDD.YYYY.xlsx`, `bf_f2_MMDD.YYYY.xlsx`)
  and table-page addresses (`/statistics/table/f-2-three-months/bankruptcy-filings/YYYY/MM/DD`)
  are guesses; the loader tries both, then any `.xlsx` linked from the table page. The header
  layout (a "Circuit and District" column, group row Total/Business/Nonbusiness, chapter row),
  the "3-Month"/"12-Month" title wording and district labels ("AL,N", "NY, E", "ME") are from
  memory. The period length is read from the title and goes into the series key
  (`bankruptcy_3mo_*` vs `bankruptcy_12mo_*`); a title for another quarter end is refused.
  US Courts' "-" (believed to mean none) is stored as null with "-" in `note`, so a state sum
  over a district showing "-" is null with the district named in the note. The TOTAL row is
  compared with the sum of districts and mismatches are listed in `detail.f2.total_vs_district_mismatches`.
  Old `.xls` workbooks are not read.
- **USDA ERS**: the data-files page address, the CSV columns (`Year`, `State`, `Amount`,
  `VariableDescriptionTotal`/`Part1`/`Part2`) and the variable wording ("Net farm income", "Net cash
  farm income", "Cash receipts value, all commodities", "Debt, total") are from memory. Matches and
  near-misses are listed in `detail.ers.matched` / `detail.ers.near_misses`. Unit is stored as
  `thousands_dollars` per the ERS documentation unless the file carries a unit column (recorded in
  `raw.unit_basis`). ERS forecasts for the current year are not flagged separately (no flag
  column is known); every extra file column is kept in `raw`.
- **NASS Quick Stats**: query `commodity_desc=RENT&source_desc=SURVEY`, the `short_desc` form
  "RENT, CASH, … - EXPENSE, MEASURED IN $ / ACRE", and county code 998 for combined counties are
  from memory; other `short_desc` values seen are listed in `detail.nass.other_short_desc`.
- **BLS OEWS**: `oesm{YY}{nat|st|ma}.zip` under `/oes/special-requests/`, workbook names
  (`national_M2024_dl.xlsx`, `state_M2024_dl.xlsx`, `MSA_M2024_dl.xlsx`), column names and
  AREA_TYPE 4 = metro / 6 = nonmetro are from memory. Each occupation's title is checked against
  the SOC title (`detail.oews.<level>.title_mismatches`). Metro `geo_code` is the BLS AREA code
  (CBSA code for MSAs; pre-2024 New England NECTA codes would not match `cbsa_code`). Metro
  `state_code` is set only for single-state metros; BLS's primary state is in `raw.prim_state`
  and is what the aggregate compares a metro with.
- **FINRA NFCS**: the download page, file names, variable names (B1, B4, J5, J20, J4),
  answer coding, `STATEQ` 1–51 alphabetical coding and weight names (`wgt_s3`, `wgt_n2`) are
  from memory. The loader therefore takes variables only from the codebook wording, refuses
  answer codes a question does not allow, and maps numeric state codes only when the codebook
  lists the 50 states and DC in alphabetical order; otherwise the question or the wave is
  recorded as not computed, with the reason in `detail.nfcs.questions`. If the page scan finds
  no codebook, set `NFCS_CODEBOOK_URL`.

## Row estimate (an estimate, not a count)

- `uscourts-bankruptcy`: ~12–17 series × ~56 states/territories + nation ≈ 700–950 rows per
  quarter; ~34 quarters (2018Q1–2026Q2) ≈ **25,000–32,000**.
- `bls-oews`: 7 occupations × 5 measures × (nation + ~54 states + ~390 metros, not every
  occupation published in every metro) ≈ 10,000–14,000 per year; 7 years ≈ **70,000–100,000**.
- `usda-farm`: ERS 4 series × ~51 ≈ 200 per year (≈ 2,000 for 10 years); NASS cash rents with a
  key ≈ 3 series × ~2,500 counties in survey years plus states ≈ 3,000–8,000 per year ≈
  **2,000 without a key, up to ~50,000 with one**.
- `finra-nfcs`: 5 questions × 52 areas × 3 waves ≈ **≤ 800**.
