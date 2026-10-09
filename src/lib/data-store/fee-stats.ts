/**
 * The statistics contract for every fee median, percentile and count the product shows.
 *
 * 1. Only sourced rows count: a published row must trace back to a fetched source
 *    document. Unsourced legacy rows stay visible on institution pages but are hidden
 *    from statistics until they are re-sourced.
 * 2. One value per institution: an institution with several rows for a category
 *    contributes the median of its own amounts once, so a bank with five copies of a
 *    fee no longer counts five times. The lowest amount was rejected: tiered or
 *    mislabeled sub-fees pull it down (overdraft read $20 instead of $28). Overdraft
 *    counts the highest tier instead (James, 2026-10-05): a bank charging $5, $20 and
 *    $35 by overdrawn amount is compared at its standard $35 fee.
 * 3. $0 counts: a free fee is a real price and pulls the median down.
 * 4. Minimum sample: no median or percentile below MIN_INSTITUTIONS_FOR_MEDIAN
 *    institutions; "strong" needs STRONG_INSTITUTION_COUNT.
 * 5. Unknown charter types count as neither banks nor credit unions.
 * 6. Business-only schedules don't count: a fee read from a schedule whose address names
 *    business, commercial, corporate or treasury accounts (and no consumer word) is a
 *    business price, not the consumer's. It stays on the bank's own page and is left out
 *    of medians, ranges and comparisons until a consumer schedule replaces it. Same
 *    address test as Magellan's isBusinessOnlyLink (link-coverage.ts).
 */
import { computePercentile, computeStats } from "./fees";
import { BUSINESS_PATH_SQL, CONSUMER_PATH_SQL } from "@/lib/agents/magellan/link-coverage";

import { MIN_INSTITUTIONS_FOR_MEDIAN, STRONG_INSTITUTION_COUNT, maturityTier, type MaturityTier } from "./maturity";

export { MIN_INSTITUTIONS_FOR_MEDIAN, STRONG_INSTITUTION_COUNT, maturityTier, type MaturityTier };
/** Bump when these rules change; fee_index_cache rows carry it and older ones are ignored. */
export const STATS_METHOD_VERSION = 5;

/** SQL predicate: the row's source address names a business-only schedule (rule 6). */
export function businessSourceSql(alias: string): string {
  const path = `lower(regexp_replace(COALESCE(${alias}.source_url, ''), '^https?://[^/]+', ''))`;
  return `(${path} ~ '${BUSINESS_PATH_SQL}' AND ${path} !~ '${CONSUMER_PATH_SQL}')`;
}

/** SQL predicate on `published_fee_catalog ef` for rows that count toward statistics. */
export const STATS_ROW_FILTER = `ef.source_document_id IS NOT NULL AND ef.fee_audience IN ('consumer', 'both') AND NOT ${businessSourceSql("ef")}`;


export interface StatsInputRow {
  institution_id: number | string;
  amount: number | string | null;
  charter_type?: string | null;
  fee_category?: string | null;
}

/** Categories whose tiers are compared at the highest (standard) tier, not the median. */
export const HIGHEST_TIER_CATEGORIES: ReadonlySet<string> = new Set(["overdraft"]);

/** One institution's value for a category from its own amounts (sorted or not). */
export function institutionValue(category: string | null | undefined, amounts: number[]): number {
  const sorted = [...amounts].sort((a, b) => a - b);
  if (category && HIGHEST_TIER_CATEGORIES.has(category)) return sorted[sorted.length - 1];
  return computePercentile(sorted, 50);
}

export interface FeeStatistics {
  institution_count: number;
  observation_count: number;
  bank_count: number;
  cu_count: number;
  min_amount: number | null;
  max_amount: number | null;
  avg_amount: number | null;
  median_amount: number | null;
  p25_amount: number | null;
  p75_amount: number | null;
  maturity_tier: MaturityTier;
}


function toAmount(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Each institution's value: the median of its non-negative amounts (the highest for
 * HIGHEST_TIER_CATEGORIES, read from the rows' fee_category). Rows with no amount are skipped.
 */
export function valuePerInstitution(rows: StatsInputRow[]): Map<number, number> {
  const amounts = new Map<number, { category: string | null | undefined; list: number[] }>();
  for (const row of rows) {
    const amount = toAmount(row.amount);
    const id = Number(row.institution_id);
    if (amount === null || !Number.isFinite(id)) continue;
    const entry = amounts.get(id);
    if (entry) {
      entry.list.push(amount);
      if (entry.category !== row.fee_category) entry.category = null;
    } else amounts.set(id, { category: row.fee_category, list: [amount] });
  }
  const values = new Map<number, number>();
  for (const [id, { category, list }] of amounts) {
    values.set(id, institutionValue(category, list));
  }
  return values;
}

/** Statistics for one group of rows (one category, or one category within a segment). */
export function summarizeFees(rows: StatsInputRow[]): FeeStatistics {
  const values = valuePerInstitution(rows);
  const institutions = new Map<number, string | null | undefined>();
  for (const row of rows) {
    const id = Number(row.institution_id);
    if (Number.isFinite(id) && !institutions.has(id)) institutions.set(id, row.charter_type);
  }
  let bankCount = 0;
  let cuCount = 0;
  for (const charter of institutions.values()) {
    if (charter === "bank") bankCount++;
    else if (charter === "credit_union") cuCount++;
  }

  const institutionCount = institutions.size;
  const tier = maturityTier(values.size);
  const stats = tier === "insufficient" ? null : computeStats([...values.values()]);
  return {
    institution_count: institutionCount,
    observation_count: rows.length,
    bank_count: bankCount,
    cu_count: cuCount,
    min_amount: stats?.min ?? null,
    max_amount: stats?.max ?? null,
    avg_amount: stats?.avg ?? null,
    median_amount: stats?.median ?? null,
    p25_amount: stats?.p25 ?? null,
    p75_amount: stats?.p75 ?? null,
    maturity_tier: tier,
  };
}

/** Groups rows by a key (category, district, state…) and summarizes each group. */
export function summarizeFeesBy<T extends StatsInputRow>(
  rows: T[],
  keyOf: (row: T) => string | null | undefined,
): Map<string, FeeStatistics> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key === null || key === undefined) continue;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  const result = new Map<string, FeeStatistics>();
  for (const [key, group] of groups) result.set(key, summarizeFees(group));
  return result;
}

export interface InstitutionPosition {
  institution_id: number;
  fee_category: string;
  /** The institution's value for the category (median of its amounts). */
  value: number;
  p25: number;
  p75: number;
}

/**
 * Each institution's value per category alongside that category's p25/p75, for
 * "above p75 / below p25" style rankings. Categories below the minimum sample have
 * no percentiles under the contract and are left out.
 */
export function institutionPositions<T extends StatsInputRow & { fee_category: string }>(rows: T[]): InstitutionPosition[] {
  const byCategory = new Map<string, T[]>();
  for (const row of rows) {
    const group = byCategory.get(row.fee_category);
    if (group) group.push(row);
    else byCategory.set(row.fee_category, [row]);
  }
  const positions: InstitutionPosition[] = [];
  for (const [category, group] of byCategory) {
    const stats = summarizeFees(group);
    if (stats.p25_amount === null || stats.p75_amount === null) continue;
    for (const [institutionId, value] of valuePerInstitution(group)) {
      positions.push({ institution_id: institutionId, fee_category: category, value, p25: stats.p25_amount, p75: stats.p75_amount });
    }
  }
  return positions;
}

export interface RateStatsInputRow {
  institution_id: number | string;
  rate_percent: number | string | null;
  amount_kind?: string | null;
}

export interface RateStatistics {
  institution_count: number;
  median_rate: number | null;
  p25_rate: number | null;
  p75_rate: number | null;
  min_rate: number | null;
  max_rate: number | null;
  maturity_tier: MaturityTier;
}

/**
 * Statistics over percentage fees' rates (published_fee_rate_catalog), under the same
 * contract as dollars: sourced rows only (the caller's filter), one value per institution
 * (the median of its rates), and the same minimum sample. Rates are never pooled with
 * dollar amounts.
 */
export function summarizeRates(rows: RateStatsInputRow[]): RateStatistics {
  const rates = new Map<number, number[]>();
  for (const row of rows) {
    if (row.amount_kind != null && row.amount_kind !== "percent") continue;
    const rate = row.rate_percent == null ? NaN : Number(row.rate_percent);
    const id = Number(row.institution_id);
    if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(id)) continue;
    const list = rates.get(id);
    if (list) list.push(rate);
    else rates.set(id, [rate]);
  }
  const values = [...rates.values()].map((list) => computePercentile([...list].sort((a, b) => a - b), 50));
  const tier = maturityTier(values.length);
  const stats = tier === "insufficient" ? null : computeStats(values);
  return {
    institution_count: values.length,
    median_rate: stats?.median ?? null,
    p25_rate: stats?.p25 ?? null,
    p75_rate: stats?.p75 ?? null,
    min_rate: stats?.min ?? null,
    max_rate: stats?.max ?? null,
    maturity_tier: tier,
  };
}
