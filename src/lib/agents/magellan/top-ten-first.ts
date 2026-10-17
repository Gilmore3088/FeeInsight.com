import { sql } from "@/lib/data-store/connection";
import { getTopTenCoverage } from "@/lib/data-store/top-ten-coverage";
import { pickFromWorkLists, type GroupGaps, type WorkCandidate, type WorkListPlacement } from "@/lib/agents/state-expert/work-list";

type SqlTag = typeof sql;

/**
 * State top-10 slot holders with nothing live go first in Magellan's paid searches (2026-10-17).
 *
 * The ten largest institutions by in-state deposits in each state and DC (`top-ten-coverage.ts`,
 * the market-leaders deposit ranking) set the prices a visitor compares against. On 2026-10-17,
 * 53 of them had nothing in `published_fee_catalog`; nearly all had one paid miss on Oct 6-8
 * and were waiting out the 30-day miss cooldown (`MISS_COOLDOWN_DAYS`) until about Nov 5-8.
 *
 * The exception is narrow:
 * - It applies only to a top-10 slot holder with nothing live (`loadTopTenMissingIds`).
 * - The paid web search (`paid-find.ts`) may skip the miss cooldown only when the escalation
 *   ladder (`escalation.ts`) moves it to the next rung: after a schedule miss, the disclosure
 *   rung (Truth in Savings disclosure, deposit account agreement). The schedule search
 *   (`schedule-search.ts`, uncovered lane) may skip it only when no try in the cooldown used its
 *   three-document ask (fee schedule, Truth in Savings disclosure, account agreement); the
 *   Oct 6-11 tries (version 1) asked for the consumer schedule only.
 * - At most one paid try per institution per `TOP_TEN_RETRY_DAYS`, counted from its last real try
 *   (transient outcomes excluded, as for the cooldown). A find keeps its 90-day cooldown, and
 *   "not published online" (2 misses on the same website, 120 days) is unchanged.
 * - The early web search skips the homepage pick when the pick already ran inside its cooldown.
 *
 * Both searches also take these institutions from any state's paid step and ahead of the work
 * lists' state rotation, after report requesters and Pro accounts' own institutions. Each try
 * records `detail.top_ten` and `detail.top_ten_retry`, so the extra spend can be counted.
 */

/** Days between paid tries for a state top-10 slot holder with nothing live, inside the miss cooldown. */
export const TOP_TEN_RETRY_DAYS = 7;

/**
 * Ids of institutions holding a state top-10 slot with nothing live in `published_fee_catalog`,
 * from the shared top-10 count. Empty if the ranking fails, so the searches run as before.
 */
export async function loadTopTenMissingIds(db: SqlTag = sql): Promise<number[]> {
  try {
    const coverage = await getTopTenCoverage(db);
    return [...coverage.missing.keys()].sort((a, b) => a - b);
  } catch {
    return [];
  }
}

/**
 * Pure: up to `limit` rows, report requesters and Pro accounts' institutions first, then top-10
 * slot holders with nothing live, then the rest, each part in the work lists' order.
 */
export function pickTopTenFirst<T extends WorkCandidate>(
  rows: readonly T[],
  gaps: GroupGaps,
  limit: number,
  isTopTen: (row: T) => boolean,
): Array<T & { work_list: WorkListPlacement }> {
  const cap = Math.max(0, Math.floor(limit));
  const first = (row: T) => Boolean(row.requested || row.paying);
  const lead = pickFromWorkLists(rows.filter(first), gaps, cap);
  const topTen = pickFromWorkLists(rows.filter((row) => !first(row) && isTopTen(row)), gaps, cap - lead.length);
  const rest = pickFromWorkLists(rows.filter((row) => !first(row) && !isTopTen(row)), gaps, cap - lead.length - topTen.length);
  return [...lead, ...topTen, ...rest];
}
