import type { sql } from "@/lib/data-store/connection";
import { coverageShort, SIZE_GROUPS } from "@/lib/agents/goal-scorecard";
import { notPublishedOnlineCounts, type NotOnlineTierCount } from "@/lib/agents/magellan/escalation";
import { inSavepoint } from "@/lib/agents/savepoint";
import { listStateExpertNotes, type StateExpertNote } from "@/lib/data-store/state-expert-notes";
import { STATE_NAMES } from "@/lib/us-states";

import { ALL_TIERS, loadStateMemory, stateMemorySchemaReady, type PeerLevel, type StateMemory } from "./memory";
import { STATE_EXPERTS, stateExpertFor, type StateExpert } from "./roster";
import { loadGroupGaps, stateGroupOrder, stateWorkLists, type GroupGap, type GroupGaps, type WorkCandidate } from "./work-list";

type SqlTag = typeof sql;

/**
 * The admin view of the state experts (#1042): an index ranked by coverage gap and one page
 * per expert. Read-only. Every number comes from a read the agents themselves make, and
 * `STATE_EXPERT_QUERIES` names it so the page can print the source beside the number.
 */
export const STATE_EXPERT_QUERIES = {
  /** `coverageGroupsSql` via `loadGroupGaps`: the gap the scorecard, Atlas and the work lists read. */
  coverageGaps: "state_expert.coverage_gaps (goal-scorecard coverageGroupsSql)",
  /** `state_memory`: the stored memory Magellan, Rosetta, Darwin and Hamilton read. */
  memory: "state_expert.memory (state_memory)",
  /** Magellan's paid-ladder count (`notPublishedOnlineCounts`). */
  notOnline: "state_expert.not_published_online (magellan/escalation notPublishedOnlineCounts)",
  /** Uncovered institutions under $10B, ordered by `stateWorkLists` as the paid passes order them. */
  workList: "state_expert.work_list (institution_sources without published_fee_catalog, stateWorkLists order)",
  /** Dated notes the state-expert step wrote (#1573). */
  notes: "state_expert.notes (state_expert_notes, written by the state-expert step)",
} as const;

export interface StateExpertIndexRow {
  stateCode: string;
  stateName: string | null;
  expertName: string;
  /** Covered institutions the state's size groups under $10B still need. */
  institutionsShort: number;
  readyGroups: number;
  totalGroups: number;
  /** From the stored memory; null before the expert's first refresh. */
  institutions: number | null;
  publishedFees: number | null;
  refreshedAt: string | null;
}

export interface StoredMemorySummary {
  stateCode: string;
  institutions: number;
  publishedFees: number;
  refreshedAt: string | null;
}

/**
 * Pure: one row per roster expert, largest coverage gap first, then the state with fewer groups
 * at target, then state code. Experts whose state has no group under $10B rank last with a zero gap.
 */
export function rankStateExperts(
  roster: readonly StateExpert[],
  gaps: GroupGaps,
  memories: ReadonlyMap<string, StoredMemorySummary> = new Map(),
): StateExpertIndexRow[] {
  const byState = new Map<string, { short: number; ready: number; total: number }>();
  for (const [key, gap] of gaps) {
    const state = key.split("|")[0];
    if (gap.total <= 0) continue;
    const entry = byState.get(state) ?? { short: 0, ready: 0, total: 0 };
    const short = coverageShort(gap.total, gap.covered);
    entry.short += short;
    entry.total += 1;
    if (short === 0) entry.ready += 1;
    byState.set(state, entry);
  }
  return roster
    .map((expert) => {
      const gap = byState.get(expert.stateCode);
      const memory = memories.get(expert.stateCode);
      return {
        stateCode: expert.stateCode,
        stateName: STATE_NAMES[expert.stateCode] ?? null,
        expertName: expert.name,
        institutionsShort: gap?.short ?? 0,
        readyGroups: gap?.ready ?? 0,
        totalGroups: gap?.total ?? 0,
        institutions: memory?.institutions ?? null,
        publishedFees: memory?.publishedFees ?? null,
        refreshedAt: memory?.refreshedAt ?? null,
      };
    })
    .sort(
      (a, b) =>
        b.institutionsShort - a.institutionsShort ||
        (b.totalGroups - b.readyGroups) - (a.totalGroups - a.readyGroups) ||
        a.stateCode.localeCompare(b.stateCode),
    );
}

async function loadStoredMemorySummaries(db: SqlTag): Promise<Map<string, StoredMemorySummary>> {
  const summaries = new Map<string, StoredMemorySummary>();
  if (!(await stateMemorySchemaReady(db))) return summaries;
  const rows = await db<Array<{ state_code: string; institution_count: number | string | null; published_fee_count: number | string | null; refreshed_at: unknown }>>`
    SELECT state_code, institution_count, published_fee_count, refreshed_at
      FROM state_memory
  `;
  for (const row of rows) {
    const refreshed = row.refreshed_at instanceof Date ? row.refreshed_at.toISOString() : row.refreshed_at ? String(row.refreshed_at) : null;
    summaries.set(String(row.state_code), {
      stateCode: String(row.state_code),
      institutions: Number(row.institution_count ?? 0),
      publishedFees: Number(row.published_fee_count ?? 0),
      refreshedAt: refreshed,
    });
  }
  return summaries;
}

export interface StateExpertIndex {
  rows: StateExpertIndexRow[];
  /** False when the coverage read failed, so every gap shows as unknown rather than zero. */
  gapsRead: boolean;
  memoryError: string | null;
}

export async function loadStateExpertIndex(db: SqlTag): Promise<StateExpertIndex> {
  const gaps = await loadGroupGaps(db);
  let memories = new Map<string, StoredMemorySummary>();
  let memoryError: string | null = null;
  try {
    memories = await loadStoredMemorySummaries(db);
  } catch (error) {
    memoryError = error instanceof Error ? error.message : String(error);
  }
  return { rows: rankStateExperts(STATE_EXPERTS, gaps, memories), gapsRead: gaps.size > 0, memoryError };
}

export interface CoverageGroupView extends GroupGap {
  group: string;
  label: string;
}

export interface WorkListEntry {
  id: number;
  name: string;
  sizeGroup: string;
  assetSize: number | null;
  websiteUrl: string | null;
  platform: string | null;
}

export interface StateExpertPage {
  expert: StateExpert;
  stateName: string | null;
  /** Stored memory, or null before the expert's first refresh (or before the migration). */
  memory: StateMemory | null;
  /** The state's size groups under $10B in work-list order (furthest below target first). */
  coverage: CoverageGroupView[];
  notOnline: NotOnlineTierCount[] | null;
  /** The first uncovered institutions in the order the paid passes take this state's list. */
  workList: WorkListEntry[];
  workListTotal: number | null;
  /** State-wide peer levels, most institutions first. */
  stateWidePeerLevels: PeerLevel[];
  /** Dated notes, newest first; empty before the first note or the migration. */
  notes: StateExpertNote[];
}

export const WORK_LIST_SHOWN = 25;

const SIZE_LABELS = new Map<string, string>(SIZE_GROUPS.map((group) => [group.key, group.label]));

export function sizeGroupLabel(group: string): string {
  return SIZE_LABELS.get(group) ?? group;
}

/** Pure: the state-wide peer levels, most institutions first, then fee key. */
export function stateWideLevels(levels: readonly PeerLevel[]): PeerLevel[] {
  return levels
    .filter((level) => level.tier === ALL_TIERS)
    .sort((a, b) => b.count - a.count || a.canonicalFeeKey.localeCompare(b.canonicalFeeKey));
}

async function loadWorkList(db: SqlTag, stateCode: string, gaps: GroupGaps): Promise<{ entries: WorkListEntry[]; total: number }> {
  const rows = await inSavepoint(db, (scope) => scope<Array<{
    id: number | string;
    institution_name: string | null;
    state_code: string | null;
    asset_size: number | string | null;
    website_url: string | null;
    platform: string | null;
  }>>`
    SELECT inst.id, inst.institution_name, inst.state_code, inst.asset_size, inst.website_url,
           NULLIF(btrim(inst.cms_platform), '') AS platform
      FROM institution_sources inst
     WHERE upper(btrim(inst.state_code)) = ${stateCode}
       AND COALESCE(inst.status, 'active') = 'active'
       AND inst.asset_size IS NOT NULL
       AND inst.asset_size < ${SIZE_GROUPS[2].maxThousands}::bigint
       AND NOT EXISTS (SELECT 1 FROM published_fee_catalog c WHERE c.institution_id = inst.id)
  `);
  const candidates: Array<WorkCandidate & { name: string }> = rows.map((row) => ({
    id: Number(row.id),
    name: row.institution_name ?? `Institution ${row.id}`,
    state_code: row.state_code,
    asset_size: row.asset_size,
    website_url: row.website_url,
    platform: row.platform,
  }));
  const list = stateWorkLists(candidates, gaps).find((entry) => entry.list === stateCode)?.rows ?? [];
  return {
    total: list.length,
    entries: list.slice(0, WORK_LIST_SHOWN).map((row) => {
      const assets = row.asset_size == null ? null : Number(row.asset_size);
      const group = assets == null ? "unknown" : SIZE_GROUPS.find((entry) => assets < entry.maxThousands)?.key ?? "over_10b";
      return {
        id: Number(row.id),
        name: row.name,
        sizeGroup: group,
        assetSize: assets,
        websiteUrl: row.website_url?.trim() || null,
        platform: row.platform ?? null,
      };
    }),
  };
}

/** Everything one expert's page shows, or null for a code outside the 55 lanes. */
export async function loadStateExpertPage(db: SqlTag, stateCode: string): Promise<StateExpertPage | null> {
  const expert = stateExpertFor(stateCode);
  if (!expert) return null;
  const code = expert.stateCode;
  const gaps = await loadGroupGaps(db);
  const memory = await loadStateMemory(db, code).catch((error) => {
    console.error("[admin] state expert memory unavailable", { code, error });
    return null;
  });
  const notOnline = await notPublishedOnlineCounts(db, code).catch((error): null => {
    console.error("[admin] state expert not-published-online counts unavailable", { code, error });
    return null;
  });
  const workList = await loadWorkList(db, code, gaps).catch((error): null => {
    console.error("[admin] state expert work list unavailable", { code, error });
    return null;
  });
  const notes = await listStateExpertNotes(code, { db }).catch((error): StateExpertNote[] => {
    console.error("[admin] state expert notes unavailable", { code, error });
    return [];
  });
  return {
    expert,
    stateName: STATE_NAMES[code] ?? null,
    memory,
    coverage: stateGroupOrder(gaps, code).map((gap) => ({ ...gap, label: sizeGroupLabel(gap.group) })),
    notOnline,
    workList: workList?.entries ?? [],
    workListTotal: workList?.total ?? null,
    stateWidePeerLevels: memory ? stateWideLevels(memory.peerLevels) : [],
    notes,
  };
}
