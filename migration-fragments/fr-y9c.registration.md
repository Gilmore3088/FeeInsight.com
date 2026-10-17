# fr-y9c + nic-structure: snippets for shared files

Two registry sources: `fr-y9c` (quarterly Y-9C lines) and `nic-structure` (one 'current' NIC snapshot).

## src/lib/agents/magellan/registry/index.ts

Imports:

```ts
import { FR_Y9C_SOURCE, runRegistryFrY9c } from "./fr-y9c";
import { NIC_STRUCTURE_SOURCE, runRegistryNicStructure } from "./nic-structure";
```

REGISTRY_SOURCES entries:

```ts
  {
    source: FR_Y9C_SOURCE,
    stepKey: "registry-fr-y9c",
    title: "Pull FR Y-9C holding-company lines (assets, deposits, income, service charges, interchange, charge-offs)",
    run: async (input) => {
      const r = await runRegistryFrY9c({ runId: input.runId, partitionKey: input.partitionKey, dryRun: input.dryRun, db: input.db });
      const gaps = r.missingLines.length > 0 ? `; ${r.missingLines.length} lines not loaded (missing or described differently)` : "";
      return {
        summary: r.empty
          ? `No FR Y-9C lines for ${r.partitionKey}: ${r.emptyReason}.`
          : `Magellan read ${r.loadedLines.length} FR Y-9C lines for ${n(r.filers)} holding companies for ${r.partitionKey}: ${n(r.matchedHoldingCompanies)} parents of banks we track, ${n(r.writtenRows)} values written${gaps}${dry(r.dryRun)}.`,
        detail: {
          report_date: r.reportDate,
          source_url: r.sourceUrl,
          file: r.fileName,
          filers: r.filers,
          matched_holding_companies: r.matchedHoldingCompanies,
          values: r.values,
          written_rows: r.writtenRows,
          written_filers: r.writtenFilers,
          loaded_lines: r.loadedLines,
          missing_lines: r.missingLines,
          used_mdrm: r.usedMdrm,
          quality: r.quality,
          empty: r.empty,
          empty_reason: r.emptyReason,
        },
      };
    },
  },
  {
    source: NIC_STRUCTURE_SOURCE,
    stepKey: "registry-nic-structure",
    title: "Pull NIC holding-company structure (parent-subsidiary links with dates, parent attributes)",
    run: async (input) => {
      const r = await runRegistryNicStructure({ runId: input.runId, partitionKey: input.partitionKey, dryRun: input.dryRun, db: input.db });
      const gaps = r.missingFiles.length > 0 ? `; ${r.missingFiles.length} NIC files unavailable` : "";
      return {
        summary: r.empty
          ? `No NIC structure loaded: ${r.emptyReason}.`
          : `Magellan read ${n(r.relationships)} NIC parent-subsidiary links (${n(r.parents)} parents, ${n(r.entities)} named), ${n(r.linkedBanks)} banks we track linked${r.parentDisagreements ? `; ${n(r.parentDisagreements)} banks whose recorded holding company is not an open NIC parent` : ""}${gaps}${dry(r.dryRun)}.`,
        detail: {
          source_url: r.sourceUrl,
          relationships: r.relationships,
          parents: r.parents,
          entities: r.entities,
          written_relationships: r.writtenRelationships,
          written_entities: r.writtenEntities,
          linked_banks: r.linkedBanks,
          parent_disagreements: r.parentDisagreements,
          header_checks: r.headerChecks,
          missing_files: r.missingFiles,
          quality: r.quality,
          empty: r.empty,
          empty_reason: r.emptyReason,
        },
      };
    },
  },
```

## src/lib/agents/registry-scheduler.ts

```ts
import { FR_Y9C_FIRST, FR_Y9C_PARSER_VERSION, FR_Y9C_SOURCE, frY9cPartitions } from "@/lib/agents/magellan/registry/fr-y9c";
import { NIC_STRUCTURE_PARSER_VERSION, NIC_STRUCTURE_SOURCE, nicStructurePartitions } from "@/lib/agents/magellan/registry/nic-structure";

// REGISTRY_PARSER_VERSIONS
  [FR_Y9C_SOURCE]: FR_Y9C_PARSER_VERSION,
  [NIC_STRUCTURE_SOURCE]: NIC_STRUCTURE_PARSER_VERSION,

// registryPartitionsBySource
  [FR_Y9C_SOURCE]: frY9cPartitions(now, compareQuarters(from, FR_Y9C_FIRST) > 0 ? from : FR_Y9C_FIRST),
  [NIC_STRUCTURE_SOURCE]: nicStructurePartitions(),
```

Also add both sources to the registry-sources test list (`registry-sources.test.ts`) the same way ffiec-call-detail was added.

## src/app/admin/data-feeds-panel.tsx

```ts
// FEED_LABELS
  "fr-y9c": "FR Y-9C holding-company financials",
  "nic-structure": "NIC holding-company structure",
// FEED_GROUP_OF
  "fr-y9c": "national",
  "nic-structure": "national",
```

## src/lib/agents/magellan/AGENTS.md (versions table)

```
| `FR_Y9C_PARSER_VERSION` | — | v1 | `magellan/registry/fr-y9c.ts` |
| `NIC_STRUCTURE_PARSER_VERSION` | — | v1 | `magellan/registry/nic-structure.ts` |
```

Registry table row (tables): `registry-fr-y9c` | `2015Q1`..latest | `holding_company_y9c_items`, `holding_company_y9c_filers`;
`registry-nic-structure` | `current` | `nic_relationships`, `nic_entities`.

## What could not be confirmed (regulator sites blocked from the sandbox)

1. Download URLs: NIC `ReturnBHCFZipFiles?zipfilename=BHCF<YYYYMMDD>.ZIP`, `ReturnRelationshipsZipFileCSV`, `ReturnAttributesActiveZipFileCSV`, `ReturnAttributesClosedZipFileCSV`, and MDRM `federalreserve.gov/apps/mdrm/pdf/MDRM.zip`. A wrong URL yields an empty partition with the reason, not bad rows.
2. BHCF layout: delimiter (caret, tab or comma is detected) and whether a description row exists; without one, each code is checked against MDRM (FR Y-9C entry valid on the report date).
3. MDRM codes: BHCK2170, BHDM6631/6636, BHFN6631/6636, BHCK2122, BHCK3210, BHCK4340, BHCK4079, BHCK4483, BHCKF555 (interchange), BHCK4635/4605; identity RSSD9001, RSSD9999, RSSD9017, RSSD9130, RSSD9200 (state may be numeric, in which case state stays null and is counted).
4. NIC CSV column names (ID_RSSD_PARENT, ID_RSSD_OFFSPRING, DT_START, DT_END, RELN_LVL, PCT_EQUITY, CTRL_IND, REG_IND, REASON_TERM_RELN; ID_RSSD, NM_LGL, ENTITY_TYPE, STATE_ABBR_NM, ...): checked per file; missing required columns load nothing.
5. Semantics of RELN_LVL / CTRL_IND are not used to filter: the parent chain follows every open link.

## Row estimates (estimates, not counts)

- fr-y9c: roughly 350-450 filers per quarter since 2018 (threshold $3B), roughly 1,000-1,200 for 2015-2017 ($1B threshold); about 10-13 values per filer, so ~4,000-6,000 item rows (2018+) or ~12,000-15,000 (2015-2017) and one filer row each per quarter. 47 quarters to 2026Q2.
- nic-structure: on the order of 100,000-200,000 relationship rows (history included) and ~10,000-20,000 parent entity rows, single partition.
