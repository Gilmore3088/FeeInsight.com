import { sql } from "./connection";
import { COUNT_SHARED_SCHEDULE_ONCE, STATS_ROW_FILTER, STATS_SCHEDULE_KEYS, summarizeFeesBy, valuePerInstitution, type StatsInputRow } from "./fee-stats";
import { consumerPriceMoveSql } from "./consumer-price-moves";
import type { FeeReview } from "./types";
import { institutionDisplayName } from "@/lib/institution-display-name";
import { readerFeeConditions } from "../fee-conditions";

export interface FeeCategorySummary {
  fee_category: string;
  institution_count: number;
  total_observations: number;
  min_amount: number | null;
  max_amount: number | null;
  avg_amount: number | null;
  median_amount: number | null;
  p25_amount: number | null;
  p75_amount: number | null;
  bank_count: number;
  cu_count: number;
  /** Institutions publishing this fee at $0 without a paid tier. Consumer guides cite it directly. */
  zero_count: number;
  /** Median among banks only; null below the minimum sample. */
  bank_median_amount: number | null;
  /** Median among credit unions only; null below the minimum sample. */
  cu_median_amount: number | null;
  /**
   * Institutions in this benchmark with at least one row whose audience the schedule does
   * not state (counted as personal, #1058). Above zero, pages mark the figure with an asterisk.
   * Optional: a snapshot cached before this field existed reads as no asterisk.
   */
  unstated_audience_institution_count?: number;
}

export interface FeeInstance {
  id: number;
  institution_name: string;
  institution_id: number;
  amount: number | null;
  frequency: string | null;
  conditions: string | null;
  charter_type: string;
  state_code: string | null;
  asset_size_tier: string | null;
  asset_size: number | null;
  review_status: string;
  extraction_confidence: number;
  canonical_fee_key: string | null;
  variant_type: string | null;
  /** The fee's name as the bank's schedule words it. */
  fee_name?: string | null;
  /** The bank document the fee was read from; null for unsourced legacy rows. */
  document_url?: string | null;
  source_document_id?: number | null;
  /** Statistics rule 7 (fee-stats.ts): the row's schedule keys and holding company. */
  schedule_keys?: string[] | null;
  schedule_group?: string | null;
}

/** A fee row without statistics rule 7's schedule fields (see getFeeCategoryDetail). */
export function withoutScheduleFields(fee: FeeInstance): FeeInstance {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { schedule_keys, schedule_group, ...rest } = fee;
  return rest;
}

export interface DimensionBreakdown {
  dimension_value: string;
  count: number;
  min_amount: number | null;
  max_amount: number | null;
  avg_amount: number | null;
  median_amount: number | null;
  /** The middle half of institution values (25th to 75th percentile); absent on older callers. */
  p25_amount?: number | null;
  p75_amount?: number | null;
}

export interface FeeChangeEvent {
  institution_name: string;
  previous_amount: number | null;
  new_amount: number | null;
  change_type: string;
  detected_at: string;
}

export function computePercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  // Coerce defensively: NUMERIC values that reach here as strings would otherwise
  // concatenate ("10.00" + 5 = "10.005") instead of interpolating.
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const loValue = Number(sorted[lo]);
  if (lo === hi) return loValue;
  return loValue + (idx - lo) * (Number(sorted[hi]) - loValue);
}

export function computeStats(amounts: number[]): {
  min: number | null;
  max: number | null;
  avg: number | null;
  median: number | null;
  p25: number | null;
  p75: number | null;
} {
  const sorted = amounts.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) {
    return { min: null, max: null, avg: null, median: null, p25: null, p75: null };
  }
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: Math.round((sorted.reduce((s, v) => s + v, 0) / sorted.length) * 100) / 100,
    median: Math.round(computePercentile(sorted, 50) * 100) / 100,
    p25: Math.round(computePercentile(sorted, 25) * 100) / 100,
    p75: Math.round(computePercentile(sorted, 75) * 100) / 100,
  };
}

export async function getFeeCategorySummaries(): Promise<FeeCategorySummary[]> {
  const rows = await sql`
    SELECT ef.fee_category, ef.amount, ef.institution_id, ct.charter_type, ef.fee_audience,
           ${sql.unsafe(STATS_SCHEDULE_KEYS)}
    FROM published_fee_catalog ef
    JOIN institution_sources ct ON ef.institution_id = ct.id
    WHERE ef.fee_category IS NOT NULL
      AND ef.review_status = 'approved'
      AND ${sql.unsafe(STATS_ROW_FILTER)}
      AND ef.amount IS NOT NULL AND ef.amount >= 0
  ` as {
    fee_category: string;
    amount: number | null;
    institution_id: number;
    charter_type: string;
    fee_audience?: string | null;
    schedule_keys?: string[] | null;
    schedule_group?: string | null;
  }[];

  // "Charge nothing" is stronger than "has a free tier": every usable price for
  // that institution/category must be zero. Missing or invalid prices add no sample.
  const zeroInstitutions = new Map<string, Set<number>>();
  const paidInstitutions = new Map<string, Set<number>>();
  for (const row of rows) {
    if (row.amount === null || (typeof row.amount === "string" && String(row.amount).trim() === "")) continue;
    const amount = Number(row.amount);
    const id = Number(row.institution_id);
    if (!Number.isSafeInteger(id) || id <= 0 || !Number.isFinite(amount) || amount < 0) continue;
    const groups = amount === 0 ? zeroInstitutions : paidInstitutions;
    const set = groups.get(row.fee_category) ?? new Set<number>();
    set.add(id);
    groups.set(row.fee_category, set);
  }
  for (const [category, paid] of paidInstitutions) {
    for (const id of paid) zeroInstitutions.get(category)?.delete(id);
  }

  // Institutions whose value rests on at least one row with no stated audience.
  const unstatedInstitutions = new Map<string, Set<number>>();
  for (const row of rows) {
    if (row.fee_audience != null && row.fee_audience !== "unknown") continue;
    const set = unstatedInstitutions.get(row.fee_category) ?? new Set<number>();
    set.add(Number(row.institution_id));
    unstatedInstitutions.set(row.fee_category, set);
  }

  // Same rows, split by charter: no extra query for the bank vs credit union medians.
  const byCharter = summarizeFeesBy(rows, (row) =>
    row.charter_type === "bank" || row.charter_type === "credit_union" ? `${row.fee_category}|${row.charter_type}` : null,
  );

  const results: FeeCategorySummary[] = [];
  for (const [category, stats] of summarizeFeesBy(rows, (row) => row.fee_category)) {
    results.push({
      fee_category: category,
      institution_count: stats.institution_count,
      total_observations: stats.observation_count,
      bank_count: stats.bank_count,
      cu_count: stats.cu_count,
      min_amount: stats.min_amount,
      max_amount: stats.max_amount,
      avg_amount: stats.avg_amount,
      median_amount: stats.median_amount,
      p25_amount: stats.p25_amount,
      p75_amount: stats.p75_amount,
      zero_count: zeroInstitutions.get(category)?.size ?? 0,
      bank_median_amount: byCharter.get(`${category}|bank`)?.median_amount ?? null,
      cu_median_amount: byCharter.get(`${category}|credit_union`)?.median_amount ?? null,
      unstated_audience_institution_count: unstatedInstitutions.get(category)?.size ?? 0,
    });
  }

  results.sort((a, b) => b.institution_count - a.institution_count);
  return results;
}

export interface FeeExtreme {
  id: number;
  institution_id: number;
  institution_name: string;
  amount: number;
}

/**
 * The cheapest and most expensive institutions for one fee category.
 *
 * The guide sidebar needs ten names. Fetching every row for the category to take two
 * five-row slices is the wrong shape for that, so this bounds the work in Postgres.
 */
export async function getCheapestAndMostExpensive(
  category: string,
  limit = 5,
): Promise<{ cheapest: FeeExtreme[]; mostExpensive: FeeExtreme[] }> {
  const bounded = Math.max(1, Math.min(25, Math.trunc(limit)));

  const [cheapestRows, expensiveRows] = await Promise.all([
    sql`
      WITH per_institution AS (
        SELECT MIN(ef.id) AS id, ef.institution_id, ct.institution_name,
               CASE WHEN ${category} = 'overdraft' THEN MAX(ef.amount)
                    ELSE PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ef.amount) END AS amount
        FROM published_fee_catalog ef
        JOIN institution_sources ct ON ef.institution_id = ct.id
        WHERE ef.fee_category = ${category}
          AND ef.review_status = 'approved'
          AND ef.amount IS NOT NULL
          AND ef.amount >= 0
          AND ${sql.unsafe(STATS_ROW_FILTER)}
        GROUP BY ef.institution_id, ct.institution_name
      )
      SELECT id, institution_id, institution_name, amount
      FROM per_institution
      ORDER BY amount ASC, institution_name ASC
      LIMIT ${bounded}
    `,
    sql`
      WITH per_institution AS (
        SELECT MIN(ef.id) AS id, ef.institution_id, ct.institution_name,
               CASE WHEN ${category} = 'overdraft' THEN MAX(ef.amount)
                    ELSE PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ef.amount) END AS amount
        FROM published_fee_catalog ef
        JOIN institution_sources ct ON ef.institution_id = ct.id
        WHERE ef.fee_category = ${category}
          AND ef.review_status = 'approved'
          AND ef.amount IS NOT NULL
          AND ef.amount >= 0
          AND ${sql.unsafe(STATS_ROW_FILTER)}
        GROUP BY ef.institution_id, ct.institution_name
      )
      SELECT id, institution_id, institution_name, amount
      FROM per_institution
      ORDER BY amount DESC, institution_name ASC
      LIMIT ${bounded}
    `,
  ]);

  const normalize = (rows: unknown[]): FeeExtreme[] =>
    (rows as FeeExtreme[]).map((r) => ({
      id: Number(r.id),
      institution_id: Number(r.institution_id),
      institution_name: institutionDisplayName(r.institution_name),
      amount: Number(r.amount),
    }));

  return {
    cheapest: normalize(cheapestRows),
    mostExpensive: normalize(expensiveRows),
  };
}

export interface InstitutionPoint {
  value: number;
  fed_district: number | null;
  charter_type: string | null;
  state_code: string | null;
  asset_size_tier: string | null;
}

export async function getFeeCategoryDetail(category: string): Promise<{
  fees: FeeInstance[];
  by_charter_type: DimensionBreakdown[];
  by_asset_tier: DimensionBreakdown[];
  by_fed_district: DimensionBreakdown[];
  by_state: DimensionBreakdown[];
  change_events: FeeChangeEvent[];
  /**
   * One value per institution (sourced rows only): the same population and per-institution
   * rule as the national median, so the distribution chart and the median agree.
   */
  institution_values: number[];
  /**
   * The same one value per institution, with the market it sits in, so a page can redraw
   * the distribution for one district, charter, size group or state.
   */
  institution_points: InstitutionPoint[];
}> {
  const rawFees = await sql`
    SELECT ef.id, ct.institution_name, ef.institution_id,
           ef.amount, ef.frequency, ef.conditions,
           ct.charter_type, ct.state_code, ct.asset_size_tier,
           ct.asset_size, ef.review_status, ef.extraction_confidence,
           ef.canonical_fee_key, ef.variant_type, ef.source_document_id,
           ef.fee_name, COALESCE(ef.document_url, ef.source_url) AS document_url,
           ct.fed_district, ${sql.unsafe(STATS_SCHEDULE_KEYS)}
    FROM published_fee_catalog ef
    JOIN institution_sources ct ON ef.institution_id = ct.id
    WHERE ef.fee_category = ${category} AND ef.review_status = 'approved'
      AND ${sql.unsafe(STATS_ROW_FILTER)}
      AND ef.amount IS NOT NULL AND ef.amount >= 0
    ORDER BY ef.amount DESC NULLS LAST
  ` as (Omit<FeeInstance, "source_document_id"> & {
    source_document_id: number | string | null;
    fed_district: number | null;
  })[];

  // Normalize numeric fields (Postgres NUMERIC returns strings)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const fees: FeeInstance[] = rawFees.map(({ fed_district, ...f }) => ({
    ...f,
    id: Number(f.id),
    institution_id: Number(f.institution_id),
    amount: f.amount !== null ? Number(f.amount) : null,
    conditions: readerFeeConditions(f.conditions),
    asset_size: f.asset_size !== null && f.asset_size !== undefined ? Number(f.asset_size) : null,
    extraction_confidence: Number(f.extraction_confidence ?? 0),
    source_document_id: f.source_document_id !== null ? Number(f.source_document_id) : null,
  }));

  // Breakdowns follow the statistics contract: sourced rows only, one value per institution.
  const sourcedFees = fees
    .filter((_, index) => rawFees[index].source_document_id !== null)
    .map((fee) => ({ ...fee, fee_category: category }));

  function buildBreakdown<T extends StatsInputRow>(
    rows: T[],
    dimFn: (row: T) => string | null
  ): DimensionBreakdown[] {
    const result: DimensionBreakdown[] = [];
    for (const [value, stats] of summarizeFeesBy(rows, (row) => dimFn(row) ?? "Unknown")) {
      result.push({
        dimension_value: value,
        count: stats.institution_count,
        min_amount: stats.min_amount,
        max_amount: stats.max_amount,
        avg_amount: stats.avg_amount,
        median_amount: stats.median_amount,
        p25_amount: stats.p25_amount,
        p75_amount: stats.p75_amount,
      });
    }
    return result.sort((a, b) => b.count - a.count);
  }

  const by_charter_type = buildBreakdown(sourcedFees, (f) =>
    f.charter_type === "bank" ? "Bank" : f.charter_type === "credit_union" ? "Credit Union" : null
  );
  const by_asset_tier = buildBreakdown(sourcedFees, (f) => f.asset_size_tier);

  // The district rows come from the same read rather than a second pass over the catalog
  // (229 ms a call, 13,000 calls Oct 5-9); same rows and fields as that query returned.
  const districtRows = rawFees
    .filter((f) => f.source_document_id !== null && f.fed_district !== null)
    .map((f) => ({
      fed_district: f.fed_district as number,
      amount: f.amount,
      institution_id: f.institution_id,
      schedule_keys: f.schedule_keys,
      schedule_group: f.schedule_group,
    }));

  const by_fed_district_real = buildBreakdown(districtRows.map((row) => ({ ...row, fee_category: category })), (row) => `District ${Number(row.fed_district)}`);
  by_fed_district_real.sort((a, b) => {
    const numA = parseInt(a.dimension_value.replace("District ", ""));
    const numB = parseInt(b.dimension_value.replace("District ", ""));
    return numA - numB;
  });

  const by_state = buildBreakdown(sourcedFees, (f) => f.state_code);

  // Fee change events: one row per institution and price move, and only moves whose new
  // price is still live. Older pipeline rows compared tiers of one fee with each other
  // and repeated the same institution several times.
  const change_events = await sql`
    SELECT institution_name, previous_amount, new_amount, change_type, detected_at
    FROM (
      SELECT DISTINCT ON (fce.institution_id, fce.previous_amount, fce.new_amount)
             ct.institution_name, fce.previous_amount, fce.new_amount,
             fce.change_type, fce.detected_at
      FROM fee_change_records fce
      JOIN institution_sources ct ON fce.institution_id = ct.id
      WHERE fce.fee_category = ${category}
        -- One schedule against an older copy of itself (hamilton/change-pairing.ts).
        AND fce.like_for_like IS TRUE
        AND ${sql.unsafe(consumerPriceMoveSql("fce"))}
        AND EXISTS (
          SELECT 1 FROM published_fee_catalog live
          WHERE live.institution_id = fce.institution_id
            AND live.fee_category = fce.fee_category
            AND live.review_status = 'approved'
            AND live.amount = fce.new_amount
        )
      ORDER BY fce.institution_id, fce.previous_amount, fce.new_amount, fce.detected_at DESC
    ) moves
    ORDER BY detected_at DESC
    LIMIT 50
  ` as FeeChangeEvent[];

  const perInstitution = valuePerInstitution(sourcedFees);
  const markets = new Map<number, Omit<InstitutionPoint, "value">>();
  for (const f of rawFees) {
    const id = Number(f.institution_id);
    if (f.source_document_id === null || markets.has(id)) continue;
    markets.set(id, {
      fed_district: f.fed_district === null ? null : Number(f.fed_district),
      charter_type: f.charter_type ?? null,
      state_code: f.state_code ?? null,
      asset_size_tier: f.asset_size_tier ?? null,
    });
  }
  const institution_points: InstitutionPoint[] = [];
  for (const [id, value] of perInstitution) {
    const market = markets.get(id);
    if (market) institution_points.push({ value, ...market });
  }

  return {
    // While rule 7 is off the schedule fields are always null: drop them so the cached
    // fee-category-detail entry (Next's 2 MB per-entry limit; overdraft is the largest)
    // keeps its old shape. When on, /fees/[category] needs them for its own summary.
    fees: COUNT_SHARED_SCHEDULE_ONCE ? fees : fees.map(withoutScheduleFields),
    by_charter_type,
    by_asset_tier,
    by_fed_district: by_fed_district_real,
    by_state: by_state.slice(0, 15),
    change_events,
    institution_values: [...perInstitution.values()].sort((a, b) => a - b),
    institution_points,
  };
}

export async function getAuditTrail(feeId: number): Promise<FeeReview[]> {
  return await sql`
    SELECT id, fee_id, action, username, previous_status, new_status,
           previous_values, new_values, notes, created_at
    FROM fee_reviews
    WHERE fee_id = ${feeId}
    ORDER BY created_at DESC
  ` as FeeReview[];
}

// --- Fee Change Tracking Queries ---

export interface FeeSnapshot {
  id: number;
  institution_id: number;
  snapshot_date: string;
  fee_name: string;
  fee_category: string | null;
  amount: number | null;
  frequency: string | null;
  created_at: string;
}

export interface PriceChange {
  id: number;
  institution_id: number;
  institution_name: string;
  fee_category: string;
  previous_amount: number | null;
  new_amount: number | null;
  change_type: string;
  detected_at: string;
}

export interface PriceMovement {
  fee_category: string;
  increased: number;
  decreased: number;
  removed: number;
  total_changes: number;
}

/** Get fee history for a specific institution + category over time */
export async function getFeeHistory(institutionId: number, category: string): Promise<FeeSnapshot[]> {
  try {
    return await sql`
      SELECT id, institution_id, snapshot_date, fee_name, fee_category,
             amount, frequency, created_at
      FROM institution_fee_snapshot_records
      WHERE institution_id = ${institutionId} AND fee_category = ${category}
      ORDER BY snapshot_date DESC
    ` as FeeSnapshot[];
  } catch {
    return [];
  }
}

/** Get recent price changes across all institutions, optionally filtered by category */
export async function getRecentPriceChanges(days: number = 90, category?: string): Promise<PriceChange[]> {
  try {
    const params: (string | number)[] = [days];
    // Only changes that compare one schedule with an older copy of itself (hamilton/change-pairing.ts).
    const conditions = [`fce.detected_at > NOW() - INTERVAL '1 day' * $1`, "fce.like_for_like IS TRUE", consumerPriceMoveSql("fce")];
    if (category) {
      conditions.push("fce.fee_category = $2");
      params.push(category);
    }
    const query = `
      SELECT fce.id, fce.institution_id, ct.institution_name,
             fce.fee_category, fce.previous_amount, fce.new_amount,
             fce.change_type, fce.detected_at
      FROM fee_change_records fce
      JOIN institution_sources ct ON fce.institution_id = ct.id
      WHERE ${conditions.join(" AND ")}
      ORDER BY fce.detected_at DESC
      LIMIT 200
    `;
    return await sql.unsafe(query, params) as PriceChange[];
  } catch {
    return [];
  }
}

/** Summarize price movements by category for a given time period */
export async function getPriceMovementSummary(days: number = 90): Promise<PriceMovement[]> {
  try {
    return await sql.unsafe(
      `SELECT fee_category,
              SUM(CASE WHEN change_type IN ('increase', 'increased') THEN 1 ELSE 0 END) as increased,
              SUM(CASE WHEN change_type IN ('decrease', 'decreased') THEN 1 ELSE 0 END) as decreased,
              SUM(CASE WHEN change_type = 'removed' THEN 1 ELSE 0 END) as removed,
              COUNT(*) as total_changes
       FROM fee_change_records
       WHERE detected_at > NOW() - INTERVAL '1 day' * $1
         AND like_for_like IS TRUE
         AND ${consumerPriceMoveSql("fee_change_records")}
       GROUP BY fee_category
       ORDER BY total_changes DESC`,
      [days]
    ) as PriceMovement[];
  } catch {
    return [];
  }
}

/** One published fee row as the Bank Fee Index explorer counts it: no text, so a category stays small to cache. */
export interface IndexRow {
  id: number;
  institution_id: number;
  institution_name: string;
  amount: number;
  charter_type: string;
  state_code: string | null;
}

/**
 * Every row the statistics count for one category (the same filter as getFeeCategoryDetail),
 * with only the fields the explorer's numbers need. Text for the rows a page lists comes from
 * getFeeRowDetails.
 */
export async function getIndexRows(category: string): Promise<IndexRow[]> {
  const rows = (await sql`
    SELECT ef.id, ef.institution_id, ct.institution_name, ef.amount, ct.charter_type, ct.state_code
      FROM published_fee_catalog ef
      JOIN institution_sources ct ON ef.institution_id = ct.id
     WHERE ef.fee_category = ${category} AND ef.review_status = 'approved'
       AND ${sql.unsafe(STATS_ROW_FILTER)}
       AND ef.amount IS NOT NULL AND ef.amount >= 0
  `) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    institution_id: Number(r.institution_id),
    institution_name: String(r.institution_name),
    amount: Number(r.amount),
    charter_type: String(r.charter_type),
    state_code: r.state_code == null ? null : String(r.state_code),
  }));
}

/**
 * A listed row's facts: the fee as its schedule names it, its amount, how often it is charged,
 * the account it names, its conditions, the document and when it was read. The words of the
 * schedule that print its price come from `getFeeEvidence` (fee-evidence.ts).
 */
export interface FeeRowDetail {
  fee_name: string | null;
  amount: number | null;
  frequency: string | null;
  account: string | null;
  conditions: string | null;
  document_url: string | null;
  read_on: string | null;
}

export async function getFeeRowDetails(ids: number[]): Promise<Map<number, FeeRowDetail>> {
  const clean = [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (clean.length === 0) return new Map();
  const rows = (await sql`
    SELECT id, fee_name, amount, frequency, account_product_type, conditions,
           COALESCE(document_url, source_url) AS document_url, created_at::date::text AS read_on
      FROM published_fee_catalog
     WHERE id = ANY(${clean}::bigint[])
  `) as Record<string, unknown>[];
  return new Map(
    rows.map((r) => [
      Number(r.id),
      {
        fee_name: r.fee_name == null ? null : String(r.fee_name),
        amount: r.amount == null ? null : Number(r.amount),
        frequency: r.frequency == null ? null : String(r.frequency),
        account: r.account_product_type == null ? null : String(r.account_product_type),
        conditions: readerFeeConditions(r.conditions == null ? null : String(r.conditions)),
        document_url: r.document_url == null ? null : String(r.document_url),
        read_on: r.read_on == null ? null : String(r.read_on),
      },
    ]),
  );
}
