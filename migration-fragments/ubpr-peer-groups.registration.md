# ubpr-peer-groups: registration snippets

Loader files (new): `src/lib/regulatory/ubpr-peer-groups.ts`, `src/lib/agents/magellan/registry/ubpr-peer-groups.ts`,
`src/lib/data-store/ubpr-peer-groups-aggregates.ts` (+ tests). Tables: `migration-fragments/ubpr-peer-groups.sql`.

## 1. REGISTRY_SOURCES entry: `src/lib/agents/magellan/registry/index.ts`

Import beside the other registry imports:

```ts
import { runRegistryUbprPeerGroups, UBPR_PEER_GROUPS_SOURCE } from "./ubpr-peer-groups";
```

Entry (after the `FFIEC_CALL_DETAIL_SOURCE` entry; `n` and `dry` are the file's existing helpers):

```ts
  {
    source: UBPR_PEER_GROUPS_SOURCE,
    stepKey: "registry-ubpr-peer-groups",
    title: "Pull UBPR peer groups and peer-group averages (fee-related ratios)",
    run: async (input) => {
      const r = await runRegistryUbprPeerGroups({ runId: input.runId, partitionKey: input.partitionKey, dryRun: input.dryRun, db: input.db });
      const gaps = r.missingRatios.length > 0 ? `; ${r.missingRatios.length} ratios not loaded (missing or described differently in the file)` : "";
      const averages = r.averagesEmptyReason ? `; no peer averages: ${r.averagesEmptyReason}` : `, ${n(r.writtenAverageRows)} peer averages written`;
      return {
        summary: r.empty
          ? `No UBPR peer groups for ${r.partitionKey}: ${r.emptyReason}.`
          : `Magellan read UBPR peer groups for ${n(r.banks)} banks for ${r.partitionKey} (${n(r.banksWithPeerGroup)} with a group, ${r.peerGroups} groups): ${n(r.matchedBanks)} matched, ${n(r.unmatchedBanks)} kept unmatched, ${n(r.writtenBankRows)} bank rows written${averages}${gaps}${dry(r.dryRun)}.`,
        detail: {
          report_date: r.reportDate,
          source_url: r.sourceUrl,
          file: r.fileName,
          stats_file: r.statsFileName,
          banks: r.banks,
          banks_with_peer_group: r.banksWithPeerGroup,
          matched_banks: r.matchedBanks,
          unmatched_banks: r.unmatchedBanks,
          peer_groups: r.peerGroups,
          peer_averages: r.peerAverages,
          written_bank_rows: r.writtenBankRows,
          written_average_rows: r.writtenAverageRows,
          peer_group_column: r.peerGroupColumn,
          loaded_ratios: r.loadedRatios,
          missing_ratios: r.missingRatios,
          averages_loaded_ratios: r.averagesLoadedRatios,
          averages_empty_reason: r.averagesEmptyReason,
          cleaning: r.cleaning,
          empty: r.empty,
          empty_reason: r.emptyReason,
        },
      };
    },
  },
```

Also add `"ubpr-peer-groups"` to the source list asserted in `registry-sources.test.ts` (around line 846, beside `"ffiec-call-detail"`).

## 2. Scheduler: `src/lib/agents/registry-scheduler.ts`

```ts
import {
  UBPR_PEER_GROUPS_PARSER_VERSION,
  UBPR_PEER_GROUPS_SOURCE,
  ubprPeerGroupsPartitions,
} from "@/lib/agents/magellan/registry/ubpr-peer-groups";
```

Parser versions map (beside `[FFIEC_CALL_DETAIL_SOURCE]`):

```ts
  [UBPR_PEER_GROUPS_SOURCE]: UBPR_PEER_GROUPS_PARSER_VERSION,
```

Dynamic partitions (beside `[FFIEC_CALL_DETAIL_SOURCE]`; honours the backfill start like ncua-extras):

```ts
    [UBPR_PEER_GROUPS_SOURCE]: ubprPeerGroupsPartitions(now, compareQuarters(from, UBPR_FIRST) > 0 ? from : UBPR_FIRST),
```

(import `UBPR_FIRST` from the same module). `registry-scheduler.test.ts` snapshots of partition keys will need a `"ubpr-peer-groups:<quarter>"` line.

## 3. Data-feeds panel: `src/app/admin/data-feeds-panel.tsx`

```ts
  "ubpr-peer-groups": "FFIEC UBPR peer groups and peer averages",
```

and in `FEED_GROUP_OF`:

```ts
  "ubpr-peer-groups": "national",
```

## 4. AGENTS.md versions row: `src/lib/agents/magellan/AGENTS.md` (versions table near line 591)

```md
| `UBPR_PEER_GROUPS_PARSER_VERSION` | — | v1 | `magellan/registry/ubpr-peer-groups.ts` |
```

## 5. Proposed "UBPR peer group" peer dimension (not applied)

`src/lib/peer-set-dimensions.ts` and `src/lib/data-store/peer-sets.ts` are on PR #1768
(`origin/claude/project-thread-jl4pbk`), not this branch, so this is a patch against that branch. It
resolves the group from the newest quarter in `ubpr_bank_peer_groups`, banks only (UBPR covers no
credit unions). "same" takes the subject bank's own group for that quarter.

```diff
--- a/src/lib/peer-set-dimensions.ts
+++ b/src/lib/peer-set-dimensions.ts
@@ export const PEER_GROUP_PARAMS = [
   { name: "market", example: "same", description: "Metro (MSA) code, or same for the metro holding most of the institution's branches. Peers are institutions with a branch there." },
+  { name: "ubpr_peer_group", example: "same", description: "Banks only: FFIEC UBPR peer group number from the newest loaded quarter, or same for the bank's own" },
   { name: "nearest", example: "20", description: `The N institutions closest in total assets (1-${MAX_NEAREST_PEERS}) among those meeting the other parameters and publishing fees` },
 ] as const;
```

```diff
--- a/src/lib/data-store/peer-sets.ts
+++ b/src/lib/data-store/peer-sets.ts
@@ export interface PeerSetDefinition extends PeerFilterSet {
   /** Metro (MSA) code. */
   market_code?: number;
+  /** FFIEC UBPR peer group number (newest loaded quarter). Banks only. */
+  ubpr_peer_group?: string;
   /** The N closest in total assets to the subject institution. */
   nearest?: number;
 }
@@ export interface PeerSetRequest {
   market?: number | "same";
+  ubpr_peer_group?: string | "same";
   nearest?: number;
 }
@@ export interface PeerSubject {
   holding_company_rssd?: string | null;
+  ubpr_peer_group?: string | null;
 }
@@
-const ADVANCED_KEYS = ["asset_min", "asset_max", "regulators", "cu_charter", "holding_company_rssd", "market_code", "nearest"] as const;
+const ADVANCED_KEYS = ["asset_min", "asset_max", "regulators", "cu_charter", "holding_company_rssd", "market_code", "ubpr_peer_group", "nearest"] as const;
@@ export function definitionFor(subject: PeerSubject, request: PeerSetRequest, home: PeerMarket | null): PeerSetDefinition {
   if (request.market !== undefined) {
     def.market_code = request.market === "same" ? (home ?? missing("branch market")).code : request.market;
   }
+  if (request.ubpr_peer_group !== undefined) {
+    def.ubpr_peer_group = request.ubpr_peer_group === "same" ? subject.ubpr_peer_group ?? missing("UBPR peer group") : request.ubpr_peer_group;
+  }
   if (request.nearest !== undefined) def.nearest = request.nearest;
@@ export function describePeerSet(def: PeerSetDefinition, market: PeerMarket | null = null): string {
   if (def.market_code !== undefined) parts.push(`with branches in the ${market?.name || `metro ${def.market_code}`} metro`);
+  if (def.ubpr_peer_group) parts.push(`in UBPR peer group ${def.ubpr_peer_group}`);
@@ export async function resolvePeerInstitutionIds(
   if (def.holding_company_rssd) add((p) => `s.holding_company_rssd = ${p}`, def.holding_company_rssd);
+  if (def.ubpr_peer_group) {
+    add(
+      (p) => `s.id IN (SELECT u.institution_id FROM ubpr_bank_peer_groups u
+                        WHERE u.institution_id IS NOT NULL AND u.peer_group = ${p}
+                          AND u.report_date = (SELECT MAX(report_date) FROM ubpr_bank_peer_groups))`,
+      def.ubpr_peer_group,
+    );
+  }
   if (subject) add((p) => `s.id <> ${p}`, subject.id);
@@ export async function getPeerSubject(institutionId: number): Promise<PeerSubject | null> {
   const rows = (await sql`
     SELECT id, charter_type, asset_size, asset_size_tier, fed_district, state_code,
-           primary_regulator, cu_charter_type, holding_company_rssd
+           primary_regulator, cu_charter_type, holding_company_rssd,
+           (SELECT u.peer_group FROM ubpr_bank_peer_groups u
+             WHERE u.institution_id = institution_sources.id
+             ORDER BY u.report_date DESC LIMIT 1) AS ubpr_peer_group
       FROM institution_sources WHERE id = ${institutionId}
   `) as (PeerSubject & { id: number | string })[];
```

The API/connector query parser that maps `PEER_GROUP_PARAMS` names onto `PeerSetRequest` needs one line
reading `ubpr_peer_group` (a string, or `same`), and Hamilton's saved peer sets would need a column
to persist it; both are left to the PR that applies this.

## 6. Aggregates (`src/lib/data-store/ubpr-peer-groups-aggregates.ts`)

- `getFeeMediansByUbprPeerGroup({ reportDate?, category?, peers? })`: our live fee medians by UBPR peer
  group and category, joined `published_fee_catalog` -> `institution_sources` -> `ubpr_bank_peer_groups`
  with the shared `statsRowFilter` and `summarizeFeesBy`, so each median carries `institution_count`
  and follows the minimum-sample rule. `peers` narrows by a saved peer filter via fee-index's
  `matchesPeerFilters`.
- `getUbprRatioMediansBy(dimension, { reportDate?, peers? })`: our medians of the banks' own UBPR
  ratios by `peer_group`, `state`, `fed_district` or `asset_tier`, each with its institution count.
- `getUbprPeerGroupSizes`, `getUbprPublishedAverages`, `getLatestUbprReportDate`.
- Metro (CBSA) is not offered: `institution_sources` has no metro column on this branch.

## 7. Could not confirm (cdr.ffiec.gov is blocked from the sandbox)

1. The bulk-page product labels ("UBPR Ratio -- Single Period"; a peer statistics product matched by `/UBPR\s*(Stat|Peer)/`) and whether the UBPR products use the same `DatesDropDownList` / TSV / Download controls as the call-report product.
2. The UBPR column for the peer group number: no code is remembered, so it is found only by a description containing "PEER GROUP" (and not average/ratio/rank); its file and format (e.g. "1" vs "01") are unknown.
3. The remembered ratio codes (UBPRE004 noninterest income, UBPRE088 efficiency, UBPRE013 ROA, UBPRE018 NIM, UBPRE019 net losses) and that UBPR files carry a description row; no code for service charges / average assets is remembered at all. Unconfirmed codes load only on a unique description match, and every column's status lands in the partition detail.
4. The layout of the peer statistics product (whether it exists as a bulk product, its period and statistic columns, one row per group or several); duplicated groups are refused, not guessed.
5. The publication lag (60 days assumed) and how far back UBPR bulk history goes (2015Q1 chosen to match the call-report loaders).

## 8. Row-count estimate per partition (an estimate, not measured)

- `ubpr_bank_peer_groups`: about 4,400 to 4,600 rows per recent quarter (one per FDIC-insured bank
  filing a call report), about 6,000+ for 2015 quarters. Expect ~97%+ to match `institution_sources`
  by RSSD.
- `ubpr_peer_group_averages`: about 15 to 20 peer groups x up to 6 ratios, so roughly 90 to 120 rows
  per quarter if a peer statistics product exists; 0 if it does not.
