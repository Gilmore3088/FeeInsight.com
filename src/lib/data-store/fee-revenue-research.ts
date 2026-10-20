import { getTierForAssets, FDIC_TIER_BREAKPOINTS } from "@/lib/fed-districts";
import { getFeeRevenueData, type FeeRevenueCorrelation } from "./fee-revenue";
import { financialMeasureDefinition, financialSourceForCharter } from "./financial-peer-contract";
import { FINANCIAL_SOURCES, type FinancialSource } from "./financial-sources";

export const MINIMUM_RESEARCH_SUMMARY_COUNT = 5;
export const RESEARCH_RANKING_PREVIEW_LIMIT = 50;

export interface FeeRevenueResearchInstitution {
  institution_id: number;
  institution_name: string;
  state_code: string | null;
  source: FinancialSource;
  charter_type: "bank" | "credit_union";
  report_date: string;
  /** Derived from the matched filing's reported assets, not the current registry tier. */
  asset_size_tier: string;
  listed_fee_usd: number;
  published_fee_category_count: number;
  income_usd: number;
  assets_usd: number | null;
  /** Quarterly income per 10,000 dollars of quarter-end assets; not a revenue share. */
  income_per_10k_assets: number | null;
}

export interface FeeRevenueResearchSummary {
  institution_count: number;
  ratio_reported_count: number;
  mean_listed_fee_usd: number | null;
  mean_income_usd: number | null;
  mean_income_per_10k_assets: number | null;
}

export interface FeeRevenueResearchGroup extends Omit<ReturnType<typeof financialMeasureDefinition>, "unit"> {
  unit: "USD";
  stored_income_unit: "thousands of dollars";
  fee_price_unit: "USD";
  fee_price_basis: "current_published_categories_not_historical_prices";
  intensity_unit: "USD income per 10,000 USD assets";
  report_date: string;
  date_selection_basis: "newest_usable_matched_quarter";
  date_selection_definition: string;
  institution_count: number;
  stale_institution_count: number;
  stale_report_dates: string[];
  minimum_summary_count: number;
  population_basis: "fee_price_income_correlation";
  size_basis: "matched_filing_reported_assets";
  eligibility: { minimum_published_fee_categories: 3; definition: string };
  summary: FeeRevenueResearchSummary;
  by_tier: Array<FeeRevenueResearchSummary & { asset_size_tier: string }>;
  institutions: FeeRevenueResearchInstitution[];
  rankings: Array<FeeRevenueResearchInstitution & { rank: number }>;
  limitations: string[];
}

export interface FeeRevenueResearch {
  groups: FeeRevenueResearchGroup[];
  excluded_invalid_rows: number;
  excluded_duplicate_rows: number;
  conflicting_institution_count: number;
}

export interface FeeRevenueResearchPreviewGroup extends Omit<FeeRevenueResearchGroup, "institutions" | "rankings"> {
  rankings: FeeRevenueResearchGroup["rankings"];
  /** Counts available full-cohort ranked rows after the five-institution floor. */
  ranking_preview: { limit: 50; total: number; complete: boolean };
}

export interface FeeRevenueResearchPreview extends Omit<FeeRevenueResearch, "groups"> {
  groups: FeeRevenueResearchPreviewGroup[];
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const safe = (value: unknown): value is number => finite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
const quarterEnd = (value: unknown): value is string => typeof value === "string" && /^20\d{2}-(?:03-31|06-30|09-30|12-31)$/.test(value);

function institution(row: FeeRevenueCorrelation): FeeRevenueResearchInstitution | null {
  if (!row || typeof row !== "object") return null;
  const source = row.financial_source;
  if ((source !== "fdic" && source !== "ncua") || financialSourceForCharter(row.charter_type) !== source
    || !Number.isSafeInteger(row.institution_id) || row.institution_id <= 0
    || typeof row.institution_name !== "string" || !row.institution_name.trim() || !quarterEnd(row.report_date)
    || row.regulatory_status === "inactive" || !Number.isSafeInteger(row.fee_count) || row.fee_count < 3
    || !safe(row.avg_fee) || row.avg_fee < 0 || !safe(row.service_charge_income)
    || (row.total_assets !== null && (!safe(row.total_assets) || row.total_assets < 0))) return null;
  // Income is already a canonical standalone quarter at the reader boundary (#1245).
  const incomeUsd = row.service_charge_income * 1000;
  const assetsUsd = row.total_assets === null ? null : row.total_assets * 1000;
  if (!safe(incomeUsd) || (assetsUsd !== null && !safe(assetsUsd))) return null;
  const intensity = assetsUsd !== null && assetsUsd > 0 ? incomeUsd / assetsUsd * 10000 : null;
  return {
    institution_id: row.institution_id,
    institution_name: row.institution_name,
    state_code: typeof row.state_code === "string" ? row.state_code : null,
    source,
    charter_type: source === "fdic" ? "bank" : "credit_union",
    report_date: row.report_date,
    asset_size_tier: assetsUsd === null ? "unknown" : getTierForAssets(assetsUsd),
    listed_fee_usd: row.avg_fee,
    published_fee_category_count: row.fee_count,
    income_usd: incomeUsd,
    assets_usd: assetsUsd,
    income_per_10k_assets: safe(intensity) ? intensity : null,
  };
}

function mean(values: number[]): number | null {
  if (values.length < MINIMUM_RESEARCH_SUMMARY_COUNT) return null;
  // Divide each term first so a valid large cohort cannot overflow its intermediate sum.
  const value = values.reduce((sum, term) => sum + term / values.length, 0);
  return safe(value) ? value : null;
}

function summary(rows: readonly FeeRevenueResearchInstitution[]): FeeRevenueResearchSummary {
  const intensities = rows.map((row) => row.income_per_10k_assets).filter(finite);
  return {
    institution_count: rows.length,
    ratio_reported_count: intensities.length,
    mean_listed_fee_usd: mean(rows.map((row) => row.listed_fee_usd)),
    mean_income_usd: mean(rows.map((row) => row.income_usd)),
    mean_income_per_10k_assets: mean(intensities),
  };
}

/** One source/date cohort supplies every summary, size group and rank; no stored-data changes. */
export function buildFeeRevenueResearch(rows: readonly FeeRevenueCorrelation[]): FeeRevenueResearch {
  const result: FeeRevenueResearch = { groups: [], excluded_invalid_rows: 0, excluded_duplicate_rows: 0, conflicting_institution_count: 0 };
  const unique = new Map<number, FeeRevenueResearchInstitution | null>();
  for (const raw of rows) {
    const row = institution(raw);
    if (!row) { result.excluded_invalid_rows++; continue; }
    if (!unique.has(row.institution_id)) unique.set(row.institution_id, row);
    else {
      result.excluded_duplicate_rows++;
      const prior = unique.get(row.institution_id);
      // Never choose between contradictory returned identities, sources, dates or amounts.
      if (prior !== null && JSON.stringify(prior) !== JSON.stringify(row)) {
        unique.set(row.institution_id, null);
        result.conflicting_institution_count++;
      }
    }
  }
  const valid = [...unique.values()].filter((row): row is FeeRevenueResearchInstitution => row !== null);
  for (const source of FINANCIAL_SOURCES) {
    const matched = valid.filter((row) => row.source === source);
    if (!matched.length) continue;
    const date = matched.reduce((latest, row) => row.report_date > latest ? row.report_date : latest, matched[0].report_date);
    const current = matched.filter((row) => row.report_date === date).sort((a, b) => a.institution_id - b.institution_id);
    const stale = matched.filter((row) => row.report_date !== date);
    const tiers = new Map<string, FeeRevenueResearchInstitution[]>();
    for (const row of current) {
      const members = tiers.get(row.asset_size_tier) ?? [];
      members.push(row);
      tiers.set(row.asset_size_tier, members);
    }
    const ratioRows = current.filter((row) => row.income_per_10k_assets !== null)
      .sort((a, b) => b.income_per_10k_assets! - a.income_per_10k_assets! || a.institution_id - b.institution_id);
    let rank = 0;
    const rankings = ratioRows.length < MINIMUM_RESEARCH_SUMMARY_COUNT ? [] : ratioRows.map((row, index) => {
      if (index === 0 || row.income_per_10k_assets !== ratioRows[index - 1].income_per_10k_assets) rank = index + 1;
      return { ...row, rank };
    });
    result.groups.push({
      ...financialMeasureDefinition(source),
      unit: "USD", stored_income_unit: "thousands of dollars", fee_price_unit: "USD",
      fee_price_basis: "current_published_categories_not_historical_prices",
      intensity_unit: "USD income per 10,000 USD assets",
      report_date: date,
      date_selection_basis: "newest_usable_matched_quarter",
      date_selection_definition: "Newest usable quarter among this source's institutions with matching eligible published fee schedules; not the latest filing date across the regulator's full population",
      institution_count: current.length,
      stale_institution_count: stale.length,
      stale_report_dates: [...new Set(stale.map((row) => row.report_date))].sort().reverse(),
      minimum_summary_count: MINIMUM_RESEARCH_SUMMARY_COUNT,
      population_basis: "fee_price_income_correlation",
      size_basis: "matched_filing_reported_assets",
      eligibility: {
        minimum_published_fee_categories: 3,
        definition: "Current active or unknown-status institutions with at least three distinct approved, sourced fee categories eligible under the consumer statistics rule (consumer, shared consumer/business, or unknown audience; business-only rows excluded) and computable canonical standalone-quarter income",
      },
      summary: summary(current),
      by_tier: [...tiers].sort(([a], [b]) => (FDIC_TIER_BREAKPOINTS[a]?.[0] ?? Infinity) - (FDIC_TIER_BREAKPOINTS[b]?.[0] ?? Infinity))
        .map(([asset_size_tier, members]) => ({ asset_size_tier, ...summary(members) })),
      institutions: current,
      rankings,
      limitations: [
        "Bank deposit service charges and NCUA broad member-service and membership fee income are different measures; no combined mean or ranking is established.",
        "The mean listed fee is an unweighted mean of each institution's category representatives: maximum overdraft price and median price for other categories. Price baskets differ; this is not a same-fee benchmark.",
        "Fee prices come from the current published category catalog, not historical fee-price snapshots. The reporting date identifies only the financial quarter; it does not establish prices in effect during that quarter.",
        "Income per 10,000 dollars of assets is a standalone-quarter intensity, not fee income as a share of revenue and not an annualized measure.",
        "Reported zero and negative quarterly income are retained as signed observations; missing income is excluded and missing or zero assets cannot supply an intensity.",
        "Summary means and intensity rankings require at least five distinct usable institutions; each ratio summary additionally needs five reported positive-asset denominators.",
        "The matched sample does not establish all-regulator coverage, constant-cohort growth, merger adjustment, causal correlation or that fee pricing caused income.",
      ],
    });
  }
  return result;
}

/** One uncached SQL read for consumers that need the full population. */
export async function getFeeRevenueResearch(): Promise<FeeRevenueResearch> {
  return buildFeeRevenueResearch(await getFeeRevenueData());
}

/** Keep full-population statistics, but avoid duplicating thousands of rows in Next's cache. */
export function previewFeeRevenueResearch(research: FeeRevenueResearch): FeeRevenueResearchPreview {
  return {
    ...research,
    groups: research.groups.map((group) => {
      const { institutions, rankings, ...metadata } = group;
      void institutions;
      return {
        ...metadata,
        rankings: rankings.slice(0, RESEARCH_RANKING_PREVIEW_LIMIT),
        ranking_preview: {
          limit: RESEARCH_RANKING_PREVIEW_LIMIT,
          total: rankings.length,
          complete: rankings.length <= RESEARCH_RANKING_PREVIEW_LIMIT,
        },
      };
    }),
  };
}

/** Cache only a bounded display projection, computed after the full cohort's statistics. */
export async function getFeeRevenueResearchPreview(): Promise<FeeRevenueResearchPreview> {
  return previewFeeRevenueResearch(await getFeeRevenueResearch());
}
