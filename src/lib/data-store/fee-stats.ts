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
 * 6. Consumer, both and unknown-audience rows count; business rows never do. Unknown
 *    counts as personal (James, 2026-10-12, #1058): 99.7% of live fees had no stated
 *    audience, and a consumer-only rule left national medians on about 60 institutions.
 *    Pages mark a figure an unknown row contributes to with an asterisk
 *    (UNSTATED_AUDIENCE_FOOTNOTE), and #1059 labels the rows. Business-only schedules
 *    don't count either: a fee read from a schedule whose address names
 *    business, commercial, corporate or treasury accounts (and no consumer word) is a
 *    business price, not the consumer's. It stays on the bank's own page and is left out
 *    of medians, ranges and comparisons until a consumer schedule replaces it. Same
 *    address test as Magellan's isBusinessOnlyLink (link-coverage.ts).
 * 7. Count once (James, 2026-10-15, #1441), behind COUNT_SHARED_SCHEDULE_ONCE: sibling
 *    charters that publish fees from the same schedule (the same document address, or
 *    stored documents with identical text) count as one institution in a group's median,
 *    percentiles and counts. Each charter keeps its own rows and its own value
 *    (valuePerInstitution is unchanged), so every charter's page still shows its fees.
 */
import { computePercentile, computeStats } from "./fees";
import { BUSINESS_PATH_SQL, CONSUMER_PATH_SQL } from "@/lib/agents/magellan/link-coverage";

import { MIN_INSTITUTIONS_FOR_MEDIAN, STRONG_INSTITUTION_COUNT, maturityTier, type MaturityTier } from "./maturity";

export { MIN_INSTITUTIONS_FOR_MEDIAN, STRONG_INSTITUTION_COUNT, maturityTier, type MaturityTier };
/**
 * Rule 7 switch. Off until the read's cost and the affected counts are checked on prod (#1441).
 * Readers select STATS_SCHEDULE_KEYS; while this is false it selects NULL and nothing changes.
 */
export const COUNT_SHARED_SCHEDULE_ONCE: boolean = false;

/** Bump when these rules change; fee_index_cache rows carry it and older ones are ignored. */
export const STATS_METHOD_VERSION = COUNT_SHARED_SCHEDULE_ONCE ? 8 : 7;

/** SQL predicate: the row's source address names a business-only schedule (rule 6). */
export function businessSourceSql(alias: string): string {
  const path = `lower(regexp_replace(COALESCE(${alias}.source_url, ''), '^https?://[^/]+', ''))`;
  return `(${path} ~ '${BUSINESS_PATH_SQL}' AND ${path} !~ '${CONSUMER_PATH_SQL}')`;
}

/** Shared audience/source boundary for dollar and rate catalogs. Alias is code, not input. */
export function statsRowFilter(alias = "ef"): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new Error("Invalid statistics table alias");
  return `${alias}.source_document_id IS NOT NULL AND ${alias}.fee_audience IN ('consumer', 'both', 'unknown') AND NOT ${businessSourceSql(alias)}`;
}

/** Compatibility predicate for readers using the conventional ef alias. */
export const STATS_ROW_FILTER = statsRowFilter();

/**
 * SQL expression (text[]) naming the schedule a catalog row was read from, for rule 7:
 * `u:` its document address (scheme, www., fragment and trailing slashes dropped, lower case)
 * and `t:` the text hash of its stored document text. Two charters sharing either key share a
 * schedule. Sibling charters each hold their own source_documents row (institution_id is
 * NOT NULL), so the document id alone never links them. With the switch off it is NULL.
 */
export function scheduleKeysSql(alias = "ef", enabled = COUNT_SHARED_SCHEDULE_ONCE): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new Error("Invalid statistics table alias");
  if (!enabled) return "NULL::text[]";
  const url = `lower(regexp_replace(regexp_replace(regexp_replace(${alias}.document_url, '^https?://(www\\.)?', '', 'i'), '#.*$', ''), '/+$', ''))`;
  const textHash = `(SELECT ast.text_hash FROM agent_source_texts ast
     WHERE ast.source_document_id = ${alias}.source_document_id AND ast.text_hash IS NOT NULL
     ORDER BY ast.id DESC LIMIT 1)`;
  return `array_remove(ARRAY[NULLIF('u:' || ${url}, 'u:'), 't:' || ${textHash}], NULL)`;
}

/** Select-list item for statistics readers using the ef alias: `... AS schedule_keys`. */
export const STATS_SCHEDULE_KEYS = `${scheduleKeysSql()} AS schedule_keys`;


export interface StatsInputRow {
  institution_id: number | string;
  amount: number | string | null;
  charter_type?: string | null;
  fee_category?: string | null;
  /** The schedule the row was read from (scheduleKeysSql); rows sharing a key share a schedule. */
  schedule_keys?: readonly string[] | null;
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
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return null;
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
    if (amount === null || !Number.isSafeInteger(id) || id <= 0) continue;
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

/**
 * Rule 7: within these rows, the institution each institution counts as. Institutions linked
 * by a shared schedule key (directly or through a chain) count as the lowest id among them;
 * an institution sharing nothing counts as itself. Rows with no keys link nothing.
 */
export function sharedScheduleRepresentatives(rows: StatsInputRow[]): Map<number, number> {
  const parent = new Map<number, number>();
  const find = (id: number): number => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root) as number;
    let node = id;
    while (node !== root) {
      const next = parent.get(node) as number;
      parent.set(node, root);
      node = next;
    }
    return root;
  };
  const ownerOfKey = new Map<string, number>();
  for (const row of rows) {
    const id = Number(row.institution_id);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    if (!parent.has(id)) parent.set(id, id);
    for (const key of row.schedule_keys ?? []) {
      if (!key) continue;
      const other = ownerOfKey.get(key);
      if (other === undefined) {
        ownerOfKey.set(key, id);
        continue;
      }
      const a = find(id);
      const b = find(other);
      if (a !== b) parent.set(Math.max(a, b), Math.min(a, b));
    }
  }
  const representatives = new Map<number, number>();
  for (const id of parent.keys()) representatives.set(id, find(id));
  return representatives;
}

/** Statistics for one group of rows (one category, or one category within a segment). */
export function summarizeFees(
  rows: StatsInputRow[],
  options: { countSharedScheduleOnce?: boolean } = {},
): FeeStatistics {
  // A missing/invalid price is not a sample. Keep displayed counts on the exact
  // population used for the median; a real numeric zero remains a valid observation.
  const validRows = rows.filter((row) => {
    const id = Number(row.institution_id);
    return Number.isSafeInteger(id) && id > 0 && toAmount(row.amount) !== null;
  });
  let values = valuePerInstitution(validRows);
  const charterOf = new Map<number, string | null | undefined>();
  for (const row of validRows) {
    const id = Number(row.institution_id);
    if (!charterOf.has(id)) charterOf.set(id, row.charter_type);
  }
  let institutions = charterOf;
  if (options.countSharedScheduleOnce ?? COUNT_SHARED_SCHEDULE_ONCE) {
    // Rule 7: each charter's own value first, then one value per shared schedule (the
    // median of its charters' values), counted under the lowest charter id.
    const representatives = sharedScheduleRepresentatives(validRows);
    const members = new Map<number, number[]>();
    for (const [id, value] of values) {
      const rep = representatives.get(id) ?? id;
      const list = members.get(rep);
      if (list) list.push(value);
      else members.set(rep, [value]);
    }
    values = new Map([...members].map(([rep, list]) => [rep, computePercentile([...list].sort((a, b) => a - b), 50)]));
    institutions = new Map([...members.keys()].map((rep) => [rep, charterOf.get(rep)]));
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
    observation_count: validRows.length,
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
