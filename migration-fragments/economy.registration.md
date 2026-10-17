# Economy loaders: registration snippets

Module: `src/lib/agents/magellan/registry/economy.ts` (one dispatcher, 16 sources, each its own
partition family and step key `registry-<source>`). Pure parsers: `src/lib/regulatory/economy.ts`.
Reads: `src/lib/data-store/economy-aggregates.ts`. SQL: `migration-fragments/economy.sql`.

## 1. `src/lib/agents/magellan/registry/index.ts`

```ts
import { ECONOMY_DEFINITIONS, runRegistryEconomy } from "./economy";

// inside REGISTRY_SOURCES, after the IRS ZIP income entry:
  ...ECONOMY_DEFINITIONS.map((definition): RegistrySourceDefinition => ({
    source: definition.source,
    stepKey: `registry-${definition.source}`,
    title: definition.title,
    fixedPartition: definition.fixedPartition,
    run: async (input) => {
      const r = await runRegistryEconomy({
        source: definition.source,
        partitionKey: input.partitionKey,
        runId: input.runId,
        dryRun: input.dryRun,
        db: input.db,
      });
      return {
        summary: r.summary,
        detail: { ...r.detail, source_url: r.sourceUrl, rows: r.rows, written_rows: r.writtenRows, empty: r.empty, empty_reason: r.emptyReason },
        skipped: r.skipped,
      };
    },
  })),
```

## 2. `src/lib/agents/registry-scheduler.ts`

```ts
import { ECONOMY_DEFINITIONS, ECONOMY_PARSER_VERSION } from "@/lib/agents/magellan/registry/economy";

// REGISTRY_PARSER_VERSIONS:
  ...Object.fromEntries(ECONOMY_DEFINITIONS.map((d) => [d.source, ECONOMY_PARSER_VERSION])),

// registryPartitionsBySource -> dynamic (fixed-partition ones come from REGISTRY_SOURCES anyway):
  ...Object.fromEntries(ECONOMY_DEFINITIONS.filter((d) => !d.fixedPartition).map((d) => [d.source, d.partitions(now)])),
```

CBP and SAIPE record a missing Census key with the reason prefix `No CENSUS_API_KEY set`, so the
existing `KEYLESS_SKIP_REASON` re-check picks them up as soon as a key is set. BEA (`BEA_API_KEY`),
HUD (`HUD_USER_TOKEN`) and the URL-configured feeds retry on their own schedule (daily / weekly).

## 3. `src/app/admin/data-feeds-panel.tsx`

FEED labels:
```ts
  "usda-rucc": "USDA rural-urban codes by county",
  "ffiec-census-tracts": "FFIEC census tract income levels",
  "branch-census-tracts": "Branches placed in census tracts",
  "urban-rural-fill": "Urban/rural from HQ county (proposal)",
  "bls-qcew": "BLS county jobs and wages (QCEW)",
  "census-cbp": "Census County Business Patterns",
  "census-saipe": "Census county poverty (SAIPE)",
  "bea-personal-income": "BEA personal income by county",
  "fhfa-hpi": "FHFA house price index",
  "fdic-household-survey": "FDIC unbanked and underbanked survey",
  "fed-shed": "Fed household survey (SHED) banking questions",
  "fdic-industry-totals": "FDIC industry totals",
  "fdic-national-rates": "FDIC national rates and rate caps",
  "atlanta-fed-payment-choice": "Atlanta Fed consumer payment choice",
  "world-bank-remittance-prices": "World Bank remittance prices (US send)",
  "hud-zip-county": "HUD ZIP-to-county crosswalk",
```
FEED_GROUP_OF: all sixteen -> `"economy"`. Also add the sixteen to the source list in
`data-feeds-panel.test.tsx` if that test enumerates every registry source.

## 4. `src/lib/agents/magellan/AGENTS.md` versions table

```
| `ECONOMY_PARSER_VERSION` | — | v1 | `magellan/registry/economy.ts` (16 economy sources) |
```

## 5. Environment (all optional; each missing one skips its step with a stated reason)

| Variable | Used by | Without it |
|---|---|---|
| `CENSUS_API_KEY` | census-cbp, census-saipe | skipped daily, re-run when set |
| `BEA_API_KEY` | bea-personal-income | skipped, re-checked daily |
| `HUD_USER_TOKEN` | hud-zip-county | skipped, re-checked daily |
| `FDIC_HOUSEHOLD_SURVEY_CSV_URL` (`{year}` placeholder allowed) | fdic-household-survey | skipped weekly |
| `FDIC_NATIONAL_RATES_CSV_URL` | fdic-national-rates | skipped weekly |
| `ATLANTA_FED_PAYMENT_CHOICE_CSV_URL` | atlanta-fed-payment-choice | skipped weekly |
| `WORLD_BANK_RPW_CSV_URL` | world-bank-remittance-prices | skipped weekly |
| `ECONOMY_URBAN_RURAL_WRITE=true` | urban-rural-fill | counts only (proposal); never writes |

`urban-rural-fill` is a production-data mutation of `institution_sources.urban_rural`: leave the
flag off until James has read a proposal run's counts. When on, it fills blanks only; stored values
that disagree are counted as `conflicts`, never overwritten. Rule: RUCC 1-3 -> `urban`, 4-9 -> `rural`.
It depends on `usda-rucc` having run, and for credit unions on `branch-census-tracts` (or a county
name match).

## 6. Could not confirm (sources blocked from the sandbox)

1. Every URL and column name is from memory: RUCC CSV path, FFIEC flat-file URL and column positions
   (year 1, MSA 2, state 3, county 4, tract 5, MSA MFI 11, ratio 13, tract MFI 14), QCEW
   `industry/10.csv` columns, CBP NAICS variable for 2022+, SAIPE variable names, BEA CAINC1 line
   codes 1-3, FHFA `hpi_master.csv` path/columns, SHED zip name and variables (`BK1`, `BK2_A`/`OD1`,
   `BK2_B`, `weight_pop`), HUD response shape. Each is checked at run time and reported as a gap.
2. FFIEC income level is derived from the file's ratio with the CRA thresholds (not read from FFIEC's
   own indicator column, whose position is unknown); the write is blocked unless the ratio column's
   median is 80-130 and the year column matches.
3. No plain download confirmed for the FDIC household survey tables, FDIC national rates, Atlanta Fed
   payment choice tables or a World Bank RPW CSV: those four are URL-configured and skip until set.
4. FDIC industry totals are the sum of every filer's BankFind Call Report figures for the quarter
   (QBP's base), not the published QBP tables; small differences from the QBP are expected.
5. The Census geocoder reuse: `toCensusCsv` from `census-geocoder.ts` is reused, but tracts need the
   `geographies/addressbatch` endpoint (the existing `geocodeBatch` returns coordinates only), plus a
   `geographies/coordinates` lookup for unmatched branches that carry lat/lon.

## 7. Row estimates per partition (estimates, not counts)

| Source | Partition | Rows (estimate) |
|---|---|---|
| usda-rucc | 2023 | ~3,230 |
| ffiec-census-tracts | year | ~85,000 tracts |
| branch-census-tracts | pending | 1,000 per run; ~95,000 branches total (~78k bank, ~21k CU) |
| urban-rural-fill | current | ~9,000 institutions counted |
| bls-qcew | year | ~3,600 areas x 4 = ~14,500 |
| census-cbp | year | ~4,200 areas x 3 = ~12,500 |
| census-saipe | year | ~3,200 areas x 2 = ~6,400 |
| bea-personal-income | year | ~3,500 areas x 3 = ~10,500 |
| fhfa-hpi | current | ~460 areas x ~106 quarters = ~49,000 |
| fdic-household-survey | year | ~150 (states + metros, 2 series) |
| fed-shed | year | up to 3 |
| fdic-industry-totals | quarter | 6 |
| fdic-national-rates | current | ~15 series x months on file |
| atlanta-fed-payment-choice | current | unknown (depends on the file) |
| world-bank-remittance-prices | current | ~1,500-3,000 US-send quotes |
| hud-zip-county | current | ~54,000 ZIP-county pairs |
