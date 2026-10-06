/**
 * National Quarterly Report — Data Assembler
 *
 * Queries live pipeline data and packages it into a typed NationalQuarterlyPayload.
 * No AI calls happen here — this is pure data assembly (per D-11).
 *
 * Key links:
 *   - getNationalIndex() / getPeerIndex() from fee-index.ts
 *   - getBeigeBookHeadlines() from fed.ts
 *   - DataManifest from report-engine/types.ts
 */

import { createHash } from "crypto";
import { getNationalIndex, getPeerFeeValues, getPeerIndex, getPeerIndexes, type IndexEntry } from "@/lib/data-store/fee-index";
import { DISTRICT_NAMES } from "@/lib/fed-districts";
import { STATE_NAMES, US_STATES_ONLY } from "@/lib/us-states";
import { priceBands } from "@/lib/hamilton/workspace/bands";
import { ASSET_TIER_RANGES } from "@/lib/hamilton/peer-index";
import { getRevenueTrend } from "@/lib/data-store/call-reports";
import { getPublicStatsSummary } from "@/lib/public-stats";
import { getBeigeBookHeadlines, getBeigeBookThemes, getFredSummary } from "@/lib/data-store/fed";
import type { BeigeBookTheme } from "@/lib/data-store/fed";
import { getDisplayName, FEE_TIERS } from "@/lib/fee-taxonomy";
import { getNationalRateStats } from "@/lib/data-store/rate-fees";
import { PERCENT_FEE_RANGES } from "@/lib/percent-fees";
import type { DataManifest } from "@/lib/report-engine/types";
import { loadDevelopments, loadFeeChanges, type DevelopmentsBlock, type FeeChangesBlock } from "./developments";
import type { ThesisSummaryPayload } from "@/lib/hamilton/types";

// ─── Payload Types ─────────────────────────────────────────────────────────────

export interface NationalQuarterlySection {
  fee_category: string;
  display_name: string;
  fee_family: string | null;
  median_amount: number | null;
  p25_amount: number | null;
  p75_amount: number | null;
  institution_count: number;
  observation_count: number;
  maturity_tier: "strong" | "provisional" | "insufficient";
  // Charter breakdown (NQR-03)
  bank_median: number | null;
  cu_median: number | null;
  bank_count: number;
  cu_count: number;
}

export interface DerivedAnalytics {
  // Ch1: Fee Differentiation analysis
  avg_iqr_spread_pct: number | null;
  /** Median across priced categories of (P75 - P25) / median, in percent; a few very wide fees do not pull it. */
  median_iqr_spread_pct: number | null;
  commoditized_count: number;
  total_priced_categories: number;
  tightest_spreads: Array<{ display_name: string; spread_pct: number; median: number }>;
  widest_spreads: Array<{ display_name: string; spread_pct: number; median: number }>;

  // Ch2: Bank vs CU comparison
  bank_higher_count: number;
  cu_higher_count: number;
  comparable_count: number;
  biggest_bank_premiums: Array<{ display_name: string; bank_median: number; cu_median: number; diff_pct: number }>;
  biggest_cu_premiums: Array<{ display_name: string; bank_median: number; cu_median: number; diff_pct: number }>;

  // Ch3: Revenue concentration
  revenue_per_institution: number | null;
  bank_revenue_share_pct: number | null;
  cu_revenue_share_pct: number | null;

  // General
  categories_with_data_count: number;
  strong_maturity_count: number;
  provisional_maturity_count: number;
}

/** Fees shown in every regional and size table, in this order. */
export const REGIONAL_FEES = ["overdraft", "nsf", "monthly_maintenance", "atm_non_network", "wire_domestic_outgoing"] as const;
/** A median is shown only when at least this many institutions publish the fee in the group. */
export const MIN_GROUP_INSTITUTIONS = 5;

export interface GroupFeeMedian {
  median: number | null;
  institutions: number;
}

export interface GroupRow {
  key: string;
  label: string;
  fees: Record<string, GroupFeeMedian>;
}

export interface IncomeQuarterRow {
  quarter: string;
  /** Thousands of dollars, as filed. */
  total: number;
  banks: number;
  credit_unions: number;
  institutions: number;
  yoy_change_pct: number | null;
}

/** A fee as institutions state it as a rate ("1% of the transaction"); never pooled with dollar amounts. */
export interface NationalRateSection {
  fee_category: string;
  display_name: string;
  institution_count: number;
  median_rate: number | null;
  p25_rate: number | null;
  p75_rate: number | null;
  maturity_tier: "strong" | "provisional" | "insufficient";
}

export interface NationalQuarterlyPayload {
  report_date: string;
  quarter: string;
  total_institutions: number;
  total_bank_institutions: number;
  total_cu_institutions: number;
  categories: NationalQuarterlySection[];
  /** Fees that may publish as a rate, by their rates; absent on older payloads. */
  rate_categories?: NationalRateSection[];
  revenue: {
    latest_quarter: string;
    total_service_charges: number;
    yoy_change_pct: number | null;
    total_institutions: number;
    bank_service_charges: number;
    cu_service_charges: number;
  } | null;
  fred: {
    fed_funds_rate: number | null;
    unemployment_rate: number | null;
    cpi_yoy_pct: number | null;
    consumer_sentiment: number | null;
    gdp_growth_yoy_pct: number | null;
    personal_savings_rate: number | null;
    bank_lending_standards: number | null;
    as_of: string;
  } | null;
  // Fed district context (NQR-04)
  district_headlines: Array<{
    district: number;
    headline: string;
    release_date: string;
  }>;
  // Beige Book structured themes (fee-relevant, filtered)
  beige_themes: Array<{
    district: number;
    district_name: string;
    theme_category: string;
    sentiment: string;
    summary: string;
    /** Beige Book release, YYYYMM, so an older release is never read as current. */
    release_code?: string;
  }>;
  // V3 derived analytics
  derived: DerivedAnalytics;
  /** Headline fee medians by Federal Reserve district, asset size and state. */
  regional: { districts: GroupRow[]; sizes: GroupRow[]; states: GroupRow[] };
  /** Service-charge income, newest quarter first (up to eight). */
  income_series: IncomeQuarterRow[];
  /** Every institution's overdraft fee, counted into price bands. */
  overdraft_distribution: { label: string; count: number }[];
  /** Federal agency releases in the last 90 days; null when the read failed. */
  developments?: DevelopmentsBlock | null;
  /** Confirmed fee price changes at the same banks in the last 90 days; null when the read failed. */
  fee_changes?: FeeChangesBlock | null;
  manifest: DataManifest;
}

// ─── Quarter Derivation ────────────────────────────────────────────────────────

const MAX_HEADLINE_CHARS = 500;

function deriveQuarter(date: Date): string {
  const month = date.getMonth(); // 0-indexed
  const year = date.getFullYear();
  if (month <= 2) return `Q1 ${year}`;
  if (month <= 5) return `Q2 ${year}`;
  if (month <= 8) return `Q3 ${year}`;
  return `Q4 ${year}`;
}

const REGIONAL_SIZE_TIERS = ["community_small", "community_mid", "community_large", "regional", "large_regional", "super_regional"];

/** One group's medians for the headline fees; a median needs MIN_GROUP_INSTITUTIONS publishers. */
export function groupRow(key: string, label: string, entries: IndexEntry[]): GroupRow {
  const byCategory = new Map(entries.map((e) => [e.fee_category, e]));
  const fees: Record<string, GroupFeeMedian> = {};
  for (const fee of REGIONAL_FEES) {
    const e = byCategory.get(fee);
    const institutions = e?.institution_count ?? 0;
    fees[fee] = {
      median: e && institutions >= MIN_GROUP_INSTITUTIONS ? e.median_amount : null,
      institutions,
    };
  }
  return { key, label, fees };
}

// ─── Assembler ─────────────────────────────────────────────────────────────────

export async function assembleNationalQuarterly(): Promise<NationalQuarterlyPayload> {
  const assembled_at = new Date().toISOString();
  const now = new Date();

  // Query 1: All non-rejected fees (national index)
  const nationalEntries = await getNationalIndex();
  const manifestEntries: DataManifest["queries"] = [
    { sql: "getNationalIndex()", row_count: nationalEntries.length, executed_at: assembled_at },
  ];

  // Query 2: Bank-only peer index for charter medians
  const bankEntries = await getPeerIndex({ charter_type: "bank" });
  manifestEntries.push({
    sql: "getPeerIndex({ charter_type: 'bank' })",
    row_count: bankEntries.length,
    executed_at: assembled_at,
  });

  // Query 3: Credit union-only peer index
  const cuEntries = await getPeerIndex({ charter_type: "credit_union" });
  manifestEntries.push({
    sql: "getPeerIndex({ charter_type: 'credit_union' })",
    row_count: cuEntries.length,
    executed_at: assembled_at,
  });

  // Query 4: Call Report revenue trend (graceful degradation)
  let revenue: NationalQuarterlyPayload["revenue"] = null;
  let income_series: IncomeQuarterRow[] = [];
  try {
    // Twelve quarters so each of the newest eight has its year-earlier quarter.
    const trend = await getRevenueTrend(12);
    income_series = trend.quarters.slice(0, 8).map((q) => ({
      quarter: q.quarter,
      total: q.total_service_charges,
      banks: q.bank_service_charges,
      credit_unions: q.cu_service_charges,
      institutions: q.total_institutions,
      yoy_change_pct: q.yoy_change_pct,
    }));
    if (trend.latest) {
      revenue = {
        latest_quarter: trend.latest.quarter,
        total_service_charges: trend.latest.total_service_charges,
        yoy_change_pct: trend.latest.yoy_change_pct,
        total_institutions: trend.latest.total_institutions,
        bank_service_charges: trend.latest.bank_service_charges,
        cu_service_charges: trend.latest.cu_service_charges,
      };
    }
    manifestEntries.push({
      sql: "getRevenueTrend(12)",
      row_count: trend.quarters.length,
      executed_at: assembled_at,
    });
  } catch (e) {
    console.warn("[assembler] Call Report query failed, skipping:", e);
    manifestEntries.push({
      sql: "getRevenueTrend(12)",
      row_count: 0,
      executed_at: assembled_at,
    });
  }

  // Query 5: FRED economic indicators (graceful degradation)
  let fred: NationalQuarterlyPayload["fred"] = null;
  try {
    const fredData = await getFredSummary();
    fred = {
      fed_funds_rate: fredData.fed_funds_rate,
      unemployment_rate: fredData.unemployment_rate,
      cpi_yoy_pct: fredData.cpi_yoy_pct,
      consumer_sentiment: fredData.consumer_sentiment,
      gdp_growth_yoy_pct: fredData.gdp_growth_yoy_pct,
      personal_savings_rate: fredData.personal_savings_rate,
      bank_lending_standards: fredData.bank_lending_standards,
      as_of: fredData.as_of,
    };
    manifestEntries.push({
      sql: "getFredSummary()",
      row_count: fred ? 1 : 0,
      executed_at: assembled_at,
    });
  } catch (e) {
    console.warn("[assembler] FRED query failed, skipping:", e);
    manifestEntries.push({
      sql: "getFredSummary()",
      row_count: 0,
      executed_at: assembled_at,
    });
  }

  // Query 6: Beige Book headlines for all districts (graceful degradation)
  let headlinesMap = new Map<number, { text: string; release_date: string }>();
  try {
    headlinesMap = await getBeigeBookHeadlines();
    manifestEntries.push({
      sql: "getBeigeBookHeadlines()",
      row_count: headlinesMap.size,
      executed_at: assembled_at,
    });
  } catch (e) {
    console.warn("[assembler] Beige Book query failed, skipping:", e);
    manifestEntries.push({
      sql: "getBeigeBookHeadlines()",
      row_count: 0,
      executed_at: assembled_at,
    });
  }

  // Query 7: Beige Book structured themes (graceful degradation, falls back to headlines)
  let beigeThemes: BeigeBookTheme[] = [];
  try {
    beigeThemes = await getBeigeBookThemes();
    manifestEntries.push({
      sql: "getBeigeBookThemes()",
      row_count: beigeThemes.length,
      executed_at: assembled_at,
    });
  } catch (e) {
    console.warn("[assembler] BeigeBookThemes query failed, skipping:", e);
    manifestEntries.push({
      sql: "getBeigeBookThemes()",
      row_count: 0,
      executed_at: assembled_at,
    });
  }

  // Filter for fee-relevant themes per D-03: lending_conditions + prices categories,
  // prefer negative/mixed sentiment for "tension" narrative framing
  const feeRelevantThemes = beigeThemes
    .filter(t => ['lending_conditions', 'prices'].includes(t.theme_category))
    .filter(t => ['negative', 'mixed'].includes(t.sentiment))
    .slice(0, 3);

  // If no structured themes, we still have district_headlines from Query 6 as fallback

  // Build lookup maps by fee_category for O(1) charter lookups
  const bankByCategory = new Map(bankEntries.map((e) => [e.fee_category, e]));
  const cuByCategory = new Map(cuEntries.map((e) => [e.fee_category, e]));

  // Build categories array — only taxonomy categories, not raw uncategorized fee names
  const taxonomyEntries = nationalEntries.filter((e) => e.fee_category in FEE_TIERS);
  const categories: NationalQuarterlySection[] = taxonomyEntries.map((entry) => {
    const bankEntry = bankByCategory.get(entry.fee_category);
    const cuEntry = cuByCategory.get(entry.fee_category);

    return {
      fee_category: entry.fee_category,
      display_name: getDisplayName(entry.fee_category),
      fee_family: entry.fee_family,
      median_amount: entry.median_amount,
      p25_amount: entry.p25_amount,
      p75_amount: entry.p75_amount,
      institution_count: entry.institution_count,
      observation_count: entry.observation_count,
      maturity_tier: entry.maturity_tier,
      bank_median: bankEntry?.median_amount ?? null,
      cu_median: cuEntry?.median_amount ?? null,
      bank_count: bankEntry?.institution_count ?? 0,
      cu_count: cuEntry?.institution_count ?? 0,
    };
  });

  // Build district_headlines — only districts that have a headline, trimmed to 500 chars
  const district_headlines: NationalQuarterlyPayload["district_headlines"] = [];
  for (const [district, headline] of headlinesMap.entries()) {
    district_headlines.push({
      district,
      headline: headline.text.slice(0, MAX_HEADLINE_CHARS),
      release_date: headline.release_date,
    });
  }
  district_headlines.sort((a, b) => a.district - b.district);

  // Compute charter institution totals from charter-filtered index
  const bankInstitutionSet = new Set(bankEntries.map((e) => e.institution_count));
  const cuInstitutionSet = new Set(cuEntries.map((e) => e.institution_count));
  const total_bank_institutions = bankEntries.reduce((max, e) => Math.max(max, e.institution_count), 0);
  const total_cu_institutions = cuEntries.reduce((max, e) => Math.max(max, e.institution_count), 0);

  // total_institutions: the site's own count of institutions with published fees, so the
  // report and every public page state one number. The largest single category's count
  // (the old rule) understated coverage by a fifth.
  const largestCategory = nationalEntries.reduce((max, e) => Math.max(max, e.institution_count), 0);
  let total_institutions = largestCategory;
  try {
    const summary = await getPublicStatsSummary();
    if (summary.institutions > 0) total_institutions = summary.institutions;
  } catch (err) {
    console.warn("[assembleNationalQuarterly] public stats summary failed, using largest category count:", err);
  }

  // Suppress unused variable warnings
  void bankInstitutionSet;
  void cuInstitutionSet;

  // ── V3 Derived Analytics ──────────────────────────────────────────────────
  const spreads = categories
    .filter((c) => c.median_amount !== null && c.median_amount > 0.5 && c.p25_amount !== null && c.p75_amount !== null)
    .map((c) => ({
      display_name: c.display_name,
      spread_pct: ((c.p75_amount! - c.p25_amount!) / c.median_amount!) * 100,
      median: c.median_amount!,
    }));

  const sortedBySpreadAsc = [...spreads].sort((a, b) => a.spread_pct - b.spread_pct);
  const sortedBySpreadDesc = [...spreads].sort((a, b) => b.spread_pct - a.spread_pct);

  const commoditized_count = spreads.filter((s) => s.spread_pct < 30).length;
  const avg_iqr_spread_pct = spreads.length > 0
    ? spreads.reduce((sum, s) => sum + s.spread_pct, 0) / spreads.length
    : null;
  const median_iqr_spread_pct = sortedBySpreadAsc.length > 0
    ? (sortedBySpreadAsc[Math.floor((sortedBySpreadAsc.length - 1) / 2)].spread_pct + sortedBySpreadAsc[Math.ceil((sortedBySpreadAsc.length - 1) / 2)].spread_pct) / 2
    : null;

  // Bank vs CU comparison
  const comparableCategories = categories.filter(
    (c) => c.bank_count > 0 && c.cu_count > 0 && c.bank_median !== null && c.cu_median !== null
  );
  const bank_higher_count = comparableCategories.filter((c) => c.bank_median! > c.cu_median!).length;
  const cu_higher_count = comparableCategories.filter((c) => c.cu_median! > c.bank_median!).length;

  const bankPremiums = comparableCategories
    .filter((c) => c.cu_median! > 0)
    .map((c) => ({
      display_name: c.display_name,
      bank_median: c.bank_median!,
      cu_median: c.cu_median!,
      diff_pct: ((c.bank_median! - c.cu_median!) / c.cu_median!) * 100,
    }));

  const sortedBankPremium = [...bankPremiums].sort((a, b) => b.diff_pct - a.diff_pct);
  const sortedCuPremium = [...bankPremiums].sort((a, b) => a.diff_pct - b.diff_pct);

  // Revenue concentration
  let revenue_per_institution: number | null = null;
  let bank_revenue_share_pct: number | null = null;
  let cu_revenue_share_pct: number | null = null;
  if (revenue && revenue.total_service_charges > 0) {
    // Filed in thousands; per institution in dollars, for one quarter.
    revenue_per_institution = revenue.total_institutions > 0
      ? (revenue.total_service_charges * 1000) / revenue.total_institutions
      : null;
    bank_revenue_share_pct = (revenue.bank_service_charges / revenue.total_service_charges) * 100;
    cu_revenue_share_pct = (revenue.cu_service_charges / revenue.total_service_charges) * 100;
  }

  // Maturity counts
  const strong_maturity_count = categories.filter((c) => c.maturity_tier === "strong").length;
  const provisional_maturity_count = categories.filter((c) => c.maturity_tier === "provisional").length;

  const derived: DerivedAnalytics = {
    avg_iqr_spread_pct,
    median_iqr_spread_pct,
    commoditized_count,
    total_priced_categories: spreads.length,
    tightest_spreads: sortedBySpreadAsc.slice(0, 5),
    widest_spreads: sortedBySpreadDesc.slice(0, 5),
    bank_higher_count,
    cu_higher_count,
    comparable_count: comparableCategories.length,
    biggest_bank_premiums: sortedBankPremium.filter((p) => p.diff_pct > 0).slice(0, 5),
    biggest_cu_premiums: sortedCuPremium.filter((p) => p.diff_pct < 0).slice(0, 5).map((p) => ({
      ...p,
      diff_pct: Math.abs(p.diff_pct),
    })),
    revenue_per_institution,
    bank_revenue_share_pct,
    cu_revenue_share_pct,
    categories_with_data_count: categories.filter((c) => c.median_amount !== null).length,
    strong_maturity_count,
    provisional_maturity_count,
  };

  // Query 8: headline fees by district, asset size and state, from one read of the catalog
  let regional: NationalQuarterlyPayload["regional"] = { districts: [], sizes: [], states: [] };
  let overdraft_distribution: NationalQuarterlyPayload["overdraft_distribution"] = [];
  try {
    const districtSets = Object.keys(DISTRICT_NAMES).map((d) => ({
      key: d,
      label: `${d} ${DISTRICT_NAMES[Number(d)]}`,
      filters: { fed_districts: [Number(d)] },
    }));
    const sizeSets = REGIONAL_SIZE_TIERS.map((tier) => ({
      key: tier,
      label: ASSET_TIER_RANGES[tier] ?? tier,
      filters: { asset_tiers: [tier] },
    }));
    const stateSets = [...US_STATES_ONLY].sort().map((code) => ({
      key: code,
      label: STATE_NAMES[code] ?? code,
      filters: { state_code: code },
    }));
    const all = [...districtSets, ...sizeSets, ...stateSets];
    const indexes = await getPeerIndexes(all.map((g) => g.filters));
    const rows = all.map((g, i) => groupRow(g.key, g.label, indexes[i] ?? []));
    regional = {
      districts: rows.slice(0, districtSets.length),
      sizes: rows.slice(districtSets.length, districtSets.length + sizeSets.length),
      states: rows.slice(districtSets.length + sizeSets.length),
    };
    const [values] = await getPeerFeeValues([{}], ["overdraft"]);
    overdraft_distribution = priceBands((values?.get("overdraft") ?? []).map((v) => v.amount), null)
      .filter((b) => b.count > 0)
      .map((b) => ({ label: b.label, count: b.count }));
    manifestEntries.push({
      sql: `getPeerIndexes(${all.length} district, size and state groups); getPeerFeeValues(national, overdraft)`,
      row_count: all.length,
      executed_at: assembled_at,
    });
  } catch (e) {
    console.warn("[assembler] regional index query failed, skipping:", e);
  }

  // Query 9: agency releases and confirmed fee changes, last 90 days
  let developments: DevelopmentsBlock | null = null;
  let fee_changes: FeeChangesBlock | null = null;
  try {
    developments = await loadDevelopments(now);
    manifestEntries.push({ sql: "reg_articles, last 90 days", row_count: developments.items.length, executed_at: assembled_at });
  } catch (e) {
    console.error("[assembler] agency release read failed; the section says so:", e);
  }
  try {
    fee_changes = await loadFeeChanges(now);
    manifestEntries.push({ sql: "fee_change_records, last 90 days, confirmed against schedules", row_count: fee_changes.changes.length, executed_at: assembled_at });
  } catch (e) {
    console.error("[assembler] fee change read failed; the section says so:", e);
  }

  // Query 10: fees stated as a rate, each on its own (published_fee_rate_catalog)
  let rate_categories: NationalRateSection[] = [];
  try {
    rate_categories = await Promise.all(
      Object.keys(PERCENT_FEE_RANGES).map(async (fee_category) => {
        const stats = await getNationalRateStats(fee_category);
        return {
          fee_category,
          display_name: getDisplayName(fee_category),
          institution_count: stats.institution_count,
          median_rate: stats.median_rate,
          p25_rate: stats.p25_rate,
          p75_rate: stats.p75_rate,
          maturity_tier: stats.maturity_tier,
        };
      }),
    );
    manifestEntries.push({
      sql: "published_fee_rate_catalog, national rates by category",
      row_count: rate_categories.reduce((sum, r) => sum + r.institution_count, 0),
      executed_at: assembled_at,
    });
  } catch (e) {
    console.error("[assembler] rate fee read failed; the report leaves rates out:", e);
  }

  // Compute data_hash over assembled payload content
  const data_hash = createHash("sha256")
    .update(JSON.stringify({ categories, rate_categories, district_headlines, beige_themes: feeRelevantThemes, revenue, fred, derived, regional, income_series, overdraft_distribution, developments, fee_changes }))
    .digest("hex");

  const pipeline_commit = process.env.VERCEL_GIT_COMMIT_SHA ?? "local";

  return {
    report_date: now.toISOString().slice(0, 10),
    quarter: deriveQuarter(now),
    total_institutions,
    total_bank_institutions,
    total_cu_institutions,
    categories,
    rate_categories,
    revenue,
    fred,
    district_headlines,
    beige_themes: feeRelevantThemes.map(t => ({
      district: t.fed_district,
      district_name: t.district_name,
      theme_category: t.theme_category,
      sentiment: t.sentiment,
      summary: t.summary,
      release_code: t.release_code,
    })),
    derived,
    regional,
    income_series,
    overdraft_distribution,
    developments,
    fee_changes,
    manifest: {
      queries: manifestEntries,
      data_hash,
      pipeline_commit,
    },
  };
}

// ─── Thesis Summary Builder (Phase 33, D-02) ──────────────────────────────────

/**
 * Condense a full NationalQuarterlyPayload into a ~5KB ThesisSummaryPayload
 * suitable for thesis generation. Pure function — no DB or API calls.
 *
 * Per D-01: thesis generator receives condensed summary, not full payload.
 */
export function buildThesisSummary(
  payload: NationalQuarterlyPayload,
): ThesisSummaryPayload {
  const top_categories = [...payload.categories]
    .sort((a, b) => b.institution_count - a.institution_count)
    .slice(0, 10)
    .map((c) => ({
      fee_category: c.fee_category,
      display_name: c.display_name,
      median_amount: c.median_amount,
      bank_median: c.bank_median,
      cu_median: c.cu_median,
      institution_count: c.institution_count,
      maturity_tier: c.maturity_tier,
    }));

  const revenue_snapshot = payload.revenue
    ? {
        latest_quarter: payload.revenue.latest_quarter,
        total_service_charges: payload.revenue.total_service_charges,
        yoy_change_pct: payload.revenue.yoy_change_pct,
        bank_service_charges: payload.revenue.bank_service_charges,
        cu_service_charges: payload.revenue.cu_service_charges,
        total_institutions: payload.revenue.total_institutions,
      }
    : null;

  const fred_snapshot = payload.fred
    ? {
        fed_funds_rate: payload.fred.fed_funds_rate,
        unemployment_rate: payload.fred.unemployment_rate,
        cpi_yoy_pct: payload.fred.cpi_yoy_pct,
        consumer_sentiment: payload.fred.consumer_sentiment,
        as_of: payload.fred.as_of,
      }
    : null;

  const beige_book_themes = payload.district_headlines.map((h) => h.headline);

  const derived_tensions: string[] = [];
  const {
    bank_higher_count,
    cu_higher_count,
    commoditized_count,
    total_priced_categories,
    avg_iqr_spread_pct,
    revenue_per_institution,
  } = payload.derived;

  if (bank_higher_count + cu_higher_count > 0) {
    derived_tensions.push(
      `Banks charge more than credit unions in ${bank_higher_count} of ${bank_higher_count + cu_higher_count} comparable categories`,
    );
  }
  if (avg_iqr_spread_pct !== null) {
    derived_tensions.push(
      `${commoditized_count} of ${total_priced_categories} fee categories have a middle half narrower than 30% of the median`,
    );
  }
  if (revenue_per_institution !== null) {
    derived_tensions.push(
      `Average service-charge income per reporting institution: $${Math.round(revenue_per_institution).toLocaleString()} in ${payload.revenue?.latest_quarter ?? "the latest quarter"}`,
    );
  }

  return {
    quarter: payload.quarter,
    total_institutions: payload.total_institutions,
    top_categories,
    revenue_snapshot,
    fred_snapshot,
    beige_book_themes,
    derived_tensions,
  };
}
