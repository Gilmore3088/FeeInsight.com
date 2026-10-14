import { sql } from "./connection";
import { getPeerFeeValues, type PeerFilterSet } from "./fee-index";
import { getReportRuleCheck, type ReportRuleCheck } from "./market-readiness";

/** The fees the free institution page ranks against peers (value funnel A3). */
export const PEER_RANK_FEE_KEYS = ["overdraft", "monthly_maintenance"] as const;

/** Below this many other institutions publishing a fee, the page shows no rank for it. */
export const MIN_PEERS_FOR_RANK = 5;

export interface PeerRankLine {
  key: (typeof PEER_RANK_FEE_KEYS)[number];
  own: number;
  /** Other institutions in the peer group with a lower, equal and higher fee. */
  lower: number;
  same: number;
  higher: number;
  peers: number;
}

export interface InstitutionPeerRank {
  /** "state" when the state has enough rich peers; otherwise the Fed district, as the report rule does. */
  scope: "state" | "district";
  state_code: string | null;
  fed_district: number | null;
  charter_type: string | null;
  lines: PeerRankLine[];
}

/** Where one fee sits among the other institutions' values. */
export function rankAgainstPeers(own: number, others: number[]): Omit<PeerRankLine, "key" | "own"> {
  let lower = 0;
  let same = 0;
  let higher = 0;
  for (const value of others) {
    if (Math.abs(value - own) < 0.005) same += 1;
    else if (value < own) lower += 1;
    else higher += 1;
  }
  return { lower, same, higher, peers: others.length };
}

/**
 * The institution's overdraft and maintenance fees ranked against same-charter peers, using
 * the paid report's peer rule (state, or Fed district when the state is thin) so the page
 * never shows a comparison the report could not make. Values come from the statistics
 * contract the page's national medians use. Null when the report rule is not met.
 */
export async function getInstitutionPeerRank(institutionId: number): Promise<InstitutionPeerRank | null> {
  return getInstitutionPeerRankForRule(institutionId, await getReportRuleCheck(institutionId));
}

/**
 * The peer group the report rule picks: same charter in the state, or in the Fed district
 * when the state is thin. Null when the rule fails or names no group.
 */
export function peerFiltersForRule(rule: ReportRuleCheck | null): PeerFilterSet | null {
  if (!rule?.passes || !rule.charter_type) return null;
  const filters: PeerFilterSet =
    rule.peerScope === "district" && rule.fed_district !== null
      ? { charter_type: rule.charter_type, fed_districts: [rule.fed_district] }
      : rule.state_code
        ? { charter_type: rule.charter_type, state_code: rule.state_code }
        : { charter_type: rule.charter_type };
  if (!filters.state_code && !filters.fed_districts) return null;
  return filters;
}

/** One institution's value for one ranked fee: [institution id, fee key, amount]. */
export type PeerGroupValue = [institutionId: number, key: PeerRankLine["key"], amount: number];

/**
 * Every institution's ranked-fee values in one peer group. Institutions in the same group
 * share this read, so a crawler walking institution pages costs one read per group, not one
 * per page.
 */
export async function getPeerGroupValues(filters: PeerFilterSet): Promise<PeerGroupValue[]> {
  const [byCategory] = await getPeerFeeValues([filters], [...PEER_RANK_FEE_KEYS]);
  const values: PeerGroupValue[] = [];
  for (const key of PEER_RANK_FEE_KEYS) {
    for (const value of byCategory?.get(key) ?? []) values.push([value.institution_id, key, value.amount]);
  }
  return values;
}

/**
 * One institution's ranked-fee value with what places it in a peer group:
 * [institution id, fee key, amount, charter, state, Fed district].
 */
export type PeerRankValue = [
  institutionId: number,
  key: PeerRankLine["key"],
  amount: number,
  charterType: string | null,
  stateCode: string | null,
  fedDistrict: number | null,
];

/**
 * Every institution's ranked-fee values, nationally, for the shared public cache. An
 * institution's value depends only on its own rows, so each peer group is a filter over
 * this list. One entry for every institution page: per-group entries were each re-read
 * after every takedown refresh of the public cache, about 300 reads an hour on Oct 9.
 */
export async function getAllPeerRankValues(): Promise<PeerRankValue[]> {
  const [byCategory] = await getPeerFeeValues([{}], [...PEER_RANK_FEE_KEYS]);
  const ids = new Set<number>();
  for (const key of PEER_RANK_FEE_KEYS) for (const value of byCategory?.get(key) ?? []) ids.add(value.institution_id);
  if (ids.size === 0) return [];
  const places = await sql<{ id: number | string; charter_type: string | null; state_code: string | null; fed_district: number | string | null }[]>`
    SELECT id, charter_type, state_code, fed_district FROM institution_sources WHERE id = ANY(${[...ids]}::bigint[])`;
  const placeOf = new Map(places.map((row) => [Number(row.id), row]));
  const values: PeerRankValue[] = [];
  for (const key of PEER_RANK_FEE_KEYS) {
    for (const value of byCategory?.get(key) ?? []) {
      const place = placeOf.get(value.institution_id);
      values.push([
        value.institution_id,
        key,
        value.amount,
        place?.charter_type ?? null,
        place?.state_code ?? null,
        place?.fed_district === null || place?.fed_district === undefined ? null : Number(place.fed_district),
      ]);
    }
  }
  return values;
}

/** The values of one peer group, filtered from the national list the way getPeerFeeValues filters rows. */
export function peerGroupValuesFrom(all: PeerRankValue[], filters: PeerFilterSet): PeerGroupValue[] {
  return all
    .filter(([, , , charterType, stateCode, fedDistrict]) => {
      if (filters.charter_type && charterType !== filters.charter_type) return false;
      if (filters.state_code && stateCode !== filters.state_code) return false;
      if (filters.fed_districts?.length && !filters.fed_districts.includes(Number(fedDistrict))) return false;
      return true;
    })
    .map(([institutionId, key, amount]) => [institutionId, key, amount]);
}

/** The institution's rank within its peer group's values (see getInstitutionPeerRank). */
export function peerRankFromGroupValues(
  institutionId: number,
  rule: ReportRuleCheck,
  filters: PeerFilterSet,
  values: PeerGroupValue[],
): InstitutionPeerRank | null {
  const lines: PeerRankLine[] = [];
  for (const key of PEER_RANK_FEE_KEYS) {
    const forKey = values.filter((value) => value[1] === key);
    const own = forKey.find((value) => value[0] === institutionId);
    const others = forKey.filter((value) => value[0] !== institutionId).map((value) => value[2]);
    if (!own || others.length < MIN_PEERS_FOR_RANK) continue;
    lines.push({ key, own: own[2], ...rankAgainstPeers(own[2], others) });
  }
  if (lines.length === 0) return null;
  return {
    scope: filters.fed_districts ? "district" : "state",
    state_code: rule.state_code,
    fed_district: rule.fed_district,
    charter_type: rule.charter_type,
    lines,
  };
}

/** The peer rank once the institution's report rule check is known (see getInstitutionPeerRank). */
export async function getInstitutionPeerRankForRule(
  institutionId: number,
  rule: ReportRuleCheck | null,
): Promise<InstitutionPeerRank | null> {
  const filters = peerFiltersForRule(rule);
  if (!rule || !filters) return null;
  return peerRankFromGroupValues(institutionId, rule, filters, await getPeerGroupValues(filters));
}
