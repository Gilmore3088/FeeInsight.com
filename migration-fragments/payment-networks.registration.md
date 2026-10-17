# payment-networks: registration snippets

Source key `payment-networks`, parser version 1. Partitions (fixed order, each a "current" snapshot):
`zelle`, `fednow`, `rtp`, `reg-ii-not-exempt`, `reg-ii-exempt`, `reg-ii-survey`, then `osm-AL` … `osm-WY`
(50 states + DC, from `STATE_CODES`). Tables: `migration-fragments/payment-networks.sql`.

## 1. `src/lib/agents/magellan/registry/index.ts`

Import:

```ts
import { PAYMENT_NETWORKS_SOURCE, runRegistryPaymentNetworks } from "./payment-networks";
```

`REGISTRY_SOURCES` entry:

```ts
  {
    source: PAYMENT_NETWORKS_SOURCE,
    stepKey: "registry-payment-networks",
    title: "Pull payment-network lists (Zelle, FedNow, RTP, Reg II exempt / not exempt, Reg II interchange tables, OpenStreetMap ATMs and branches)",
    run: async (input) => {
      const r = await runRegistryPaymentNetworks({ runId: input.runId, partitionKey: input.partitionKey, dryRun: input.dryRun, db: input.db });
      const what = r.network === null ? `${n(r.figures)} Regulation II table cells` : r.network === "osm" ? `${n(r.listedRows)} OpenStreetMap ATMs and branches` : `${n(r.listedRows)} listed institutions`;
      const gaps = r.unrecognisedHeaders.length > 0 ? `; headings not recognised: ${r.unrecognisedHeaders.join(", ")}` : "";
      return {
        summary: r.empty
          ? `No ${r.partitionKey} rows: ${r.emptyReason}.`
          : `Magellan read ${what} for ${r.partitionKey} (as of ${r.asOf})${r.network === null ? "" : `: ${n(r.matchedRows)} matched, ${n(r.unmatchedRows)} unmatched kept`}, ${n(r.writtenRows)} written${gaps}${dry(r.dryRun)}.`,
        detail: {
          network: r.network,
          as_of: r.asOf,
          source_url: r.sourceUrl,
          read_url: r.readUrl,
          stated_date: r.statedDate,
          listed_rows: r.listedRows,
          matched_rows: r.matchedRows,
          unmatched_rows: r.unmatchedRows,
          figures: r.figures,
          written_rows: r.writtenRows,
          unrecognised_headers: r.unrecognisedHeaders,
          missing_columns: r.missingColumns,
          empty: r.empty,
          empty_reason: r.emptyReason,
        },
      };
    },
  },
```

## 2. `src/lib/agents/registry-scheduler.ts`

Import:

```ts
import {
  PAYMENT_NETWORKS_PARSER_VERSION,
  PAYMENT_NETWORKS_SOURCE,
  paymentNetworksPartitions,
} from "@/lib/agents/magellan/registry/payment-networks";
```

`REGISTRY_PARSER_VERSIONS`:

```ts
  [PAYMENT_NETWORKS_SOURCE]: PAYMENT_NETWORKS_PARSER_VERSION,
```

`registryPartitionsBySource`:

```ts
    [PAYMENT_NETWORKS_SOURCE]: paymentNetworksPartitions(now),
```

Refresh cadence is set by the step itself: lists 7 days, Reg II tables 90 days, OSM 30 days,
empty/failed 24 h, robots-disallowed 30 days. The 51 OSM partitions each make one Overpass
request; Overpass asks for at most ~10,000 requests/day and 2 concurrent per IP, so the scheduler
should not run more than one OSM partition at a time.

## 3. `src/app/admin/data-feeds-panel.tsx`

```ts
  // FEED_LABELS
  "payment-networks": "Payment networks (Zelle, FedNow, RTP, Reg II, OSM ATMs)",
  // FEED_GROUP_OF
  "payment-networks": "national",
```

## 4. `src/lib/agents/magellan/AGENTS.md` versions table

```md
| `PAYMENT_NETWORKS_PARSER_VERSION` | — | v1 | `magellan/registry/payment-networks.ts` |
```

## 5. Peer dimension: Reg II covered issuer (patch snippet only)

`peer-sets.ts` / `peer-set-dimensions.ts` are not on `main` (they are on
`origin/claude/project-thread-jl4pbk`), so this is a snippet for whoever lands them. The SQL comes
from `coveredIssuerSql()` in `src/lib/data-store/payment-networks-aggregates.ts`, which reads the
Fed's newest "Not Exempt" list:

```ts
import { coveredIssuerSql } from "@/lib/data-store/payment-networks-aggregates";

// in the dimension list, next to charter / asset tier:
{
  key: "reg_ii_covered",
  label: "Regulation II covered issuer ($10B+ with affiliates)",
  type: "boolean",
  // over institution_sources aliased s (pass the alias the peer query uses)
  sqlExpression: coveredIssuerSql("s"),
  note: "From the Fed's newest Not Exempt list; false also covers a listed issuer we could not match (see getNetworkListSummary).",
},
```

## 6. Allpoint, MoneyPass and CO-OP

Nothing is built for them. None publishes a plain participant list; each offers a locator
(map / search) only, and locators are not scraped. The stand-in is OpenStreetMap: ATMs whose
mappers set `network=Allpoint` / `MoneyPass` / `CO-OP` etc. (`getOsmNetworkTagCounts`). That is a
count of mapped ATMs, not membership, and must be labelled so.

## 7. What could not be confirmed (every site was unreachable from the sandbox)

1. Page URLs: Zelle `/participating-banks-and-credit-unions`, FRB Services `/financial-services/fednow/organizations`, TCH `/payment-systems/rtp/rtp-participating-financial-institutions`, Fed `regii-about.htm` (the Exempt / Not Exempt links) and `regii-average-interchange-fee.htm`. A wrong URL records an empty partition ("page is gone (404)").
2. Page shapes: whether each list is server-rendered HTML (a JavaScript-built list loads nothing and says so), its column headings, and whether the Fed's issuer lists are CSV/HTML (a PDF/XLSX-only list loads nothing and is named in `linked_files`). Headings are recognised by pattern at run time; unrecognised ones are reported.
3. Link wording on the Fed page ("Exempt" / "Not Exempt", "as of <date>"); a date not stated falls back to the fetch date (`as_of_basis` in the run detail).
4. robots.txt on each host, including overpass-api.de: if it disallows our token the partition records that and loads nothing.
5. Overpass boundary tags (`ISO3166-2=US-XX`, `admin_level=4`) and whether the biggest states finish inside the 180 s query timeout (a timeout records an empty partition with Overpass's remark).

## 8. Row estimates (estimates, not counts)

- zelle: ~2,000 listed rows per snapshot (no state column, so name-only matching; expect a large unmatched share).
- fednow: ~1,000–1,500 rows.
- rtp: ~800–1,000 rows.
- reg-ii-not-exempt: ~150–200 rows; reg-ii-exempt: ~8,000–9,000 rows (if published as CSV/HTML).
- reg-ii-survey: ~100–400 table cells.
- osm-XX: ~200 (WY, VT) to ~10,000 (CA, TX) elements per state; ~80,000–150,000 nationally.
- Membership tables grow by one snapshot per list per week of new as-of dates (re-runs on the same as-of upsert in place).
