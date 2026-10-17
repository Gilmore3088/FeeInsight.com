# market-growth: registration snippets

Six sources, one module (`src/lib/agents/magellan/registry/market-growth.ts`), all writing to the
existing `area_statistics` table through `upsertAreaStats`. No new table and no migration.

| Source string | What |
|---|---|
| `census-permits` | Census Building Permits Survey county files (annual `coYYYYa.txt`, monthly `coYYMMc.txt`) |
| `census-popest` | Census county population estimates, totals and components (`co-estYYYY-alldata.csv`) |
| `irs-migration` | IRS SOI county-to-county and state-to-state migration (`countyinflowYYYY.csv` etc.) |
| `census-bfs` | Census Business Formation Statistics: state monthly, county annual |
| `bls-laus` | BLS LAUS county labor force: 14-month file plus annual averages |
| `census-lehd` | LEHD LODES8 WAC and RAC, blocks summed to county, per state per year |

## 1. `src/lib/agents/magellan/registry/index.ts` (REGISTRY_SOURCES)

Import:

```ts
import { MARKET_GROWTH_DEFINITIONS, runRegistryMarketGrowth } from "./market-growth";
```

Entry, placed right after the `...ECONOMY_DEFINITIONS.map(...)` block:

```ts
  ...MARKET_GROWTH_DEFINITIONS.map((definition): RegistrySourceDefinition => ({
    source: definition.source,
    stepKey: `registry-${definition.source}`,
    title: definition.title,
    run: async (input) => {
      const r = await runRegistryMarketGrowth({
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

No source has a `fixedPartition` (BFS uses two named partitions, `state-monthly` and
`county-annual`; LAUS uses `current` plus years), so all six take their partitions from the
scheduler below.

## 2. `src/lib/agents/registry-scheduler.ts`

Import:

```ts
import { MARKET_GROWTH_DEFINITIONS, MARKET_GROWTH_PARSER_VERSION } from "@/lib/agents/magellan/registry/market-growth";
```

In `REGISTRY_PARSER_VERSIONS`, after the ECONOMY line:

```ts
  ...Object.fromEntries(MARKET_GROWTH_DEFINITIONS.map((d) => [d.source, MARKET_GROWTH_PARSER_VERSION])),
```

In `registryPartitionsBySource`'s `dynamic` map, after the ECONOMY line:

```ts
    ...Object.fromEntries(MARKET_GROWTH_DEFINITIONS.map((d) => [d.source, d.partitions(now)])),
```

Partition counts at 2026-10-17: permits 19 (13 months + 6 years), popest 3 (`2025`, `2024`,
`2020`), irs-migration 7 (`2024`..`2018`, each the flow into that year), census-bfs 2,
bls-laus 8 (`current` + 7 years), census-lehd 408 (51 states x 8 years, `al-2024` style). LEHD's
408 partitions all join the round-robin; if that crowds other sources, trim
`censusLehdPartitions` to fewer years.

## 3. `src/app/admin/data-feeds-panel.tsx`

`FEED_LABELS`:

```ts
  "census-permits": "Census building permits by county",
  "census-popest": "Census county population and migration estimates",
  "irs-migration": "IRS county-to-county migration with income",
  "census-bfs": "Census business applications (BFS)",
  "bls-laus": "BLS county labor force and unemployment (LAUS)",
  "census-lehd": "LEHD jobs by workplace and home county (LODES)",
```

`FEED_GROUP_OF`:

```ts
  "census-permits": "economy",
  "census-popest": "economy",
  "irs-migration": "economy",
  "census-bfs": "economy",
  "bls-laus": "economy",
  "census-lehd": "economy",
```

## 4. `src/lib/agents/magellan/AGENTS.md` ("Current versions" table)

`scripts/ci-guards.sh guide-version-kill` fails until this row is added (it is the only guard
this branch trips, because the brief keeps AGENTS.md out of reach):

```md
| `MARKET_GROWTH_PARSER_VERSION` | — | v1 | `magellan/registry/market-growth.ts` (6 market-growth sources: census-permits, census-popest, irs-migration, census-bfs, bls-laus, census-lehd) |
```

## Series written (all `area_statistics`)

- **census-permits**: `permits_units_1_unit`, `permits_units_2_units`, `permits_units_3_4_units`,
  `permits_units_5plus`, `permits_units_total`, `permits_buildings_total`, `permits_value_total`.
  Period `2025` (annual file) or `2026-08` (monthly file) under the same keys; readers pick with
  `frequency`. State and nation rows are sums of the county file (note says so).
- **census-popest**: `popest_population`, `popest_pop_change`, `popest_births`, `popest_deaths`,
  `popest_natural_change`, `popest_international_migration`, `popest_domestic_migration`,
  `popest_net_migration` (counts), and `popest_*_rate` (per 1,000 residents). County and state
  as published; nation = sum of the states for count series only. `raw.vintage` records the
  vintage; an older vintage never overwrites a year a newer vintage has loaded.
- **irs-migration**: `irs_mig_{inflow,outflow,net}_{returns,individuals,agi}` (AGI in
  `thousands_dollars`), `irs_mig_{inflow,outflow}_agi_per_return` (dollars),
  `irs_mig_nonmigrant_returns`. County and state (state from the state files). Top 10
  origin/destination counties (or states) in `raw.top_origins` / `raw.top_destinations` on the
  `_returns` rows. IRS `-1` (suppressed) is stored as null with the flag in `note`.
- **census-bfs**: monthly `bfs_applications`, `bfs_applications_sa`,
  `bfs_high_propensity_applications`, `bfs_high_propensity_applications_sa` for states and the
  nation from 2015; annual county `bfs_applications`, `bfs_high_propensity_applications`, with
  state sums.
- **bls-laus**: `laus_labor_force`, `laus_employed`, `laus_unemployed`, `laus_unemployment_rate`
  (percent). County as published; state and nation are sums of the county file, with the rate
  recomputed from the sums (note says so). Preliminary months carry `note = "preliminary"`.
- **census-lehd**: `lodes_jobs_workplace`, `lodes_jobs_workplace_high_earning` (CE03),
  `lodes_jobs_finance_insurance` (CNS10), `lodes_workers_residence`,
  `lodes_workers_residence_high_earning`, `lodes_daytime_ratio` (jobs per resident worker), for
  each county and the state (block sums).

Aggregates: `src/lib/data-store/market-growth-aggregates.ts`: `getCountyGrowthVsPeers`,
`getMarketGrowthProfile`, `getStateCountyGrowthRanking`, `getNetMigrationWithIncome`,
`getStateCountyMigration`.

## Not confirmed (the publisher sites are blocked from the sandbox)

Every URL, column name and layout is from memory; each parser checks its header at run time and
names what it could not find in the partition detail's `missing_fields`.

- **Permits**: the two-line header labels ("Survey/Date", "FIPS/State", "FIPS/County",
  "County/Name", "1-unit/Bldgs/Units/Value" ...); whether monthly county files exist for every
  month and are named `coYYMMc.txt`; whether "Value" is dollars or thousands. The parser decides
  the unit from the median value per unit and, when it cannot tell, writes no value series and
  names the gap. Whether the county sums match Census's state totals (non-permit areas).
- **Popest**: file path pattern `datasets/2020-YYYY/counties/totals/co-estYYYY-alldata.csv`, and
  `datasets/2010-2020/.../co-est2020-alldata.csv` for the 2010s; column naming (`NPOPCHG2021`
  vs `NPOPCHG_2021`; both are read).
- **IRS migration**: `countyinflowYYZZ.csv` / `countyoutflowYYZZ.csv` / `stateinflowYYZZ.csv` /
  `stateoutflowYYZZ.csv`, lowercase column names (`y1_statefips`, `n1`, `n2`, `agi`; state files
  `AGI`, `y1_state_name`); total row code `96`/`000`; `-1` suppression. Codes 57-59 and 97-98
  rows are counted as skipped summary rows.
- **BFS**: monthly file `bfs_monthly.csv` with `sa, naics_sector, series, geo, year, jan..dec` and
  series `BA_BA`/`BA_HBA`. The county annual file's URL and layout are the least certain of all:
  two guessed URLs plus `BFS_COUNTY_CSV_URL` (optional env var, read first) to point at the real
  file; wide (`BA2024`, `HBA2024`) and long (`year`, `ba`, `hba`) layouts are both read. When
  none is found the partition is recorded empty asking for that variable.
- **LAUS**: `https://www.bls.gov/web/metro/laucntycur14.txt` pipe layout (9 columns, `CN...`
  LAUS code first, period `Aug-25` / `Sep-25(p)`), annual `https://www.bls.gov/lau/laucntyYY.xlsx`
  (then `.txt`). Fetched with `registryFetch`, whose User-Agent is Magellan's crawler identity
  plus the contact address, as `fetchQcew` does. Whether BLS county estimates sum exactly to the
  official state estimates (the state rows are labelled as sums, not BLS figures).
- **LODES**: LODES8 path `lodes/LODES8/{st}/{wac|rac}/{st}_{wac|rac}_S000_JT00_{year}.csv.gz`;
  columns `w_geocode`/`h_geocode`, `C000`, `CE03`, `CNS10`. Whether a state's RAC "main" file
  counts residents who work out of state (if not, border counties' daytime ratio runs high).
  Years available per state (some states lack some years; those partitions record empty).

## Row estimate (an estimate, not a count)

About 3,140 counties. Per full backfill, roughly:

- census-permits: ~22,000 rows per period x 19 periods = ~420,000
- census-popest: ~3,200 areas x 12 series x 6 years (vintage 2025) + ~10 years (2010s file) = ~600,000
- irs-migration: ~48,000 rows per year x 7 years = ~335,000
- census-bfs: ~30,000 (state monthly) + ~125,000 (county annual, depends on years in the file)
- bls-laus: ~185,000 (14 months) + ~90,000 (7 annual years) = ~275,000
- census-lehd: ~19,000 rows per year x 8 years = ~150,000

Total on the order of 2 million rows in `area_statistics`.
