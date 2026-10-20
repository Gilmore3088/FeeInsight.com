/**
 * National trends for the National Fee Index: each Fed district, a state ranking, size
 * tiers, sixteen quarters of call-report fee income, and the highest published fees.
 *
 * No AI calls. `buildNationalTrends` is pure; `assembleNationalTrends` reads the published
 * fee catalog (approved, sourced rows under the statistics contract) and FDIC/NCUA filings.
 * A group with fewer institutions than the minimum sample gets no median and no rank.
 */

import { getRevenueTrend, getDistrictIncomeTrend, type DistrictIncomeQuarter, type RevenueSnapshot } from "@/lib/data-store/call-reports";
import { FINANCIAL_SOURCES, type FinancialSource } from "@/lib/data-store/financial-sources";
import { buildFinancialIncomeGroup, type FinancialIncomeGroup } from "./financial-income";
import { getSegmentFeeRows, type SegmentFeeRow } from "@/lib/data-store/fee-index";
import { MIN_INSTITUTIONS_FOR_MEDIAN, countedInstitutionCount, countedValuePerInstitution, summarizeFees } from "@/lib/data-store/fee-stats";
import { DISTRICT_NAMES } from "@/lib/fed-districts";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { ASSET_TIER_RANGES } from "@/lib/hamilton/peer-index";

/** The fees each breakdown reports, in display order. */
export const TREND_FEES = ["overdraft", "nsf", "monthly_maintenance", "atm_non_network"] as const;
export type TrendFee = (typeof TREND_FEES)[number];

/** The fees states are ranked on. */
export const RANKED_FEES: TrendFee[] = ["overdraft", "monthly_maintenance"];

export const TREND_QUARTERS = 16;
const OUTLIERS_PER_FEE = 8;

const TIER_ORDER = ["community_small", "community_mid", "community_large", "regional", "large_regional", "super_regional"];
const TIER_NAMES: Record<string, string> = {
  community_small: "Small community",
  community_mid: "Mid community",
  community_large: "Large community",
  regional: "Regional",
  large_regional: "Large regional",
  super_regional: "Super regional",
};

export interface FeeMedian {
  median: number | null;
  institutions: number;
}

export interface DistrictTrend {
  district: number;
  name: string;
  institutions: number;
  fees: Record<TrendFee, FeeMedian>;
  /** Latest quarter's service-charge income in thousands, and change from a year earlier. */
  income: { quarter: string; thousands: number; yoyPct: number | null; institutions: number } | null;
  financialIncome?: FinancialIncomeGroup[];
}

export interface StateRank {
  state: string;
  rank: number;
  median: number;
  p25: number | null;
  p75: number | null;
  institutions: number;
}

export interface StateRanking {
  fee: TrendFee;
  feeName: string;
  ranked: StateRank[];
  /** States with published fees but fewer institutions than the minimum sample. */
  tooFew: { state: string; institutions: number }[];
}

export interface TierTrend {
  tier: string;
  label: string;
  range: string;
  institutions: number;
  fees: Record<TrendFee, FeeMedian>;
}

export interface IncomeQuarter {
  quarter: string;
  thousands: number;
  bankThousands: number;
  cuThousands: number;
  institutions: number;
  yoyPct: number | null;
}

export interface FeeOutlier {
  fee: TrendFee;
  feeName: string;
  /** Tukey fence: the 75th percentile plus 1.5 times the middle-half spread. */
  fence: number;
  median: number;
  aboveFence: number;
  institutionsPriced: number;
  highest: { institution: string; state: string | null; amount: number }[];
}

export interface NationalTrends {
  districts: DistrictTrend[];
  stateRankings: StateRanking[];
  tiers: TierTrend[];
  income: IncomeQuarter[];
  financialIncomeGroups?: FinancialIncomeGroup[];
  outliers: FeeOutlier[];
  /** One line per source, for the "how this was built" note. */
  provenance: string[];
}

function feeMedians(rows: SegmentFeeRow[]): Record<TrendFee, FeeMedian> {
  const out = {} as Record<TrendFee, FeeMedian>;
  for (const fee of TREND_FEES) {
    const stats = summarizeFees(rows.filter((r) => r.fee_category === fee));
    out[fee] = { median: stats.institution_count >= MIN_INSTITUTIONS_FOR_MEDIAN ? stats.median_amount : null, institutions: stats.institution_count };
  }
  return out;
}

/** Institutions behind these rows, counted as the medians count them (sister charters of one schedule once). */
function institutionsIn(rows: SegmentFeeRow[]): number {
  return countedInstitutionCount(rows);
}

function groupBy<K>(rows: SegmentFeeRow[], key: (r: SegmentFeeRow) => K | null | undefined): Map<K, SegmentFeeRow[]> {
  const groups = new Map<K, SegmentFeeRow[]>();
  for (const row of rows) {
    const k = key(row);
    if (k === null || k === undefined) continue;
    const list = groups.get(k);
    if (list) list.push(row);
    else groups.set(k, [row]);
  }
  return groups;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function districtTrends(rows: SegmentFeeRow[], incomeGroups: { source: FinancialSource; rows: DistrictIncomeQuarter[] }[]): DistrictTrend[] {
  const byDistrict = groupBy(rows, (r) => (r.fed_district && DISTRICT_NAMES[r.fed_district] ? r.fed_district : null));
  return Object.keys(DISTRICT_NAMES).map(Number).map((district) => {
    const group = byDistrict.get(district) ?? [];
    const financialIncome = incomeGroups.map(({ source, rows: filings }) => {
      const scoped = filings.filter((r) => r.fed_district === district).sort((a, b) => b.quarter.localeCompare(a.quarter));
      return buildFinancialIncomeGroup(source, scoped.map((row) => {
        const before = scoped.find((p) => p.quarter === `${Number(row.quarter.slice(0, 4)) - 1}${row.quarter.slice(4)}`);
        return { ...row, total_institutions: row.institutions, bank_service_charges: source === "fdic" ? row.total_service_charges : 0, cu_service_charges: source === "ncua" ? row.total_service_charges : 0,
          yoy_change_pct: before && before.total_service_charges > 0 ? round1((row.total_service_charges / before.total_service_charges - 1) * 100) : null };
      }), TREND_QUARTERS, `Federal Reserve district ${district} (${DISTRICT_NAMES[district]})`);
    });
    return { district, name: DISTRICT_NAMES[district], institutions: institutionsIn(group), fees: feeMedians(group), income: null, financialIncome };
  });
}

function stateRankings(rows: SegmentFeeRow[]): StateRanking[] {
  return RANKED_FEES.map((fee) => {
    const byState = groupBy(rows.filter((r) => r.fee_category === fee), (r) => r.state_code);
    const ranked: Omit<StateRank, "rank">[] = [];
    const tooFew: StateRanking["tooFew"] = [];
    for (const [state, group] of byState) {
      const stats = summarizeFees(group);
      if (stats.institution_count >= MIN_INSTITUTIONS_FOR_MEDIAN && stats.median_amount !== null) {
        ranked.push({ state, median: stats.median_amount, p25: stats.p25_amount, p75: stats.p75_amount, institutions: stats.institution_count });
      } else {
        tooFew.push({ state, institutions: stats.institution_count });
      }
    }
    // Most state medians sit on the same round price, so the order is median, then the
    // 75th percentile, then the 25th. States equal on all three share a rank.
    const key = (r: Omit<StateRank, "rank">) => [r.median, r.p75 ?? r.median, r.p25 ?? r.median];
    ranked.sort((a, b) => {
      const [ka, kb] = [key(a), key(b)];
      return kb[0] - ka[0] || kb[1] - ka[1] || kb[2] - ka[2] || b.institutions - a.institutions || a.state.localeCompare(b.state);
    });
    let rank = 0;
    const withRank = ranked.map((r, i) => {
      if (i === 0 || key(r).some((v, j) => v !== key(ranked[i - 1])[j])) rank = i + 1;
      return { ...r, rank };
    });
    tooFew.sort((a, b) => a.state.localeCompare(b.state));
    return { fee, feeName: getDisplayName(fee), ranked: withRank, tooFew };
  });
}

function tierTrends(rows: SegmentFeeRow[]): TierTrend[] {
  const byTier = groupBy(rows, (r) => r.asset_size_tier);
  return TIER_ORDER.filter((t) => byTier.has(t)).map((tier) => {
    const group = byTier.get(tier) ?? [];
    return {
      tier,
      label: TIER_NAMES[tier] ?? tier,
      range: ASSET_TIER_RANGES[tier] ?? "",
      institutions: institutionsIn(group),
      fees: feeMedians(group),
    };
  });
}

function outliers(rows: SegmentFeeRow[]): FeeOutlier[] {
  const out: FeeOutlier[] = [];
  for (const fee of TREND_FEES) {
    const group = rows.filter((r) => r.fee_category === fee);
    // The medians' own population: one value per institution, sister charters of one schedule once.
    const values = countedValuePerInstitution(group);
    const stats = summarizeFees(group);
    if (stats.p25_amount === null || stats.p75_amount === null || stats.median_amount === null) continue;
    const fence = stats.p75_amount + 1.5 * (stats.p75_amount - stats.p25_amount);
    const meta = new Map(group.map((r) => [r.institution_id, r]));
    const above = [...values.entries()]
      .filter(([, v]) => v > fence)
      .sort((a, b) => b[1] - a[1] || (meta.get(a[0])?.institution_name ?? "").localeCompare(meta.get(b[0])?.institution_name ?? ""));
    out.push({
      fee,
      feeName: getDisplayName(fee),
      fence: Math.round(fence * 100) / 100,
      median: stats.median_amount,
      aboveFence: above.length,
      institutionsPriced: values.size,
      highest: above.slice(0, OUTLIERS_PER_FEE).map(([id, amount]) => ({
        institution: meta.get(id)?.institution_name ?? `Institution ${id}`,
        state: meta.get(id)?.state_code ?? null,
        amount,
      })),
    });
  }
  return out;
}

export function buildNationalTrends(input: {
  feeRows: SegmentFeeRow[];
  nationalIncome?: RevenueSnapshot[];
  districtIncome?: DistrictIncomeQuarter[];
  financialIncomeGroups?: FinancialIncomeGroup[];
  districtIncomeGroups?: { source: FinancialSource; rows: DistrictIncomeQuarter[] }[];
}): NationalTrends {
  const { feeRows } = input;
  const financialIncomeGroups = input.financialIncomeGroups ?? [];
  return {
    districts: districtTrends(feeRows, input.districtIncomeGroups ?? []),
    stateRankings: stateRankings(feeRows),
    tiers: tierTrends(feeRows),
    income: [],
    financialIncomeGroups,
    outliers: outliers(feeRows),
    provenance: [
      `Fee medians: approved, sourced rows in the published fee catalog (${institutionsIn(feeRows).toLocaleString("en-US")} institutions across the ${TREND_FEES.length} fees shown); one value per institution, overdraft at its highest tier; no median below ${MIN_INSTITUTIONS_FOR_MEDIAN} institutions.`,
      ...financialIncomeGroups.map((group) => `${group.publisher}: ${group.definition}; ${group.unit}; ${group.period_basis}. ${group.cohort_rule}`),
      "Highest published fees: institutions above the Tukey fence (75th percentile plus 1.5 times the middle-half spread) for each fee.",
    ],
  };
}

export async function assembleNationalTrends(): Promise<NationalTrends> {
  const [feeRows, groups] = await Promise.all([
    getSegmentFeeRows([...TREND_FEES]),
    Promise.all(FINANCIAL_SOURCES.map(async (source) => {
      const [revenue, districtRows] = await Promise.all([
        getRevenueTrend(TREND_QUARTERS + 4, source),
        getDistrictIncomeTrend(TREND_QUARTERS + 4, source),
      ]);
      return { source, national: buildFinancialIncomeGroup(source, revenue.quarters, TREND_QUARTERS, "United States", revenue.cohort_history), rows: districtRows };
    })),
  ]);
  return buildNationalTrends({ feeRows, financialIncomeGroups: groups.map((g) => g.national), districtIncomeGroups: groups });
}
