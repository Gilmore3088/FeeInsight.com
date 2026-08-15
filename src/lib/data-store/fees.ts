import { sql } from "./connection";
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
  const grouped = new Map<
    string,
    {
      amounts: number[];
      banks: Set<number>;
      cus: Set<number>;
      total: number;
      zeroInstitutions: Set<number>;
    }
  >();

  const rows = await sql`
    SELECT ef.fee_category, ef.amount, ef.institution_id, ct.charter_type
    FROM published_fee_catalog ef
    JOIN institution_sources ct ON ef.institution_id = ct.id
    WHERE ef.fee_category IS NOT NULL AND ef.review_status = 'approved'
  ` as {
    fee_category: string;
    amount: number | null;
    institution_id: number;
    charter_type: string;
  }[];

  for (const row of rows) {
    if (!grouped.has(row.fee_category)) {
      grouped.set(row.fee_category, {
        amounts: [],
        banks: new Set(),
        cus: new Set(),
        total: 0,
        zeroInstitutions: new Set(),
      });
    }
    const entry = grouped.get(row.fee_category)!;
    entry.total++;
    const amt = row.amount !== null ? Number(row.amount) : null;
    if (amt !== null && amt > 0) {
      entry.amounts.push(amt);
    }
    if (amt === 0) {
      entry.zeroInstitutions.add(Number(row.institution_id));
    }
    if (row.charter_type === "bank") {
      entry.banks.add(Number(row.institution_id));
    } else {
      entry.cus.add(Number(row.institution_id));
    }
  }

  const results: FeeCategorySummary[] = [];
  for (const [category, data] of grouped.entries()) {
    const stats = computeStats(data.amounts);
    results.push({
      fee_category: category,
      institution_count: new Set([...data.banks, ...data.cus]).size,
      total_observations: data.total,
      bank_count: data.banks.size,
      cu_count: data.cus.size,
      min_amount: stats.min,
      max_amount: stats.max,
      avg_amount: stats.avg,
      median_amount: stats.median,
      p25_amount: stats.p25,
      p75_amount: stats.p75,
      zero_count: data.zeroInstitutions.size,
    });
  }

  results.sort((a, b) => b.institution_count - a.institution_count);
  return results;
}

export async function getFeeCategoryDetail(category: string): Promise<{
  fees: FeeInstance[];
  by_charter_type: DimensionBreakdown[];
  by_asset_tier: DimensionBreakdown[];
  by_fed_district: DimensionBreakdown[];
  by_state: DimensionBreakdown[];
  change_events: FeeChangeEvent[];
}> {
  const rawFees = await sql`
    SELECT ef.id, ct.institution_name, ef.institution_id,
           ef.amount, ef.frequency, ef.conditions,
           ct.charter_type, ct.state_code, ct.asset_size_tier,
           ct.asset_size, ef.review_status, ef.extraction_confidence,
           ef.canonical_fee_key, ef.variant_type
    FROM published_fee_catalog ef
    JOIN institution_sources ct ON ef.institution_id = ct.id
    WHERE ef.fee_category = ${category} AND ef.review_status = 'approved'
    ORDER BY ef.amount DESC NULLS LAST
  ` as FeeInstance[];

  // Normalize numeric fields (Postgres NUMERIC returns strings)
  const fees: FeeInstance[] = rawFees.map((f) => ({
    ...f,
    id: Number(f.id),
    institution_id: Number(f.institution_id),
    amount: f.amount !== null ? Number(f.amount) : null,
    asset_size: f.asset_size !== null && f.asset_size !== undefined ? Number(f.asset_size) : null,
    extraction_confidence: Number(f.extraction_confidence ?? 0),
  }));

  // Compute dimensional breakdowns
  function buildBreakdown(
    dimFn: (f: FeeInstance) => string | null
  ): DimensionBreakdown[] {
    const groups = new Map<string, number[]>();
    for (const fee of fees) {
      const dim = dimFn(fee) ?? "Unknown";
      if (!groups.has(dim)) groups.set(dim, []);
      if (fee.amount !== null && fee.amount > 0) {
        groups.get(dim)!.push(fee.amount);
      }
    }
    const result: DimensionBreakdown[] = [];
    for (const [value, amounts] of groups.entries()) {
      const s = computeStats(amounts);
      result.push({
        dimension_value: value,
        count: amounts.length,
        min_amount: s.min,
        max_amount: s.max,
        avg_amount: s.avg,
        median_amount: s.median,
      });
    }
    return result.sort((a, b) => b.count - a.count);
  }

  const by_charter_type = buildBreakdown((f) => f.charter_type === "bank" ? "Bank" : "Credit Union");
  const by_asset_tier = buildBreakdown((f) => f.asset_size_tier);

  // For fed district, re-query with actual district numbers
  const districtRows = await sql`
    SELECT ct.fed_district, ef.amount
    FROM published_fee_catalog ef
    JOIN institution_sources ct ON ef.institution_id = ct.id
    WHERE ef.fee_category = ${category}
      AND ef.review_status = 'approved'
      AND ct.fed_district IS NOT NULL
  ` as { fed_district: number; amount: number | null }[];

  const districtGroups = new Map<number, number[]>();
  for (const row of districtRows) {
    const dist = Number(row.fed_district);
    const amt = row.amount !== null ? Number(row.amount) : null;
    if (!districtGroups.has(dist)) districtGroups.set(dist, []);
    if (amt !== null && amt > 0) {
      districtGroups.get(dist)!.push(amt);
    }
  }
  const by_fed_district_real: DimensionBreakdown[] = [];
  for (const [district, amounts] of districtGroups.entries()) {
    const s = computeStats(amounts);
    by_fed_district_real.push({
      dimension_value: `District ${district}`,
      count: amounts.length,
      min_amount: s.min,
      max_amount: s.max,
      avg_amount: s.avg,
      median_amount: s.median,
    });
  }
  by_fed_district_real.sort((a, b) => {
    const numA = parseInt(a.dimension_value.replace("District ", ""));
    const numB = parseInt(b.dimension_value.replace("District ", ""));
    return numA - numB;
  });

  const by_state = buildBreakdown((f) => f.state_code);

  // Fee change events
  const change_events = await sql`
    SELECT ct.institution_name, fce.previous_amount, fce.new_amount,
           fce.change_type, fce.detected_at
    FROM fee_change_records fce
    JOIN institution_sources ct ON fce.institution_id = ct.id
    WHERE fce.fee_category = ${category}
    ORDER BY fce.detected_at DESC
    LIMIT 50
  ` as FeeChangeEvent[];

  return {
    fees,
    by_charter_type,
    by_asset_tier,
    by_fed_district: by_fed_district_real,
    by_state: by_state.slice(0, 15),
    change_events,
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
    const conditions = [`fce.detected_at > NOW() - INTERVAL '1 day' * $1`];
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
              SUM(CASE WHEN change_type = 'increased' THEN 1 ELSE 0 END) as increased,
              SUM(CASE WHEN change_type = 'decreased' THEN 1 ELSE 0 END) as decreased,
              SUM(CASE WHEN change_type = 'removed' THEN 1 ELSE 0 END) as removed,
              COUNT(*) as total_changes
       FROM fee_change_records
       WHERE detected_at > NOW() - INTERVAL '1 day' * $1
       GROUP BY fee_category
       ORDER BY total_changes DESC`,
      [days]
    ) as PriceMovement[];
  } catch {
    return [];
  }
}
