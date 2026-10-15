import type { sql } from "@/lib/data-store/connection";
import { coverageGroupsSql, SIZE_GROUPS, type SizeGroupKey } from "@/lib/agents/goal-scorecard";
import { inSavepoint } from "@/lib/agents/savepoint";

type SqlTag = typeof sql;

/**
 * Each state expert's work list (#1029, Magellan M2). The paid passes (`paid-find.ts`,
 * `schedule-search.ts`, `website-find.ts`) used to pick nationally: requesters, then the
 * largest assets. They now pick from these lists:
 *
 * 1. Requesters (a report lead names the institution) and paying customers (a Pro account's
 *    own institution) stay at the top, in the order the pass's query gave them.
 * 2. Everyone else is grouped into one list per state. Within a state, the size groups
 *    furthest below James's coverage target (#1028: 30 live institutions, or 75% of a group
 *    under 40; `coverageGroupsSql`, the same gap the scorecard and Atlas's lane priority
 *    read) come first; groups already at target come last. Inside a group, an institution
 *    with a website on file, then one on a known platform, then the larger one, goes first.
 * 3. Institutions over $10B are compared nationally and by district, never by state, so they
 *    form one national list rather than joining their state's.
 * 4. The pass takes one institution from each list in turn (round robin), largest state gap
 *    first, so every state moves together instead of the largest banks filling the step.
 *
 * Only the order changes: each pass keeps its own per-step cap. Deterministic, no provider calls.
 */

/**
 * Rows a pass reads before ordering; its per-step cap then applies to the ordered list. The
 * query orders the pool with `workListPoolRankSql` (#1269), so the cut keeps every list's
 * first rows rather than only the largest institutions.
 */
export const WORK_LIST_POOL = 2000;
/** The list institutions over $10B (or with no state) share. */
export const NATIONAL_LIST = "national";

export type WorkGroup = SizeGroupKey | "over_10b" | "unknown";

/** The size group for an asset size in thousands of dollars (call report units): $300M is 300,000. */
export function sizeGroupOf(assetThousands: number | string | null | undefined): WorkGroup {
  if (assetThousands == null || assetThousands === "") return "unknown";
  const assets = Number(assetThousands);
  if (!Number.isFinite(assets)) return "unknown";
  for (const group of SIZE_GROUPS) {
    if (assets < group.maxThousands) return group.key;
  }
  return "over_10b";
}

/**
 * The pool's SQL order (#1269), placed in a pass's ORDER BY after `requested DESC, paying DESC`:
 * each institution's rank inside its work-list cell (state × size group, or the national list
 * for $10B+ and no state), largest first. Ordering by it takes every cell's first institution,
 * then every cell's second, and so on, so a pool cut at WORK_LIST_POOL drops the deepest rows
 * of the fullest cells, never a whole small-bank group. `columns` are identifiers in the
 * query (`inst.state_code`); `within` splits the rank by a lane column first.
 */
export function workListPoolRankSql(db: SqlTag, columns: { state: string; assets: string; id: string; within?: string }) {
  const assets = db(columns.assets);
  const state = db(columns.state);
  const within = columns.within ? db`${db(columns.within)}, ` : db``;
  return db`row_number() OVER (
    PARTITION BY ${within}
      CASE WHEN ${assets} >= ${SIZE_GROUPS[2].maxThousands}::bigint OR NULLIF(btrim(${state}), '') IS NULL
           THEN ${NATIONAL_LIST}::text ELSE upper(btrim(${state})) END,
      CASE WHEN ${assets} IS NULL THEN 'unknown'
           WHEN ${assets} < ${SIZE_GROUPS[0].maxThousands}::bigint THEN ${SIZE_GROUPS[0].key}::text
           WHEN ${assets} < ${SIZE_GROUPS[1].maxThousands}::bigint THEN ${SIZE_GROUPS[1].key}::text
           WHEN ${assets} < ${SIZE_GROUPS[2].maxThousands}::bigint THEN ${SIZE_GROUPS[2].key}::text
           ELSE 'over_10b' END
    ORDER BY ${assets} DESC NULLS LAST, ${db(columns.id)} ASC
  )`;
}

export interface GroupGap {
  total: number;
  covered: number;
  target: number;
  short: number;
}

/** Gaps keyed by `STATE|size_group`. Empty when unread: every group then ranks the same. */
export type GroupGaps = Map<string, GroupGap>;

const gapKey = (state: string, group: string) => `${state}|${group}`;

/** Each state × size group's coverage gap, from the scorecard's own query. Empty on error. */
export async function loadGroupGaps(db: SqlTag): Promise<GroupGaps> {
  try {
    const rows = await inSavepoint(db, (scope) => scope<Array<Record<string, unknown>>>`
      SELECT state_code, size_group, total, covered, target, short
        FROM (${coverageGroupsSql(scope)}) coverage_groups
    `);
    const gaps: GroupGaps = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!row?.state_code || !row.size_group) continue;
      gaps.set(gapKey(String(row.state_code), String(row.size_group)), {
        total: Number(row.total ?? 0),
        covered: Number(row.covered ?? 0),
        target: Number(row.target ?? 0),
        short: Number(row.short ?? 0),
      });
    }
    return gaps;
  } catch (error) {
    console.error("state expert work list: coverage gaps unread, lists keep size order:", error instanceof Error ? error.message : error);
    return new Map();
  }
}

export interface WorkCandidate {
  id: number | string;
  state_code?: string | null;
  asset_size?: number | string | null;
  /** A report lead names it. */
  requested?: boolean | null;
  /** A Pro account's own institution. */
  paying?: boolean | null;
  website_url?: string | null;
  /** Known site platform (profile or `cms_platform`). */
  platform?: string | null;
}

export interface WorkListPlacement {
  list: string;
  group: WorkGroup;
  /** Covered institutions the group is short of target; null when unknown or national. */
  groupShort: number | null;
  first: boolean;
}

function stateOf(row: WorkCandidate): string | null {
  const state = row.state_code?.trim().toUpperCase();
  return state ? state : null;
}

function placement(row: WorkCandidate, gaps: GroupGaps): WorkListPlacement {
  const group = sizeGroupOf(row.asset_size);
  const first = Boolean(row.requested || row.paying);
  const state = stateOf(row);
  if (!state || group === "over_10b") return { list: NATIONAL_LIST, group, groupShort: null, first };
  const gap = gaps.get(gapKey(state, group));
  return { list: state, group, groupShort: gap ? gap.short : null, first };
}

/** How far a group sits below target, as a share of the target (1 = no institution covered). */
function shortShare(row: WorkCandidate, gaps: GroupGaps): number {
  const state = stateOf(row);
  const gap = state ? gaps.get(gapKey(state, sizeGroupOf(row.asset_size))) : undefined;
  if (!gap || gap.target <= 0) return 0;
  return gap.short / gap.target;
}

function compareInList(gaps: GroupGaps) {
  return (a: WorkCandidate, b: WorkCandidate): number => {
    const share = shortShare(b, gaps) - shortShare(a, gaps);
    if (share !== 0) return share;
    const website = Number(Boolean(b.website_url?.trim())) - Number(Boolean(a.website_url?.trim()));
    if (website !== 0) return website;
    const platform = Number(Boolean(b.platform?.trim())) - Number(Boolean(a.platform?.trim()));
    if (platform !== 0) return platform;
    const assets = (Number(b.asset_size ?? -1) || -1) - (Number(a.asset_size ?? -1) || -1);
    if (assets !== 0) return assets;
    return Number(a.id) - Number(b.id);
  };
}

/** Each state's ordered list (plus the national one), largest state gap first. */
export function stateWorkLists<T extends WorkCandidate>(rows: readonly T[], gaps: GroupGaps): Array<{ list: string; short: number; rows: T[] }> {
  const lists = new Map<string, T[]>();
  for (const row of rows) {
    const { list, first } = placement(row, gaps);
    if (first) continue;
    const listRows = lists.get(list);
    if (listRows) listRows.push(row);
    else lists.set(list, [row]);
  }
  const stateShort = new Map<string, number>();
  for (const [key, gap] of gaps) {
    const state = key.split("|")[0];
    stateShort.set(state, (stateShort.get(state) ?? 0) + gap.short);
  }
  const order = compareInList(gaps);
  return [...lists.entries()]
    .map(([list, listRows]) => ({ list, short: stateShort.get(list) ?? 0, rows: listRows.sort(order) }))
    .sort((a, b) => b.short - a.short || (a.list === NATIONAL_LIST ? 1 : 0) - (b.list === NATIONAL_LIST ? 1 : 0) || a.list.localeCompare(b.list));
}

/**
 * Pure: up to `limit` rows, requesters and paying customers first (in input order), then one
 * from each state's list in turn. Each picked row carries where it came from.
 */
export function pickFromWorkLists<T extends WorkCandidate>(rows: readonly T[], gaps: GroupGaps, limit: number): Array<T & { work_list: WorkListPlacement }> {
  const cap = Math.max(0, Math.floor(limit));
  const picked: Array<T & { work_list: WorkListPlacement }> = [];
  const seen = new Set<string>();
  const take = (row: T) => {
    const key = String(row.id);
    if (seen.has(key) || picked.length >= cap) return;
    seen.add(key);
    picked.push({ ...row, work_list: placement(row, gaps) });
  };
  for (const row of rows) if (placement(row, gaps).first) take(row);
  const lists = stateWorkLists(rows, gaps).map((entry) => entry.rows);
  for (let index = 0; picked.length < cap && lists.some((list) => index < list.length); index += 1) {
    for (const list of lists) if (index < list.length) take(list[index]);
  }
  return picked;
}

/** Pure: one state's size groups in work-list order, furthest below target first. */
export function stateGroupOrder(gaps: GroupGaps, stateCode: string): Array<GroupGap & { group: string }> {
  const state = stateCode.trim().toUpperCase();
  return [...gaps.entries()]
    .filter(([key]) => key.startsWith(`${state}|`))
    .map(([key, gap]) => ({ group: key.slice(state.length + 1), ...gap }))
    .sort((a, b) => (b.target > 0 ? b.short / b.target : 0) - (a.target > 0 ? a.short / a.target : 0) || b.short - a.short || a.group.localeCompare(b.group));
}

/** The work-list fields a pass's result entry records beside each institution. */
export function workListDetail(placementInfo: WorkListPlacement | undefined): Record<string, unknown> {
  if (!placementInfo) return {};
  return {
    work_list: placementInfo.first ? "requested_or_paying" : placementInfo.list,
    work_group: placementInfo.group,
    work_group_short: placementInfo.groupShort,
  };
}

/**
 * The step ledger's record of every work-list entry in a pass's results (#1269). The step's
 * `sample_results` keeps only the first 10, which the paid finds, blocked fetches and picks
 * usually fill before the website and schedule searches; this keeps each entry's work-list
 * fields and counts the real tries (an outcome other than budget_blocked) in short groups, for
 * the week-after check of the share of paid tries spent on groups below target.
 */
export function workListLedger(results: ReadonlyArray<Record<string, unknown>>): {
  entries: Array<Record<string, unknown>>;
  tries: number;
  short_group_tries: number;
} {
  const entries: Array<Record<string, unknown>> = [];
  let tries = 0;
  let shortGroupTries = 0;
  for (const result of results) {
    if (!result || typeof result.work_list !== "string") continue;
    entries.push({
      institution_id: result.institution_id ?? null,
      // The paid web search records its rung (#1032) instead of a `by`.
      by: result.by ?? (result.rung != null ? "web_search" : null),
      ...(result.rung != null ? { rung: result.rung } : {}),
      outcome: result.outcome ?? null,
      work_list: result.work_list,
      work_group: result.work_group ?? null,
      work_group_short: result.work_group_short ?? null,
    });
    if (typeof result.outcome !== "string" || result.outcome === "budget_blocked") continue;
    tries += 1;
    if (Number(result.work_group_short) > 0) shortGroupTries += 1;
  }
  return { entries, tries, short_group_tries: shortGroupTries };
}
