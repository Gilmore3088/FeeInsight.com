import { getFinancialsByInstitution, getPeerFinancialMedians, getPeerPercentiles, MIN_PEERS_FOR_RANK } from "@/lib/data-store/financial";
import { getPeerFeeValues } from "@/lib/data-store/fee-index";
import { comparePeerCategory } from "@/lib/data-store/peer-comparison";
import { getPeerSubject, resolvePeerRequest } from "@/lib/data-store/peer-sets";
import { cachedPublicRead } from "@/lib/data-store/public-read-cache";

/**
 * Peer context for an institution report (James, Oct 18: "we need more of the external /
 * reported peer data in this"): the report's own fee lines against institutions of the same
 * charter and asset size nationwide, then the same institutions' call-report figures. One peer
 * group throughout, the group getPeerFinancialMedians and the revenue section's rank already use
 * (same charter, same asset-size tier), resolved through peer-sets.ts so it is never computed two
 * ways. Fee values follow the statistics contract (getPeerFeeValues, comparePeerCategory); below
 * its minimum a line has no median and the report says so. A financial figure gets a rank only
 * when at least MIN_PEERS_FOR_RANK peers report it (the CFPB rule: never zero-fill thin peers).
 */

/** The call-report figures the report sets against peers, in reading order. */
export const PEER_FINANCIAL_KEYS = ["fee_income_ratio", "roa", "net_interest_margin", "efficiency_ratio"] as const;
export type PeerFinancialKey = (typeof PEER_FINANCIAL_KEYS)[number];

export const PEER_FINANCIAL_LABELS: Record<PeerFinancialKey, string> = {
  fee_income_ratio: "Deposit service charges as a share of revenue",
  roa: "Return on assets",
  net_interest_margin: "Net interest margin",
  efficiency_ratio: "Efficiency ratio",
};

export interface PeerFeeRow {
  key: string;
  /** The amount the report shows for the institution on this line, in dollars. */
  own: number;
  peerCount: number;
  median: number;
  p25: number | null;
  p75: number | null;
  /** 0 to 100: the share of peers below, counting half of those at the same price. */
  percentile: number | null;
}

export interface PeerFinancialRow {
  key: PeerFinancialKey;
  /** Percent (1.05 = 1.05%), the fee-income share converted from its stored fraction. */
  own: number;
  median: number;
  /** 0 to 100, or null below MIN_PEERS_FOR_RANK reporting peers. */
  percentile: number | null;
}

export interface ReportPeerContext {
  /** "Banks with $1B to $10B in assets". */
  groupLabel: string;
  fees: PeerFeeRow[];
  /** Report lines the institution prices that fewer than MIN_PEERS_FOR_RANK peers publish. */
  thinFeeKeys: string[];
  financial: {
    /** Calendar quarter end, YYYY-MM-DD. */
    reportDate: string;
    source: "fdic" | "ncua";
    /** Peers that filed for the quarter, the institution itself left out. */
    peerCount: number;
    rows: PeerFinancialRow[];
  } | null;
}

/** "2026-06-30" -> "Q2 2026". */
export function quarterOfDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})/.exec(isoDate);
  if (!match) return isoDate;
  return `Q${Math.ceil(Number(match[2]) / 3)} ${match[1]}`;
}

/** A stored figure in percent: the fee-income share is stored as a fraction, the rest as percent. */
export function financialPercent(key: PeerFinancialKey, value: number): number {
  return key === "fee_income_ratio" ? value * 100 : value;
}

export function buildPeerFinancialRows(
  own: Partial<Record<PeerFinancialKey, number | null>>,
  medians: Partial<Record<PeerFinancialKey, number | null>>,
  percentiles: Partial<Record<PeerFinancialKey, number | null>>,
): PeerFinancialRow[] {
  const rows: PeerFinancialRow[] = [];
  for (const key of PEER_FINANCIAL_KEYS) {
    const mine = own[key];
    const median = medians[key];
    // A zero fee share or return is a missing line, not a figure (getPeerFinancialMedians' rule).
    if (mine === null || mine === undefined || median === null || median === undefined) continue;
    if ((key === "fee_income_ratio" || key === "roa") && mine === 0) continue;
    if (key === "efficiency_ratio" && (mine < 0 || mine > 200)) continue;
    rows.push({ key, own: financialPercent(key, mine), median: financialPercent(key, median), percentile: percentiles[key] ?? null });
  }
  return rows;
}

export type ReportPeerFinancial = NonNullable<ReportPeerContext["financial"]>;

/**
 * The institution's own call-report figures beside its peers' medians, only when both come from
 * the same filing and quarter and at least MIN_PEERS_FOR_RANK other institutions filed (the
 * median counts the institution itself). Null otherwise, or when no figure survives.
 */
function peerFinancialFrom(
  own: Awaited<ReturnType<typeof getFinancialsByInstitution>>[number] | undefined,
  medians: Awaited<ReturnType<typeof getPeerFinancialMedians>>,
  ranks: Awaited<ReturnType<typeof getPeerPercentiles>>,
): ReportPeerFinancial | null {
  if (!own || !medians || medians.peer_count - 1 < MIN_PEERS_FOR_RANK) return null;
  const quarter = medians.report_date.slice(0, 10);
  if (String(own.report_date).slice(0, 10) !== quarter || own.source !== medians.source) return null;
  if (medians.source !== "fdic" && medians.source !== "ncua") return null;
  const rows = buildPeerFinancialRows(
    own,
    { ...medians, fee_income_ratio: medians.fee_income_peer_count >= MIN_PEERS_FOR_RANK ? medians.fee_income_ratio : null },
    ranks && ranks.report_date.slice(0, 10) === quarter ? ranks.percentiles : {},
  );
  return rows.length ? { reportDate: quarter, source: medians.source, peerCount: medians.peer_count - 1, rows } : null;
}

async function getReportPeerFinancial(institutionId: number): Promise<ReportPeerFinancial | null> {
  const [ownRows, medians, ranks] = await Promise.all([
    getFinancialsByInstitution(institutionId, 1),
    getPeerFinancialMedians(institutionId),
    getPeerPercentiles(institutionId),
  ]);
  return peerFinancialFrom(ownRows[0], medians, ranks);
}

/** The call-report half alone, for the homepage's Hamilton example (one cheap read, no fee rows). */
export const getReportPeerFinancialCached = cachedPublicRead("report-peer-financial", getReportPeerFinancial);

async function getReportPeerContext(institutionId: number, lines: [key: string, amount: number][]): Promise<ReportPeerContext | null> {
  const subject = await getPeerSubject(institutionId);
  if (!subject?.charter_type || !subject.asset_size_tier) return null;
  const resolved = await resolvePeerRequest(subject, { charter_type: "same", asset_tiers: "same" });
  if (!resolved.filters) return null;

  const categories = lines.map(([key]) => key);
  const [peerSets, ownRows, medians, ranks] = await Promise.all([
    categories.length ? getPeerFeeValues([resolved.filters], categories, institutionId) : Promise.resolve([new Map()]),
    getFinancialsByInstitution(institutionId, 1).catch(() => []),
    getPeerFinancialMedians(institutionId).catch(() => null),
    getPeerPercentiles(institutionId).catch(() => null),
  ]);
  const values = peerSets[0] ?? new Map();

  const fees: PeerFeeRow[] = [];
  const thinFeeKeys: string[] = [];
  for (const [key, amount] of lines) {
    const row = comparePeerCategory(key, amount, values.get(key) ?? []);
    // A median from fewer than MIN_PEERS_FOR_RANK peers is named as thin, never shown.
    if (row.peer_median === null || row.peer_count < MIN_PEERS_FOR_RANK) {
      thinFeeKeys.push(key);
      continue;
    }
    fees.push({ key, own: amount, peerCount: row.peer_count, median: row.peer_median, p25: row.peer_p25, p75: row.peer_p75, percentile: row.percentile });
  }

  const financial = peerFinancialFrom(ownRows[0], medians, ranks);

  if (fees.length === 0 && !financial) return null;
  return { groupLabel: resolved.label, fees, thinFeeKeys, financial };
}

export const getReportPeerContextCached = cachedPublicRead("report-peer-context", getReportPeerContext);

/** The report's priced lines as the peer read takes them: each line's key and the amount the report shows. */
export function peerLinesFor(lines: { key: string; own?: { amount: number } | null }[]): [key: string, amount: number][] {
  return lines.filter((l) => l.own && Number.isFinite(l.own.amount)).map((l) => [l.key, l.own!.amount]);
}
