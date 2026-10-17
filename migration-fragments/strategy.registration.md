# Registration: fhlb-advance-rates, bank-merger-orders, sec-market-value (+ two computed reads)

Branch `worker/strategy`. Three new Magellan registry sources and two read-only modules. Nothing
below is applied yet; these are the exact snippets for the shared files.

| Source string | Writes to | Partitions | Needs a migration |
|---|---|---|---|
| `fhlb-advance-rates` | `area_statistics` (nation rows) | one per FHLBank: `boston`, `new-york`, `pittsburgh`, `atlanta`, `cincinnati`, `indianapolis`, `chicago`, `des-moines`, `dallas`, `topeka`, `san-francisco` | no |
| `bank-merger-orders` | `institution_structure_events` (sources `fed-orders`, `occ-merger-decisions`) | `occ:current`, `fed:<year>` newest first back to 2015 | no |
| `sec-market-value` | `sec_market_value_facts` (new) | `batch-0` .. `batch-7` (same CIK split as `sec-filings`) | yes: `migration-fragments/sec-market-value.sql` |

Computed reads (no source, no registration): `src/lib/data-store/deposit-share-change.ts`,
`src/lib/data-store/cre-concentration.ts`.

## 1. `src/lib/agents/magellan/registry/index.ts`

Imports (with the other registry imports):

```ts
import { FHLB_ADVANCE_RATES_SOURCE, runRegistryFhlbAdvanceRates } from "./fhlb-advance-rates";
import { BANK_MERGER_ORDERS_SOURCE, runRegistryBankMergerOrders } from "./bank-merger-orders";
import { SEC_MARKET_VALUE_SOURCE, runRegistrySecMarketValue } from "./sec-market-value";
```

Entries in `REGISTRY_SOURCES` (after the industry-events entry):

```ts
  {
    source: FHLB_ADVANCE_RATES_SOURCE,
    stepKey: "registry-fhlb-advance-rates",
    title: "Pull FHLBank posted advance rates",
    run: async (input) => {
      const r = await runRegistryFhlbAdvanceRates({ runId: input.runId, partitionKey: input.partitionKey, dryRun: input.dryRun, db: input.db });
      return { skipped: r.skipped, summary: r.summary, detail: { ...r.detail, source_url: r.sourceUrl, rows: r.rows, written_rows: r.writtenRows, empty: r.empty, empty_reason: r.emptyReason } };
    },
  },
  {
    source: BANK_MERGER_ORDERS_SOURCE,
    stepKey: "registry-bank-merger-orders",
    title: "Pull Fed and OCC merger decisions with their stated competitive figures",
    run: async (input) => {
      const r = await runRegistryBankMergerOrders({ runId: input.runId, partitionKey: input.partitionKey, dryRun: input.dryRun, db: input.db });
      return { skipped: r.skipped, summary: r.summary, detail: { ...r.detail, source_url: r.sourceUrl, rows: r.rows, written_rows: r.writtenRows, matched_rows: r.matchedRows, empty: r.empty, empty_reason: r.emptyReason } };
    },
  },
  {
    source: SEC_MARKET_VALUE_SOURCE,
    stepKey: "registry-sec-market-value",
    title: "Pull SEC public float and shares outstanding for linked bank holding companies",
    run: async (input) => {
      const r = await runRegistrySecMarketValue({ runId: input.runId, partitionKey: input.partitionKey, dryRun: input.dryRun, db: input.db });
      return {
        skipped: r.skipped,
        summary: r.empty
          ? `No SEC market-value facts for ${r.partitionKey}: ${r.emptyReason}${dry(r.dryRun)}.`
          : `Magellan read ${n(r.rows)} public-float and shares-outstanding facts for ${n(r.ciks)} filers in ${r.partitionKey}, ${n(r.writtenRows)} written${dry(r.dryRun)}.`,
        detail: { ...r.detail, rows: r.rows, written_rows: r.writtenRows, empty: r.empty, empty_reason: r.emptyReason },
      };
    },
  },
```

## 2. `src/lib/agents/registry-scheduler.ts`

Imports:

```ts
import { FHLB_ADVANCE_RATES_PARSER_VERSION, FHLB_ADVANCE_RATES_SOURCE, fhlbAdvanceRatesPartitions } from "@/lib/agents/magellan/registry/fhlb-advance-rates";
import { BANK_MERGER_ORDERS_PARSER_VERSION, BANK_MERGER_ORDERS_SOURCE, bankMergerOrdersPartitions } from "@/lib/agents/magellan/registry/bank-merger-orders";
import { SEC_MARKET_VALUE_PARSER_VERSION, SEC_MARKET_VALUE_SOURCE, secMarketValuePartitions } from "@/lib/agents/magellan/registry/sec-market-value";
```

`REGISTRY_PARSER_VERSIONS`:

```ts
  [FHLB_ADVANCE_RATES_SOURCE]: FHLB_ADVANCE_RATES_PARSER_VERSION,
  [BANK_MERGER_ORDERS_SOURCE]: BANK_MERGER_ORDERS_PARSER_VERSION,
  [SEC_MARKET_VALUE_SOURCE]: SEC_MARKET_VALUE_PARSER_VERSION,
```

`dynamic` partitions map:

```ts
    [FHLB_ADVANCE_RATES_SOURCE]: fhlbAdvanceRatesPartitions(now),
    [BANK_MERGER_ORDERS_SOURCE]: bankMergerOrdersPartitions(now),
    [SEC_MARKET_VALUE_SOURCE]: secMarketValuePartitions(now),
```

`sec-market-value` must not be scheduled before the migration fragment is applied (its insert
targets `sec_market_value_facts`), and only gives rows after `sec-links` has accepted links.

## 3. `src/app/admin/data-feeds-panel.tsx`

`FEED_LABELS`:

```ts
  "fhlb-advance-rates": "FHLBank posted advance rates",
  "bank-merger-orders": "Fed and OCC merger decisions",
  "sec-market-value": "SEC public float and shares outstanding",
```

`FEED_GROUP_OF`:

```ts
  "fhlb-advance-rates": "national",
  "bank-merger-orders": "national",
  "sec-market-value": "national",
```

## 4. `src/lib/agents/magellan/AGENTS.md` (Current versions table)

`npm run guard:legacy` (guide-version-kill) fails on this branch until these rows are added:

```md
| `FHLB_ADVANCE_RATES_PARSER_VERSION` | — | v1 | `magellan/registry/fhlb-advance-rates.ts` |
| `BANK_MERGER_ORDERS_PARSER_VERSION` | — | v1 | `magellan/registry/bank-merger-orders.ts` |
| `SEC_MARKET_VALUE_PARSER_VERSION` | — | v1 | `magellan/registry/sec-market-value.ts` |
```

## 5. Migration

`migration-fragments/sec-market-value.sql`: one new table `sec_market_value_facts` (additive,
`IF NOT EXISTS`, RLS on, grants revoked). It changes no existing data. It needs the next 14-digit
number under `supabase/migrations/` and the `migration-version-kill` re-run before merging.
`fhlb-advance-rates` and `bank-merger-orders` need no migration: they write existing tables
(`area_statistics`, `institution_structure_events` from 20270110000058) with new `source` values.

## What could not be confirmed (sandbox cannot reach any publisher)

- **FHLBank pages.** Every rate-page address in `FHLB_BANKS` is from memory. Which banks publish
  rates publicly and which keep them members-only is decided at run time (password field or
  member-login wording -> skipped "member login"; rate images -> skipped "images only"; neither ->
  empty "no rate table found"). A wrong address can be fixed without code via
  `FHLB_<BANK>_RATES_URL`. The posted-date wording ("Rates as of", "Effective") and term labels are
  guesses checked at run time; an undated table stores nothing.
- **Fed feed.** `https://www.federalreserve.gov/json/ne-press.json` with fields `d`, `t`, `l`, `pt`
  and press type "Orders on Banking Applications" is from memory; missing fields are reported.
  The release-page sentence pattern and the "Board order (PDF)" link are unconfirmed.
- **OCC decisions.** The Interpretations and Actions index address and its monthly page layout
  are unconfirmed; the step reports pages that did not answer and links found.
- **HHI wording.** The patterns read "the HHI ... would increase by N points to M" and "N percent
  of ... deposits". Orders that word it differently keep the sentence with null figures.
- **SEC.** `dei:EntityPublicFloat` (USD) and `dei:EntityCommonStockSharesOutstanding` (shares) are
  checked for presence, unit and label each run.
- **Daily stock prices.** No free source found whose terms clearly allow storing prices. SEC
  publishes none. From memory (terms not re-read, since the sites are unreachable from here),
  Yahoo, Stooq and Alpha Vantage restrict storage or redistribution or need a key and a paid tier
  for bulk use, and Nasdaq Data Link end-of-day data is paid. Nothing was built.
- **CRE.** Only `LNRE` (all real estate loans) and `EQTOT` are loaded, so CRE concentration is an
  upper-bound proxy (`re_loans_to_equity_pct`). The regulatory ratio needs LNRECONS, LNREMULT,
  LNRENRES / LNRENROW / LNRENROT and total risk-based capital and RWA in dollars (RBCT1J, RBCT2,
  RWAJT; names from memory) added to `FDIC_FINANCIAL_FIELDS` in `src/lib/regulatory/fdic.ts`.

## Row estimates (estimates, not counts)

- `fhlb-advance-rates`: about 4-8 products x 10-20 terms per publishing bank per posted date, so
  roughly 50-150 rows per bank per day. If 4-6 of the 11 banks publish a public table, about
  300-800 rows a day, ~75k-200k a year. Some or all banks may turn out members-only (then 0).
- `bank-merger-orders`: Fed orders on banking applications run roughly 30-80 a year (not all are
  mergers), so ~400-900 rows back to 2015; OCC merger decisions perhaps 20-60 a year from the
  few recent monthly pages read. Competitive figures appear mainly in Fed merger orders.
- `sec-market-value`: a few hundred linked bank holding companies (depends on `sec-links`
  accepted links) x (about 1 public-float date a year + 4 share-count dates a year) x the years
  company facts covers (~15), so roughly 10k-30k rows on first load, ~1.5k-2k a year after.
