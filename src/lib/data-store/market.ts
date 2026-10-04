import { sql } from "./connection";
import { STATS_ROW_FILTER } from "./fee-stats";
import type { IndexEntry } from "./fee-index";

export interface MarketIndexEntry extends IndexEntry {
  national_median: number | null;
  national_p25: number | null;
  national_p75: number | null;
  national_institution_count: number;
  delta_pct: number | null;
}

export function buildMarketIndex(
  national: IndexEntry[],
  segment: IndexEntry[] | null
): MarketIndexEntry[] {
  const nationalMap = new Map(national.map((e) => [e.fee_category, e]));

  if (!segment) {
    return national.map((n) => ({
      ...n,
      national_median: n.median_amount,
      national_p25: n.p25_amount,
      national_p75: n.p75_amount,
      national_institution_count: n.institution_count,
      delta_pct: null,
    }));
  }

  const segmentMap = new Map(segment.map((e) => [e.fee_category, e]));
  const result: MarketIndexEntry[] = [];

  for (const [cat, nat] of nationalMap) {
    const seg = segmentMap.get(cat);
    const segMedian = seg?.median_amount ?? null;
    const natMedian = nat.median_amount;
    const delta =
      segMedian !== null && natMedian !== null && natMedian !== 0
        ? Math.round(((segMedian - natMedian) / natMedian) * 1000) / 10
        : null;

    if (seg) {
      result.push({
        ...seg,
        national_median: natMedian,
        national_p25: nat.p25_amount,
        national_p75: nat.p75_amount,
        national_institution_count: nat.institution_count,
        delta_pct: delta,
      });
    } else {
      result.push({
        ...nat,
        institution_count: 0,
        observation_count: 0,
        approved_count: 0,
        bank_count: 0,
        cu_count: 0,
        maturity_tier: "insufficient",
        national_median: natMedian,
        national_p25: nat.p25_amount,
        national_p75: nat.p75_amount,
        national_institution_count: nat.institution_count,
        delta_pct: null,
      });
    }
  }

  result.sort((a, b) => b.institution_count - a.institution_count);
  return result;
}

export async function getFilteredTierCounts(filters: {
  charter_type?: string;
  asset_tiers?: string[];
  fed_districts?: number[];
}): Promise<{ tier: string; count: number }[]> {
  const conditions = ["asset_size_tier IS NOT NULL"];
  const params: (string | number)[] = [];
  let paramIdx = 0;

  if (filters.charter_type) {
    paramIdx++;
    conditions.push(`charter_type = $${paramIdx}`);
    params.push(filters.charter_type);
  }
  if (filters.asset_tiers && filters.asset_tiers.length > 0) {
    const placeholders = filters.asset_tiers.map(() => {
      paramIdx++;
      return `$${paramIdx}`;
    }).join(",");
    conditions.push(`asset_size_tier IN (${placeholders})`);
    params.push(...filters.asset_tiers);
  }
  if (filters.fed_districts && filters.fed_districts.length > 0) {
    const placeholders = filters.fed_districts.map(() => {
      paramIdx++;
      return `$${paramIdx}`;
    }).join(",");
    conditions.push(`fed_district IN (${placeholders})`);
    params.push(...filters.fed_districts);
  }

  const rows = await sql.unsafe(
    `SELECT asset_size_tier as tier, COUNT(*) as count
     FROM institution_sources
     WHERE ${conditions.join(" AND ")}
     GROUP BY asset_size_tier
     ORDER BY MIN(asset_size)`,
    params
  );
  return [...rows] as unknown as { tier: string; count: number }[];
}

export async function getFeesForCategory(
  category: string,
  filters: {
    charter_type?: string;
    asset_tiers?: string[];
    fed_districts?: number[];
  },
  approvedOnly = true
): Promise<{ amount: number; charter_type: string; institution_name: string }[]> {
  const conditions = [
    "ef.fee_category = $1",
    "ef.amount IS NOT NULL",
    "ef.amount >= 0",
    STATS_ROW_FILTER,
    approvedOnly
      ? "ef.review_status = 'approved'"
      : "ef.review_status != 'rejected'",
  ];
  const params: (string | number)[] = [category];
  let paramIdx = 1;

  if (filters.charter_type) {
    paramIdx++;
    conditions.push(`ct.charter_type = $${paramIdx}`);
    params.push(filters.charter_type);
  }
  if (filters.asset_tiers && filters.asset_tiers.length > 0) {
    const placeholders = filters.asset_tiers.map(() => {
      paramIdx++;
      return `$${paramIdx}`;
    }).join(",");
    conditions.push(`ct.asset_size_tier IN (${placeholders})`);
    params.push(...filters.asset_tiers);
  }
  if (filters.fed_districts && filters.fed_districts.length > 0) {
    const placeholders = filters.fed_districts.map(() => {
      paramIdx++;
      return `$${paramIdx}`;
    }).join(",");
    conditions.push(`ct.fed_district IN (${placeholders})`);
    params.push(...filters.fed_districts);
  }

  const rows = await sql.unsafe(
    `SELECT ef.amount, ct.charter_type, ct.institution_name
     FROM published_fee_catalog ef
     JOIN institution_sources ct ON ef.institution_id = ct.id
     WHERE ${conditions.join(" AND ")}
     ORDER BY ef.amount`,
    params
  );
  return [...rows] as unknown as {
    amount: number;
    charter_type: string;
    institution_name: string;
  }[];
}

export interface SegmentOutlier {
  fee_category: string;
  institution_name: string;
  institution_id: number;
  amount: number;
  type: "highest" | "lowest" | "most_flagged";
}

export async function getSegmentOutliers(
  filters: {
    charter_type?: string;
    asset_tiers?: string[];
    fed_districts?: number[];
  },
  limit = 3
): Promise<SegmentOutlier[]> {
  const conditions = [
    "ef.fee_category IS NOT NULL",
    "ef.review_status = 'approved'",
    "ef.amount IS NOT NULL",
    "ef.amount >= 0",
    STATS_ROW_FILTER,
  ];
  const params: (string | number)[] = [];
  let paramIdx = 0;

  if (filters.charter_type) {
    paramIdx++;
    conditions.push(`ct.charter_type = $${paramIdx}`);
    params.push(filters.charter_type);
  }
  if (filters.asset_tiers && filters.asset_tiers.length > 0) {
    const placeholders = filters.asset_tiers.map(() => {
      paramIdx++;
      return `$${paramIdx}`;
    }).join(",");
    conditions.push(`ct.asset_size_tier IN (${placeholders})`);
    params.push(...filters.asset_tiers);
  }
  if (filters.fed_districts && filters.fed_districts.length > 0) {
    const placeholders = filters.fed_districts.map(() => {
      paramIdx++;
      return `$${paramIdx}`;
    }).join(",");
    conditions.push(`ct.fed_district IN (${placeholders})`);
    params.push(...filters.fed_districts);
  }

  const where = conditions.join(" AND ");
  const limitIdx = paramIdx + 1;

  const highest = await sql.unsafe(
    `SELECT ef.fee_category, ct.institution_name, ct.id as institution_id, ef.amount
     FROM published_fee_catalog ef
     JOIN institution_sources ct ON ef.institution_id = ct.id
     WHERE ${where}
     ORDER BY ef.amount DESC
     LIMIT $${limitIdx}`,
    [...params, limit]
  ) as {
    fee_category: string;
    institution_name: string;
    institution_id: number;
    amount: number;
  }[];

  const lowest = await sql.unsafe(
    `SELECT ef.fee_category, ct.institution_name, ct.id as institution_id, ef.amount
     FROM published_fee_catalog ef
     JOIN institution_sources ct ON ef.institution_id = ct.id
     WHERE ${where}
     ORDER BY ef.amount ASC
     LIMIT $${limitIdx}`,
    [...params, limit]
  ) as {
    fee_category: string;
    institution_name: string;
    institution_id: number;
    amount: number;
  }[];

  const flaggedConditions = ["ef.fee_category IS NOT NULL", "ef.review_status = 'flagged'"];
  const flaggedParams: (string | number)[] = [];
  let flaggedParamIdx = 0;
  if (filters.charter_type) {
    flaggedParamIdx++;
    flaggedConditions.push(`ct.charter_type = $${flaggedParamIdx}`);
    flaggedParams.push(filters.charter_type);
  }
  if (filters.asset_tiers && filters.asset_tiers.length > 0) {
    const placeholders = filters.asset_tiers.map(() => {
      flaggedParamIdx++;
      return `$${flaggedParamIdx}`;
    }).join(",");
    flaggedConditions.push(`ct.asset_size_tier IN (${placeholders})`);
    flaggedParams.push(...filters.asset_tiers);
  }
  if (filters.fed_districts && filters.fed_districts.length > 0) {
    const placeholders = filters.fed_districts.map(() => {
      flaggedParamIdx++;
      return `$${flaggedParamIdx}`;
    }).join(",");
    flaggedConditions.push(`ct.fed_district IN (${placeholders})`);
    flaggedParams.push(...filters.fed_districts);
  }
  const flaggedLimitIdx = flaggedParamIdx + 1;

  const flagged = await sql.unsafe(
    `SELECT ef.fee_category, ct.institution_name, ct.id as institution_id,
            COALESCE(ef.amount, 0) as amount
     FROM published_fee_catalog ef
     JOIN institution_sources ct ON ef.institution_id = ct.id
     WHERE ${flaggedConditions.join(" AND ")}
     ORDER BY ef.amount DESC
     LIMIT $${flaggedLimitIdx}`,
    [...flaggedParams, limit]
  ) as {
    fee_category: string;
    institution_name: string;
    institution_id: number;
    amount: number;
  }[];

  return [
    ...highest.map((r) => ({ ...r, type: "highest" as const })),
    ...lowest.map((r) => ({ ...r, type: "lowest" as const })),
    ...flagged.map((r) => ({ ...r, type: "most_flagged" as const })),
  ];
}
