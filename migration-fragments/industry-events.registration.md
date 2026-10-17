# industry-events: registration snippets for the lead

One registry source, `industry-events`, step key `registry-industry-events`, with a partition
family per publisher (`fed-h2`, `occ-bulletin`, `fdic-failures`, `ncua-mergers`,
`ncua-liquidations`, `fhlb-members`, `cdfi-awards`, `sba:<file>`, `sec:batch-N`,
`comments:<topic>`, `lawsuits:<year>`). Tables: `migration-fragments/industry-events.sql`.

## src/lib/agents/magellan/registry/index.ts

```ts
import { INDUSTRY_EVENTS_SOURCE, runRegistryIndustryEvents } from "./industry-events";
```

Add to `REGISTRY_SOURCES` (after the FDIC history entry):

```ts
  {
    source: INDUSTRY_EVENTS_SOURCE,
    stepKey: "registry-industry-events",
    title: "Pull industry events (failures, mergers, applications, fee lawsuits, rule comments, SBA lending, CDFI awards, FHLBank members, SEC fee lines)",
    run: async (input) => {
      const r = await runRegistryIndustryEvents({ runId: input.runId, partitionKey: input.partitionKey, dryRun: input.dryRun, db: input.db });
      const gaps = r.missingFields.length > 0 ? `; fields not found: ${r.missingFields.join(", ")}` : "";
      return {
        skipped: r.skipped,
        summary: r.empty
          ? `No ${r.family} rows for ${r.partitionKey}: ${r.emptyReason}.`
          : `Magellan read ${n(r.rows)} ${r.family} rows for ${r.partitionKey}: ${n(r.matchedRows)} matched to an institution, ${n(r.writtenRows)} written${r.truncated ? "; more remain for the next run" : ""}${gaps}${dry(r.dryRun)}.`,
        detail: {
          family: r.family,
          source_url: r.sourceUrl,
          rows: r.rows,
          written_rows: r.writtenRows,
          matched_rows: r.matchedRows,
          unmatched_rows: r.unmatchedRows,
          missing_fields: r.missingFields,
          unexpected_fields: r.unexpectedFields,
          truncated: r.truncated,
          cleaning: r.cleaning,
          empty: r.empty,
          empty_reason: r.emptyReason,
          skipped: r.skipped,
          ...r.extra,
        },
      };
    },
  },
```

## src/lib/agents/registry-scheduler.ts

```ts
import {
  INDUSTRY_EVENTS_PARSER_VERSION,
  INDUSTRY_EVENTS_SOURCE,
  industryEventsPartitions,
} from "@/lib/agents/magellan/registry/industry-events";
```

`REGISTRY_PARSER_VERSIONS`:

```ts
  [INDUSTRY_EVENTS_SOURCE]: INDUSTRY_EVENTS_PARSER_VERSION,
```

`registryPartitionsBySource` `dynamic`:

```ts
    [INDUSTRY_EVENTS_SOURCE]: industryEventsPartitions(now),
```

(38 partitions on 2026-10-17: 7 single lists, 3 SBA files, 8 SEC batches, 3 comment topics,
17 lawsuit years. Comment partitions are always listed; without `DATA_GOV_API_KEY` each run
records the partition `empty` with `skipped: true` and the reason, and retries daily.)

## src/app/admin/data-feeds-panel.tsx

```ts
  // FEED_LABELS
  "industry-events": "Industry events (failures, mergers, lawsuits, SBA, FHLBank)",
  // FEED_GROUP_OF
  "industry-events": "national",
```

## src/lib/agents/magellan/AGENTS.md "Current versions" row (guide-version-kill asks for it)

```
| `INDUSTRY_EVENTS_PARSER_VERSION` | — | v1 | `magellan/registry/industry-events.ts` |
```

## Env

- `DATA_GOV_API_KEY` (free api.data.gov key) for regulations.gov comments; unset = skipped with reason.
- `COURTLISTENER_API_TOKEN` (optional, free account). Searched anonymously first; a 401/403
  records the year as skipped with the reason.

## Follow-up for the lead (shared file, not edited here)

`getStructureEventCounts` in `src/lib/data-store/call-report-items.ts` does not filter by
`source`. Once industry-events writes `fdic-failures`, `ncua-*`, `fed-h2` and `occ-bulletin` rows
into `institution_structure_events`, it will mix them into FDIC history counts. Add
`AND e.source = 'fdic-history'` to its WHERE clause in the same PR.

## What I could not confirm (all sites were blocked from the sandbox)

1. NCUA merger and liquidation page URLs and their column headers (`NCUA_MERGER_PAGES`,
   `NCUA_LIQUIDATION_PAGES`). If NCUA publishes only PDFs, the partition records "only PDF files
   linked" and loads nothing. The CDFI award page URL and columns were not confirmed either, and
   neither was the FHFA page (`fhfa.gov/data/fhlb-membership`) or its XLSX headers. The XLSX is
   read with the fflate-based reader in the module, so no new library is needed.
2. BankFind `/failures` field names (CERT, NAME, CITY, PSTALP, FAILDATE, RESTYPE, RESTYPE1,
   CHCLASS1, QBFASSET, QBFDEP, COST) and SBA FOIA column names (BankName, BankFDICNumber,
   BankNCUANumber, ProjectState, ApprovalFiscalYear, GrossApproval, SBAGuaranteedApproval,
   ThirdPartyLender_*). Every run reports the fields it did not find. The SBA CKAN package id
   `7-a-504-foia` and its resource names are matched by pattern, and the run lists them when none match.
3. CourtListener v4: whether anonymous search is allowed, and the result field names (caseName,
   court_id, dateFiled, docketNumber, docket_absolute_url, docket_id) along with the
   `filed_after`/`filed_before` params. regulations.gov: the `filter[agencyId]` value FRS and the
   `docketType` attribute.
4. Which us-gaap concepts banks use for fee income. They are found at run time by
   name or label pattern, and the run lists `fee_concepts_found` with SEC's labels so they can be
   reviewed. 8-K and 10-K passage detection is by text pattern. The 8-K item list is read from the
   document text, because `parseSecSubmissions` (in shared sec.ts) drops the submissions "items" field.
5. H.2 release URL shape (`/releases/h2/YYYYMMDD/default.htm`) and the OCC Weekly Bulletin index URL
   and PDF links. Lines are kept by keyword under the nearest heading, so this is low precision
   (early warning, not a confirmed event list). `institution_name` is filled only when the text
   before the first comma reads like an institution.

## Row estimates (rough, not measured)

- fdic-failures: about 4,100 rows (every FDIC failure and assistance transaction since 1934), one partition.
- ncua-mergers: about 2,000 to 4,000 if the list covers 2010 on. ncua-liquidations: a few hundred.
- fed-h2 / occ-bulletin: about 20 to 100 lines per release, 6 releases each per run.
- fhlb-members: about 6,500 members. cdfi-awards: about 5,000 to 10,000 awards since 1996.
- sba:7a-fy2020-present: about 300k loans read, about 25k to 40k lender×state×year rows written;
  7a-fy2010-2019 about 500k loans read, about 50k rows; 504 about 60k loans read, about 15k rows.
- sec:batch-N: about 50 to 60 linked filers per batch. Expect about 5 to 30 XBRL fee facts per
  filer, up to 120 8-Ks and 30 10-Ks scanned per run.
- lawsuits:<year>: about 50 to 400 dockets a year (capped at 25 result pages).
- comments:<topic>: about 100 to 1,500 institution comments per topic.
