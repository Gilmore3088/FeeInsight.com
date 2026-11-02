/**
 * Server reads behind the Command center dashboard. Every read is an existing one:
 *   - the institution's filed quarters and its competitors' (getFinancialHistory, the rows the
 *     public institution page charts, one point per quarter via buildFinancialSeries);
 *   - the subject's own fees and its peer group's, and the same fees across its state, through the
 *     one peer read every Hamilton screen uses (getEnginePeerGroup on published_fee_catalog);
 *   - like-for-like fee changes confirmed in its state (loadConfirmedFeeChanges, as the briefing).
 * Read-only and deterministic: no writes, no provider call. A read that fails leaves its part empty
 * and the page says so; it never takes the page down.
 */

import { unstable_cache } from "next/cache";
import { buildFinancialSeries, type FinancialPoint } from "@/app/(public)/institution/[id]/financial-history";
import { sql } from "@/lib/data-store/connection";
import { getFinancialHistory } from "@/lib/data-store/financial";
import { loadConfirmedFeeChanges } from "@/lib/report-assemblers/monthly-pulse";
import { STATE_NAMES } from "@/lib/us-states";
import type { ActivePeerSet } from "../peer-index";
import { COMPETITOR_MOVE_WINDOW_DAYS, getEnginePeerGroup, type EnginePeerOptions } from "../workspace/research";
import type { Briefing } from "../workspace/types";
import type { ConfirmedChangeInput, GroupPeers } from "./command-center-dashboard";

/** Filed quarters read per competitor: eight covers four quarters even with gaps around them. */
const COMPETITOR_QUARTERS = 8;
const SUBJECT_QUARTERS = 14;

/** One institution's filed quarters, oldest first, one per quarter; [] on a failed read. */
export async function readFiledSeries(institutionId: number, quarters = SUBJECT_QUARTERS): Promise<FinancialPoint[]> {
  try {
    return buildFinancialSeries(await getFinancialHistory(institutionId, quarters));
  } catch {
    return [];
  }
}

/** The newest branch count filed (FDIC rows carry it); null when none is on file. */
export async function readBranchCount(institutionId: number): Promise<number | null> {
  try {
    const rows = await getFinancialHistory(institutionId, 4);
    return rows.find((r) => r.branch_count !== null && r.branch_count > 0)?.branch_count ?? null;
  } catch {
    return null;
  }
}

/** Filed quarters for each listed competitor, keyed by institution id. */
export async function readCompetitorFilings(ids: number[]): Promise<Map<number, FinancialPoint[]>> {
  const unique = [...new Set(ids)];
  const series = await Promise.all(unique.map((id) => readFiledSeries(id, COMPETITOR_QUARTERS)));
  return new Map(unique.map((id, i) => [id, series[i]]));
}

/** The engine's peer read, cached for an hour per institution, group and fee list (as the briefing is). */
const cachedPeerGroup = unstable_cache(
  async (institutionId: number, categories: string[], peerSet: EnginePeerOptions["peerSet"]) =>
    getEnginePeerGroup(institutionId, categories, { peerSet }),
  ["hamilton-dashboard-peer-group-v1"],
  { revalidate: 3600 },
);

/**
 * The subject's peer group (its saved group from Settings when it has one, else the default group
 * every screen uses) and its whole state, each with every peer's value for the fees it publishes.
 */
export async function readFeeGroups(input: {
  institutionId: number;
  stateCode: string | null;
  categories: string[];
  activePeerSet: Pick<ActivePeerSet, "filters" | "label"> | null;
}): Promise<{ peers: GroupPeers | null; state: GroupPeers | null; peersSaved: boolean }> {
  if (input.categories.length === 0) return { peers: null, state: null, peersSaved: false };
  const categories = [...input.categories].sort();
  const stateName = input.stateCode ? STATE_NAMES[input.stateCode] ?? input.stateCode : null;
  const [peers, state] = await Promise.all([
    cachedPeerGroup(input.institutionId, categories, input.activePeerSet ? { filters: input.activePeerSet.filters, label: input.activePeerSet.label } : null).catch(() => null),
    input.stateCode && stateName
      ? cachedPeerGroup(input.institutionId, categories, { filters: { state_code: input.stateCode }, label: `institutions in ${stateName}` }).catch(() => null)
      : Promise.resolve(null),
  ]);
  return {
    peers: peers ? { label: peers.peerLabel, fees: peers.fees } : null,
    state: state ? { label: state.peerLabel, fees: state.fees } : null,
    peersSaved: Boolean(peers?.saved),
  };
}

/** Midnight UTC `days` ago, as an ISO string: one cache key per day. */
export function windowStart(days: number, now = new Date()): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - days);
  return `${d.toISOString().slice(0, 10)}T00:00:00.000Z`;
}

/**
 * The newest fee-change record's id ("0" with none, or when the read fails): part of every confirmed-
 * change cache key, so a change recorded since the last read shows at once on every card. A primary-
 * key lookup. A record removed or taken down does not change it, so a removed change can linger for
 * up to the cache's hour. A page reads it once and passes it to every change read it makes, so its
 * cards always agree.
 */
export async function readNewestChangeRecord(): Promise<string> {
  try {
    const [row] = await sql`SELECT COALESCE(MAX(id), 0)::text AS newest FROM fee_change_records`;
    return String(row?.newest ?? "0");
  } catch {
    return "0";
  }
}

/** Confirmed changes in a state, cached for an hour per state, day and newest change record. */
const cachedStateChanges = unstable_cache(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `newestRecord` is part of the cache key only.
  async (stateCode: string, since: string, newestRecord: string): Promise<ConfirmedChangeInput[]> => {
    const { changes } = await loadConfirmedFeeChanges(since, stateCode);
    return changes.map((c) => ({
      institution_id: c.institution_id,
      institution_name: c.institution_name,
      fee_category: c.fee_category,
      display_name: c.display_name,
      old_amount: c.old_amount,
      new_amount: c.new_amount,
      direction: c.direction,
      changed_at: c.changed_at,
    }));
  },
  ["hamilton-dashboard-state-changes-v2"],
  { revalidate: 3600 },
);

/**
 * Like-for-like changes confirmed in the state in the briefing's window; null on a failed read.
 * `newestRecord` is readNewestChangeRecord's value, read once by the page.
 */
export async function readStateChanges(stateCode: string | null, newestRecord: string): Promise<ConfirmedChangeInput[] | null> {
  if (!stateCode) return [];
  try {
    return await cachedStateChanges(stateCode, windowStart(COMPETITOR_MOVE_WINDOW_DAYS), newestRecord);
  } catch {
    return null;
  }
}

/** The competitors the scorecard lists, from the briefing's local market. */
export function scorecardIds(briefing: Briefing | null): number[] {
  return (briefing?.localMarket?.rows ?? []).map((r) => r.institutionId);
}
