import { getPeerFeeValues, type PeerFilterSet } from "./fee-index";
import { getReportRuleCheck } from "./market-readiness";

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
  const rule = await getReportRuleCheck(institutionId);
  if (!rule?.passes || !rule.charter_type) return null;
  const filters: PeerFilterSet =
    rule.peerScope === "district" && rule.fed_district !== null
      ? { charter_type: rule.charter_type, fed_districts: [rule.fed_district] }
      : rule.state_code
        ? { charter_type: rule.charter_type, state_code: rule.state_code }
        : { charter_type: rule.charter_type };
  if (!filters.state_code && !filters.fed_districts) return null;

  const [byCategory] = await getPeerFeeValues([filters], [...PEER_RANK_FEE_KEYS]);
  const lines: PeerRankLine[] = [];
  for (const key of PEER_RANK_FEE_KEYS) {
    const values = byCategory?.get(key) ?? [];
    const own = values.find((value) => value.institution_id === institutionId);
    const others = values.filter((value) => value.institution_id !== institutionId).map((value) => value.amount);
    if (!own || others.length < MIN_PEERS_FOR_RANK) continue;
    lines.push({ key, own: own.amount, ...rankAgainstPeers(own.amount, others) });
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
