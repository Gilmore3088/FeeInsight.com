# state-lists: registration snippets

Sources (module `src/lib/agents/magellan/registry/state-lists.ts`):
`state-nonbank-lenders`, `urban-debt-in-america` and `state-public-depositories`. The payday reports
have their own note in `payday-reports.registration.md`.
SQL: `migration-fragments/state-lists.sql` (two new tables, additive). It must ship as a numbered migration
before `state-nonbank-lenders` or `state-public-depositories` runs. `urban-debt-in-america` writes only
to `area_statistics`.

## src/lib/agents/magellan/registry/index.ts

```ts
import {
  runRegistryStateLists,
  STATE_DEPOSITORIES_SOURCE,
  STATE_NONBANK_LENDERS_SOURCE,
  URBAN_DEBT_SOURCE,
} from "./state-lists";

// inside REGISTRY_SOURCES, one entry per source:
...([
  [STATE_NONBANK_LENDERS_SOURCE, "registry-state-nonbank-lenders", "Pull state open-data lists of non-bank lenders, check cashers and money transmitters"],
  [URBAN_DEBT_SOURCE, "registry-urban-debt", "Read Urban Institute debt in collections by county and state (held until license confirmed)"],
  [STATE_DEPOSITORIES_SOURCE, "registry-state-public-depositories", "Pull state qualified public depository lists"],
] as const).map(([source, stepKey, title]) => ({
  source,
  stepKey,
  title,
  run: async (input: RegistryRunInput) => {
    const r = await runRegistryStateLists({ source, runId: input.runId, partitionKey: input.partitionKey, dryRun: input.dryRun, db: input.db });
    return {
      summary: r.summary,
      detail: {
        source_url: r.sourceUrl,
        rows_read: r.rowsRead,
        records: r.records,
        matched: r.matched,
        unmatched: r.unmatched,
        written_rows: r.writtenRows,
        removed_rows: r.removedRows,
        area_rows: r.areaRows,
        missing_fields: r.missingFields,
        held: r.held,
        dry_run: r.dryRun,
        empty: r.empty,
        empty_reason: r.emptyReason,
      },
    };
  },
})),
```
(Use the input type name that index.ts already uses for `run`. `RegistryRunInput` is a placeholder for it.)

## src/lib/agents/registry-scheduler.ts

```ts
import {
  STATE_DEPOSITORIES_PARSER_VERSION,
  STATE_DEPOSITORIES_SOURCE,
  STATE_NONBANK_LENDERS_PARSER_VERSION,
  STATE_NONBANK_LENDERS_SOURCE,
  stateDepositoriesPartitions,
  stateNonbankLendersPartitions,
  URBAN_DEBT_PARSER_VERSION,
  URBAN_DEBT_SOURCE,
  urbanDebtPartitions,
} from "@/lib/agents/magellan/registry/state-lists";

// REGISTRY_PARSER_VERSIONS
[STATE_NONBANK_LENDERS_SOURCE]: STATE_NONBANK_LENDERS_PARSER_VERSION,
[URBAN_DEBT_SOURCE]: URBAN_DEBT_PARSER_VERSION,
[STATE_DEPOSITORIES_SOURCE]: STATE_DEPOSITORIES_PARSER_VERSION,

// partitions map
[STATE_NONBANK_LENDERS_SOURCE]: stateNonbankLendersPartitions(now),
[URBAN_DEBT_SOURCE]: urbanDebtPartitions(now),
[STATE_DEPOSITORIES_SOURCE]: stateDepositoriesPartitions(now),
```

## src/app/admin/data-feeds-panel.tsx

```ts
// labels
"state-nonbank-lenders": "State non-bank lender licenses (payday, check cashers, money transmitters)",
"urban-debt-in-america": "Urban Institute debt in collections (license check)",
"state-public-depositories": "State qualified public depositories",
// groups
"state-nonbank-lenders": "economy",
"urban-debt-in-america": "economy",
"state-public-depositories": "national",
```

## src/lib/agents/magellan/AGENTS.md (versions table)

```
| `STATE_NONBANK_LENDERS_PARSER_VERSION` | — | v1 | `magellan/registry/state-lists.ts` |
| `URBAN_DEBT_PARSER_VERSION` | — | v1 | `magellan/registry/state-lists.ts` |
| `STATE_DEPOSITORIES_PARSER_VERSION` | — | v1 | `magellan/registry/state-lists.ts` |
```

## Env vars (all optional; with none set, nothing is wrong and nothing is guessed)

- `STATE_LENDER_DATASETS`: a JSON array of `{ "state": "NY", "domain": "data.ny.gov", "dataset": "abcd-1234", "licenseType"?: "Check Casher" }`.
  Until a person adds a dataset they have checked, there are no partitions. Each dataset's fields are checked against
  its own `/api/views/<id>.json` metadata before any row is read.
- `SOCRATA_APP_TOKEN`: a free token that raises Socrata's rate limit. It is optional.
- `URBAN_DEBT_LICENSE_CONFIRMED=true`: set this only after reading `license.text_found` in the partition detail.
  Until then the Urban rows are read and counted but not written, because `getAreaStatistics` returns every source
  in area_statistics to Hamilton.
- `URBAN_DEBT_PAGE_URL`, `URBAN_DEBT_COUNTY_CSV_URL`, `URBAN_DEBT_STATE_CSV_URL`: overrides, if the catalog page or its files move.
- `FL_QPD_LIST_URL`: the Florida list file, if the CFO page stops linking it.

## Not confirmed (the sandbox could not reach any publisher site)

- Non-bank lenders: I could not confirm a single Socrata dataset id or column set. No state is wired.
  Leads to check by hand: data.wa.gov `hxpx-m5ym` ("State Regulated Financial Institutions", 2016-17, columns unknown).
  On data.ny.gov I found only a license-type listing, not licensees. Texas OCCC publishes PDFs, not a portal dataset.
  Connecticut DOB has a money transmitter file on portal.ct.gov, which is not Socrata. Delaware's lists are PDFs.
  NMLS Consumer Access is search-only.
- Urban Debt in America: the catalog page URL (`datacatalog.urban.org/dataset/debt-america-2023`), the file names,
  the column headers and the license are all from memory. The loader picks columns by pattern and leaves out any
  measure it cannot tell apart. It decides percent or 0-1 share per column from the cells and records which.
- Florida QPD: the CFO page exists. The format of the file behind it does not. Florida Administrative Register
  notices are plain text, grouped by home-office state and city, and are not parsed. A PDF-only page is recorded
  as empty. The list carries no FDIC cert as far as is known, so matching will be by exact name within the
  home-office state. No other state's list is confirmed: TX (no statewide list), CA, WA PDPC, OR, UT (HTML,
  shape unknown), MA (PDF), GA, TN.

## Row estimates (estimates, not counts)

- state-public-depositories (FL): about 150-250 depositories per quarterly list.
- state-nonbank-lenders: 0 until a dataset is configured. A large state dataset might hold 1,000-10,000 licensees
  and produce under 1,000 county and state count rows.
- urban-debt-in-america: about 3,100 counties plus 51 states, times 4-5 measures, so about 13,000-16,000 values.
  All are held until the license is confirmed.
