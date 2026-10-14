/**
 * Fee income against peers, for Hamilton's written answer (#1084): one institution's service
 * charge income beside the median of a peer group, on the same call report quarter and the
 * same filer (FDIC quarterly vs NCUA year-to-date income never mix). Pure; the rows come from
 * getFeeRevenueData.
 */
import type { FeeRevenueCorrelation } from "@/lib/data-store/fee-revenue";

/** Below this many peers there is no median (the Pro evidence rule). */
export const MIN_PEERS_FOR_MEDIAN = 5;
const MAX_PEER_ROWS = 15;

export interface FeeIncomePeerFilters {
  institutionIds?: number[];
  states?: string[];
  charterType?: string;
  assetTiers?: string[];
  fedDistricts?: number[];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function matches(row: FeeRevenueCorrelation, filters: FeeIncomePeerFilters): boolean {
  if (filters.institutionIds?.length) return filters.institutionIds.includes(row.institution_id);
  if (filters.states?.length && !filters.states.includes((row.state_code ?? "").toUpperCase())) return false;
  if (filters.charterType && row.charter_type !== filters.charterType) return false;
  if (filters.assetTiers?.length && !filters.assetTiers.includes(row.asset_size_tier ?? "")) return false;
  if (filters.fedDistricts?.length && !filters.fedDistricts.includes(Number(row.fed_district))) return false;
  return true;
}

function describe(row: FeeRevenueCorrelation) {
  return {
    institution_id: row.institution_id,
    name: row.institution_name,
    state: row.state_code,
    charter_type: row.charter_type,
    total_assets: row.total_assets,
    service_charge_income: row.service_charge_income,
    income_per_10k_assets: row.fee_income_ratio,
  };
}

export function feeIncomeAgainstPeers(
  rows: FeeRevenueCorrelation[],
  institutionId: number,
  filters: FeeIncomePeerFilters,
) {
  const subject = rows.find((row) => row.institution_id === institutionId);
  if (!subject) {
    return {
      view: "peers" as const,
      error: "This institution has no call report service charge income on file with at least three published fees, so its fee income cannot be compared.",
    };
  }
  const peers = rows.filter((row) =>
    row.institution_id !== institutionId
    && row.report_date === subject.report_date
    && row.financial_source === subject.financial_source
    && row.fee_income_ratio !== null
    && matches(row, filters),
  );
  const ratios = peers.map((row) => Number(row.fee_income_ratio));
  const enough = peers.length >= MIN_PEERS_FOR_MEDIAN;
  const peerMedian = enough ? median(ratios) : null;
  const below = enough && subject.fee_income_ratio !== null
    ? ratios.filter((ratio) => ratio < Number(subject.fee_income_ratio)).length
    : null;
  return {
    view: "peers" as const,
    quarter: subject.report_date ?? null,
    income_basis: subject.financial_source === "ncua"
      ? "NCUA 5300 service charge income, year to date at this quarter"
      : "FDIC call report service charge income for this quarter",
    measure: "income_per_10k_assets is service charge income per $10,000 of total assets",
    subject: describe(subject),
    peer_count: peers.length,
    peers_rule: "Peers filed for the same quarter with the same regulator; the institution itself is not counted.",
    peer_median_income_per_10k_assets: peerMedian === null ? null : Math.round(peerMedian * 100) / 100,
    peer_median_service_charge_income: enough ? median(peers.map((row) => Number(row.service_charge_income ?? 0))) : null,
    peers_below_subject: below,
    ...(enough ? {} : { message: `Only ${peers.length} peers have fee income on file for this quarter; below ${MIN_PEERS_FOR_MEDIAN} there is no median.` }),
    peers: peers
      .sort((a, b) => Number(b.total_assets ?? 0) - Number(a.total_assets ?? 0))
      .slice(0, MAX_PEER_ROWS)
      .map(describe),
  };
}
