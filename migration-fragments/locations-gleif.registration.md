# Registering the AllThePlaces and GLEIF loaders

Both steps need the tables in `migration-fragments/locations-gleif.sql` first. Copy it into
`supabase/migrations/` under the next 14-digit number, merge `main` and re-run
`migration-version-kill`. The SQL is additive: it creates four empty tables and changes no data.

Priority (James, 2026-10-17): AllThePlaces locations come first. Register `alltheplaces` before `gleif`.

## 1. `src/lib/agents/magellan/registry/index.ts`

Imports:

```ts
import { ALLTHEPLACES_SOURCE, runRegistryAlltheplaces } from "./alltheplaces";
import { GLEIF_SOURCE, runRegistryGleif } from "./gleif";
```

`REGISTRY_SOURCES` entries:

```ts
  {
    source: ALLTHEPLACES_SOURCE,
    stepKey: "registry-alltheplaces",
    title: "Pull AllThePlaces bank branch and ATM locations (CC0) and their area counts",
    run: async (input) => {
      const r = await runRegistryAlltheplaces({ runId: input.runId, partitionKey: input.partitionKey, dryRun: input.dryRun, db: input.db });
      const gaps = r.missingFields.length > 0 ? `; fields not found: ${r.missingFields.join(", ")}` : "";
      return {
        summary: r.empty
          ? `No AllThePlaces rows for ${r.partitionKey}: ${r.emptyReason}.`
          : r.partitionKey === "area-stats"
            ? `Magellan wrote ${n(r.writtenRows)} AllThePlaces area counts (run ${r.atpRunId})${dry(r.dryRun)}.`
            : `Magellan read ${n(r.locations)} AllThePlaces branches and ATMs from ${n(r.spiders.length)} spiders (run ${r.atpRunId}): ${n(r.matched)} linked, ${n(r.unmatched)} unlinked kept, ${n(r.writtenRows)} written${gaps}${dry(r.dryRun)}.`,
        detail: { atp_run_id: r.atpRunId, source_url: r.sourceUrl, spiders: r.spiders, locations: r.locations, matched: r.matched, unmatched: r.unmatched, area_rows: r.areaRows, written_rows: r.writtenRows, missing_fields: r.missingFields, checks: r.checks, empty: r.empty, empty_reason: r.emptyReason },
      };
    },
  },
  {
    source: GLEIF_SOURCE,
    stepKey: "registry-gleif",
    title: "Pull GLEIF legal entities (level 1) and parent relationships (level 2) for tracked institutions",
    run: async (input) => {
      const r = await runRegistryGleif({ runId: input.runId, partitionKey: input.partitionKey, dryRun: input.dryRun, db: input.db });
      return {
        summary: r.empty
          ? `No GLEIF rows for ${r.partitionKey}: ${r.emptyReason}.`
          : r.partitionKey === "level2"
            ? `Magellan read ${n(r.relationships)} GLEIF parent relationships for ${n(r.seeds)} tracked LEIs (publish ${r.publishDate}), ${n(r.writtenRows)} written${dry(r.dryRun)}.`
            : `Magellan read ${n(r.entities)} GLEIF entities for ${r.partitionKey}: ${n(r.linked)} linked, ${n(r.unlinked)} unlinked, ${n(r.writtenRows)} written${dry(r.dryRun)}.`,
        detail: { source_url: r.sourceUrl, publish_date: r.publishDate, seeds: r.seeds, entities: r.entities, relationships: r.relationships, linked: r.linked, unlinked: r.unlinked, written_rows: r.writtenRows, missing_fields: r.missingFields, checks: r.checks, empty: r.empty, empty_reason: r.emptyReason },
      };
    },
  },
```

## 2. `src/lib/agents/registry-scheduler.ts`

```ts
import {
  ALLTHEPLACES_PARSER_VERSION,
  ALLTHEPLACES_SOURCE,
  alltheplacesPartitions,
} from "@/lib/agents/magellan/registry/alltheplaces";
import { GLEIF_PARSER_VERSION, GLEIF_SOURCE, gleifRegistryPartitions } from "@/lib/agents/magellan/registry/gleif";
```

`REGISTRY_PARSER_VERSIONS`:

```ts
  [ALLTHEPLACES_SOURCE]: ALLTHEPLACES_PARSER_VERSION,
  [GLEIF_SOURCE]: GLEIF_PARSER_VERSION,
```

Partition map:

```ts
    [ALLTHEPLACES_SOURCE]: alltheplacesPartitions(now),
    [GLEIF_SOURCE]: gleifRegistryPartitions(now),
```

Optional env: `ALLTHEPLACES_SPIDERS` (comma-separated extra spider names to read). Nothing needs a key.

## 3. `src/app/admin/data-feeds-panel.tsx`

Labels:

```ts
  alltheplaces: "AllThePlaces bank branches and ATMs",
  gleif: "GLEIF legal entities and parents",
```

Groups:

```ts
  alltheplaces: "economy",
  gleif: "national",
```

## 4. `src/lib/agents/magellan/AGENTS.md` versions table

```md
| `ALLTHEPLACES_PARSER_VERSION` | — | v1 | `magellan/registry/alltheplaces.ts` |
| `GLEIF_PARSER_VERSION` | — | v1 | `magellan/registry/gleif.ts` |
```

## Not confirmed (publisher sites are blocked from the sandbox this was written in)

Every item below is checked at run time and reported by name in the partition detail.

- AllThePlaces: the run index `https://data.alltheplaces.xyz/runs/latest.json` and its fields
  `run_id` and `output_url`; entries named `output/<spider>.geojson` in `output.zip`; whether
  the zip host answers HTTP Range with 206 (if it does not, every shard records empty and nothing
  downloads); feature properties `amenity`, `brand`, `brand:wikidata`, `operator`, `addr:*`,
  `@source_uri`; the feature-level `id`.
- Which spiders get read: names matching `bank|credit_?union|fcu|cu|atm|bancorp|banc|savings`,
  plus a short list of brand-named spiders from memory (`chase_us`, `pnc_us`, `truist_us`,
  `regions_us`, `citizens_us`, `huntington_us`, `fifth_third_us`, `td_us`, `citi_us`,
  `allpoint`, `moneypass_us`). Listed names absent from the run are named in
  `listed_spiders_absent`. A bank spider named only after its brand and not on that list is
  missed until it is added to `ALLTHEPLACES_SPIDERS`.
- Linking: `brand_wikidata_institutions` starts empty and is filled by review. Until then only
  exact brand/operator name + same state links, so a national brand's branches outside its HQ
  state stay unlinked (counted, never guessed). `getAtpUnlinkedBrands()` is the review list.
- County: point in the us-atlas 1:10m county outline; points within a few hundred metres of a
  county line can land in the neighbouring county. `state_county_disagree` counts them.
- GLEIF: golden-copy index `https://goldencopy.gleif.org/api/v2/golden-copies/publishes/latest`
  with `data.publish_date` and `data.rr.full_file.csv.url`; RR columns
  `Relationship.StartNode.NodeID`, `...EndNode.NodeID`, `...RelationshipType`,
  `...RelationshipStatus`; API paths under `/api/v1/lei-records` and
  `/api/v1/registration-authorities` (codes and names). The RSSD registration authority is found
  by the name "National Information Center"; if none matches, no RSSD is read and the run says so.
- GLEIF license: free under GLEIF's terms of use, not confirmed as CC0. Each run records the
  terms URL. Confirm the terms before GLEIF data is shown in Hamilton.

## Row estimates (estimates, not counts)

- `atp_financial_locations`: roughly 30,000 to 80,000 US branches and ATMs, depending on how
  many bank and ATM-network spiders the run carries and which ones the name rule finds.
- `area_statistics` from `alltheplaces`: up to about 2 × (3,100 counties + 52 states + 1) ≈ 6,300 rows per period.
- `gleif_entities`: a few thousand. That is the institutions holding an LEI in
  `institution_sources` plus their parents and siblings.
- `gleif_relationships`: a few thousand to about 20,000. Large families such as the big holding
  companies hold hundreds of subsidiaries each.

## Overture Maps: not built

The Overture places release is GeoParquet on S3/Azure, partitioned by theme and type, not by
category or country. Finding banks and ATMs means scanning on the order of 50 million rows across
hundreds of files and several gigabytes per monthly release. That needs a Parquet engine with
remote range reads and predicate pushdown (DuckDB or similar) and runs past a Vercel route's time
and memory limits. Overture's own banks and ATMs largely come from AllThePlaces (plus Meta and
Foursquare records under their own notices), so AllThePlaces covers the priority.
