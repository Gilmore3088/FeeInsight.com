/**
 * The statistics contract for every fee median, percentile and count the product shows.
 *
 * 1. Only sourced rows count: a published row must trace back to a fetched source
 *    document. Unsourced legacy rows stay visible on institution pages but are hidden
 *    from statistics until they are re-sourced.
 * 2. One value per institution: an institution with several rows for a category
 *    contributes the median of its own amounts once, so a bank with five copies of a
 *    fee no longer counts five times. The lowest amount was rejected: tiered or
 *    mislabeled sub-fees pull it down (overdraft read $20 instead of $28).
 * 3. $0 counts: a free fee is a real price and pulls the median down.
 * 4. Minimum sample: no median or percentile below MIN_INSTITUTIONS_FOR_MEDIAN
 *    institutions; "strong" needs STRONG_INSTITUTION_COUNT.
 * 5. Unknown charter types count as neither banks nor credit unions.
 */
import { computePercentile, computeStats } from "./fees";

export const MIN_INSTITUTIONS_FOR_MEDIAN = 5;
export const STRONG_INSTITUTION_COUNT = 20;
/** Bump when these rules change; fee_index_cache rows carry it and older ones are ignored. */
export const STATS_METHOD_VERSION = 2;

/** SQL predicate on `published_fee_catalog ef` for rows that count toward statistics. */
export const STATS_ROW_FILTER = "ef.source_document_id IS NOT NULL";

export type MaturityTier = "strong" | "provisional" | "insufficient";

export interface StatsInputRow {
  institution_id: number | string;
  amount: number | string | null;
  charter_type?: string | null;
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

export function maturityTier(institutionCount: number): MaturityTier {
  if (institutionCount >= STRONG_INSTITUTION_COUNT) return "strong";
  if (institutionCount >= MIN_INSTITUTIONS_FOR_MEDIAN) return "provisional";
  return "insufficient";
}

function toAmount(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Each institution's value: the median of its non-negative amounts. Rows with no amount are skipped. */
export function valuePerInstitution(rows: StatsInputRow[]): Map<number, number> {
  const amounts = new Map<number, number[]>();
  for (const row of rows) {
    const amount = toAmount(row.amount);
    const id = Number(row.institution_id);
    if (amount === null || !Number.isFinite(id)) continue;
    const list = amounts.get(id);
    if (list) list.push(amount);
    else amounts.set(id, [amount]);
  }
  const values = new Map<number, number>();
  for (const [id, list] of amounts) {
    values.set(id, computePercentile(list.sort((a, b) => a - b), 50));
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
