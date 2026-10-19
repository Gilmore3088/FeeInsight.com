/**
 * Fee income against peers, for Hamilton's written answer (#1084): one institution's service
 * charge income beside the median of a peer group, on the same call report quarter and the
 * same filer. getFiledFeeIncomeData gives each quarter's own income for both filers (#1245:
 * NCUA year-to-date less the prior quarter), independently of fee-schedule coverage.
 */
import type { FiledFeeIncome } from "@/lib/data-store/fee-revenue";
import { financialMeasureDefinition, financialSourceForCharter } from "@/lib/data-store/financial-peer-contract";

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

function matches(row: FiledFeeIncome, filters: FeeIncomePeerFilters): boolean {
  // Hand-picked ids and the other filters both apply, as in the charts' peer readers.
  if (filters.institutionIds?.length && !filters.institutionIds.includes(row.institution_id)) return false;
  if (filters.states?.length && !filters.states.includes((row.state_code ?? "").toUpperCase())) return false;
  if (filters.charterType && row.charter_type !== filters.charterType) return false;
  if (filters.assetTiers?.length && !filters.assetTiers.includes(row.asset_size_tier ?? "")) return false;
  if (filters.fedDistricts?.length && !filters.fedDistricts.includes(Number(row.fed_district))) return false;
  return true;
}

function describe(row: FiledFeeIncome) {
  return {
    institution_id: row.institution_id,
    name: row.institution_name,
    state: row.state_code,
    charter_type: row.charter_type,
    total_assets: row.total_assets,
    service_charge_income: row.service_charge_income,
    financial_source: row.financial_source,
    source: row.financial_source,
    units: "thousands of dollars",
    field_units: { income_per_10k_assets: "USD income per 10,000 USD assets" },
    report_date: row.report_date,
    income_per_10k_assets: row.fee_income_ratio,
  };
}

export function feeIncomeAgainstPeers(
  rows: FiledFeeIncome[],
  institutionId: number,
  filters: FeeIncomePeerFilters,
) {
  const subject = rows.find((row) => row.institution_id === institutionId);
  if (!subject) {
    return {
      view: "peers" as const,
      error: "This institution has no computable standalone-quarter income in a canonical financial filing, so its fee income cannot be compared. Published fee-schedule coverage is not required.",
    };
  }
  const source = financialSourceForCharter(subject.charter_type);
  if (!source || subject.financial_source !== source || !subject.report_date || subject.service_charge_income === null || !Number.isFinite(Number(subject.service_charge_income))) {
    return { view: "peers" as const, error: "This institution has no source- and charter-consistent dated financial filing, so its fee income cannot be compared." };
  }
  const peers = rows.filter((row) =>
    row.institution_id !== institutionId
    && row.report_date === subject.report_date
    && row.financial_source === source
    && financialSourceForCharter(row.charter_type) === source
    && row.fee_income_ratio !== null
    && Number.isFinite(Number(row.fee_income_ratio))
    && row.service_charge_income !== null
    && Number.isFinite(Number(row.service_charge_income))
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
    source,
    units: "thousands of dollars",
    field_units: { peer_median_income_per_10k_assets: "USD income per 10,000 USD assets" },
    quarter: subject.report_date ?? null,
    income_basis: subject.financial_source === "ncua"
      ? "NCUA 5300 broad fee income (account 131) for this quarter (year to date less the prior quarter); not deposit-only service charges"
      : "FDIC call report deposit-account service charge income for this quarter",
    measure: "income_per_10k_assets is service charge income per $10,000 of total assets",
    subject: describe(subject),
    peer_count: peers.length,
    peers_rule: "Peers filed for the same quarter with the same canonical regulator and charter type; the institution itself is not counted. Published fee-schedule coverage is not required. Bank deposit-account service charges and NCUA broad fee income are not comparable measures.",
    comparison: {
      ...financialMeasureDefinition(source),
      financial_source: source,
      report_date: subject.report_date,
      period_basis: "standalone_quarter",
      income_unit: "thousands of dollars",
      ratio_unit: "USD income per 10,000 USD assets",
      subject_included: false,
      sample_size: peers.length,
      population_basis: "filed_financials",
      fee_schedule_coverage_required: false,
      eligibility: "Same canonical regulator and charter, the subject's exact filing quarter, computable standalone-quarter income and finite income per $10,000 of positive reported assets, matching the saved filters; the subject is excluded",
      minimum_median_count: MIN_PEERS_FOR_MEDIAN,
      filters,
    },
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
