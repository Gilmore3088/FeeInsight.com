import { sql } from "./connection";
import { summarizeFeesBy, valuePerInstitution, type StatsInputRow } from "./fee-stats";
import type { FeeReview } from "./types";

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
  /** Institutions publishing this fee at $0. Consumer guides cite it directly. */
  zero_count: number;
  /** Median among banks only; null below the minimum sample. */
  bank_median_amount: number | null;
  /** Median among credit unions only; null below the minimum sample. */
  cu_median_amount: number | null;
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
}

export interface DimensionBreakdown {
  dimension_value: string;
  count: number;
  min_amount: number | null;
  max_amount: number | null;
  avg_amount: number | null;
  median_amount: number | null;
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
    SELECT ef.fee_category, ef.amount, ef.institution_id, ct.charter_type
    FROM published_fee_catalog ef
    JOIN institution_sources ct ON ef.institution_id = ct.id
    WHERE ef.fee_category IS NOT NULL
      AND ef.review_status = 'approved'
      AND ef.source_document_id IS NOT NULL
  ` as {
    fee_category: string;
    amount: number | null;
    institution_id: number;
    charter_type: string;
  }[];

  // Institutions listing a $0 fee per category (the guides cite "N charge nothing").
  const zeroInstitutions = new Map<string, Set<number>>();
  for (const row of rows) {
    if (row.amount !== null && Number(row.amount) === 0) {
      const set = zeroInstitutions.get(row.fee_category) ?? new Set<number>();
      set.add(Number(row.institution_id));
      zeroInstitutions.set(row.fee_category, set);
    }
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
      SELECT ef.id, ef.institution_id, ct.institution_name, ef.amount
      FROM published_fee_catalog ef
      JOIN institution_sources ct ON ef.institution_id = ct.id
      WHERE ef.fee_category = ${category}
        AND ef.review_status = 'approved'
        AND ef.amount IS NOT NULL
        AND ef.amount >= 0
      ORDER BY ef.amount ASC, ct.institution_name ASC
      LIMIT ${bounded}
    `,
    sql`
      SELECT ef.id, ef.institution_id, ct.institution_name, ef.amount
      FROM published_fee_catalog ef
      JOIN institution_sources ct ON ef.institution_id = ct.id
      WHERE ef.fee_category = ${category}
        AND ef.review_status = 'approved'
        AND ef.amount IS NOT NULL
        AND ef.amount >= 0
      ORDER BY ef.amount DESC, ct.institution_name ASC
      LIMIT ${bounded}
    `,
  ]);

  const normalize = (rows: unknown[]): FeeExtreme[] =>
    (rows as FeeExtreme[]).map((r) => ({
      id: Number(r.id),
      institution_id: Number(r.institution_id),
      institution_name: r.institution_name,
      amount: Number(r.amount),
    }));

  return {
    cheapest: normalize(cheapestRows),
    mostExpensive: normalize(expensiveRows),
  };
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
}> {
  const rawFees = await sql`
    SELECT ef.id, ct.institution_name, ef.institution_id,
           ef.amount, ef.frequency, ef.conditions,
           ct.charter_type, ct.state_code, ct.asset_size_tier,
           ct.asset_size, ef.review_status, ef.extraction_confidence,
           ef.canonical_fee_key, ef.variant_type, ef.source_document_id,
           ef.fee_name, COALESCE(ef.document_url, ef.source_url) AS document_url
    FROM published_fee_catalog ef
    JOIN institution_sources ct ON ef.institution_id = ct.id
    WHERE ef.fee_category = ${category} AND ef.review_status = 'approved'
    ORDER BY ef.amount DESC NULLS LAST
  ` as (Omit<FeeInstance, "source_document_id"> & { source_document_id: number | string | null })[];

  // Normalize numeric fields (Postgres NUMERIC returns strings)
  const fees: FeeInstance[] = rawFees.map((f) => ({
    ...f,
    id: Number(f.id),
    institution_id: Number(f.institution_id),
    amount: f.amount !== null ? Number(f.amount) : null,
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
      });
    }
    return result.sort((a, b) => b.count - a.count);
  }

  const by_charter_type = buildBreakdown(sourcedFees, (f) =>
    f.charter_type === "bank" ? "Bank" : f.charter_type === "credit_union" ? "Credit Union" : null
  );
  const by_asset_tier = buildBreakdown(sourcedFees, (f) => f.asset_size_tier);

  const districtRows = await sql`
    SELECT ct.fed_district, ef.amount, ef.institution_id
    FROM published_fee_catalog ef
    JOIN institution_sources ct ON ef.institution_id = ct.id
    WHERE ef.fee_category = ${category}
      AND ef.review_status = 'approved'
      AND ef.source_document_id IS NOT NULL
      AND ct.fed_district IS NOT NULL
  ` as { fed_district: number; amount: number | null; institution_id: number }[];

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
        AND EXISTS (SELECT 1 FROM published_fee_records nl WHERE nl.fee_published_id = fce.new_fee_published_id AND nl.rolled_back_at IS NULL AND NOT EXISTS (SELECT 1 FROM pipeline_feedback pf WHERE pf.fee_published_id = nl.fee_published_id AND pf.kind = 'takedown_pending'))
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

  return {
    fees,
    by_charter_type,
    by_asset_tier,
    by_fed_district: by_fed_district_real,
    by_state: by_state.slice(0, 15),
    change_events,
    institution_values: [
      ...valuePerInstitution(sourcedFees.map((fee) => ({ ...fee, fee_category: category }))).values(),
    ].sort((a, b) => a - b),
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
    const conditions = [`fce.detected_at > NOW() - INTERVAL '1 day' * $1`, "fce.like_for_like IS TRUE", "EXISTS (SELECT 1 FROM published_fee_records nl WHERE nl.fee_published_id = fce.new_fee_published_id AND nl.rolled_back_at IS NULL AND NOT EXISTS (SELECT 1 FROM pipeline_feedback pf WHERE pf.fee_published_id = nl.fee_published_id AND pf.kind = 'takedown_pending'))"];
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
         AND EXISTS (SELECT 1 FROM published_fee_records nl WHERE nl.fee_published_id = fee_change_records.new_fee_published_id AND nl.rolled_back_at IS NULL AND NOT EXISTS (SELECT 1 FROM pipeline_feedback pf WHERE pf.fee_published_id = nl.fee_published_id AND pf.kind = 'takedown_pending'))
       GROUP BY fee_category
       ORDER BY total_changes DESC`,
      [days]
    ) as PriceMovement[];
  } catch {
    return [];
  }
}
