import { sql } from "./connection";
import { STATS_ROW_FILTER, summarizeFeesBy } from "./fee-stats";

export interface PeerFilteredStats {
  total_institutions: number;
  with_website: number;
  with_fee_url: number;
  total_fees: number;
  banks: number;
  credit_unions: number;
}

export interface PeerTopCategory {
  fee_category: string;
  institution_count: number;
  median_amount: number | null;
  fee_family: string | null;
}

export async function getTopCategoriesForPeerSet(
  filters: { charter_type?: string; asset_tiers?: string[]; fed_districts?: number[] },
  limit = 5
): Promise<PeerTopCategory[]> {
  const conditions = ["ef.fee_category IS NOT NULL", STATS_ROW_FILTER];
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

  const rows = await sql.unsafe(
    `SELECT ef.fee_category, ef.amount, ef.institution_id
     FROM published_fee_catalog ef
     JOIN institution_sources ct ON ef.institution_id = ct.id
     WHERE ${where}`,
    params
  ) as {
    fee_category: string;
    amount: number | null;
    institution_id: number;
  }[];

  const results: PeerTopCategory[] = [];
  for (const [category, stats] of summarizeFeesBy(rows, (row) => row.fee_category)) {
    results.push({
      fee_category: category,
      institution_count: stats.institution_count,
      median_amount: stats.median_amount,
      fee_family: null,
    });
  }

  results.sort((a, b) => b.institution_count - a.institution_count);
  return results.slice(0, limit);
}

export interface PeerPreviewStats extends PeerFilteredStats {
  fee_url_pct: number;
  flagged_count: number;
  flag_rate: number;
  avg_confidence: number;
}

export async function getPeerPreviewStats(filters: {
  charter_type?: string;
  asset_tiers?: string[];
  fed_districts?: number[];
}): Promise<PeerPreviewStats> {
  const conditions: string[] = [];
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

  const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

  const [row] = await sql.unsafe(
    `SELECT COUNT(*) as total,
            SUM(CASE WHEN ct.website_url IS NOT NULL THEN 1 ELSE 0 END) as with_website,
            SUM(CASE WHEN ct.fee_schedule_url IS NOT NULL THEN 1 ELSE 0 END) as with_fee_url,
            SUM(CASE WHEN ct.charter_type = 'bank' THEN 1 ELSE 0 END) as banks,
            SUM(CASE WHEN ct.charter_type = 'credit_union' THEN 1 ELSE 0 END) as credit_unions
     FROM institution_sources ct
     ${where}`,
    params
  ) as { total: number; with_website: number; with_fee_url: number; banks: number; credit_unions: number }[];

  const [feeRow] = await sql.unsafe(
    `SELECT COUNT(*) as cnt,
            SUM(CASE WHEN ef.review_status = 'flagged' THEN 1 ELSE 0 END) as flagged,
            AVG(ef.extraction_confidence) as avg_conf
     FROM published_fee_catalog ef
     JOIN institution_sources ct ON ef.institution_id = ct.id
     ${where}`,
    params
  ) as { cnt: number; flagged: number; avg_conf: number | null }[];

  const total = Number(row.total) || 0;
  const totalFees = Number(feeRow.cnt) || 0;
  const flagged = Number(feeRow.flagged) || 0;

  return {
    total_institutions: total,
    with_website: Number(row.with_website) || 0,
    with_fee_url: Number(row.with_fee_url) || 0,
    total_fees: totalFees,
    banks: Number(row.banks) || 0,
    credit_unions: Number(row.credit_unions) || 0,
    fee_url_pct: total > 0 ? (Number(row.with_fee_url) || 0) / total : 0,
    flagged_count: flagged,
    flag_rate: totalFees > 0 ? flagged / totalFees : 0,
    avg_confidence: feeRow.avg_conf ?? 0,
  };
}
