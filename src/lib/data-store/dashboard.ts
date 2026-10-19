import { sql } from "./connection";
import { activeInstitutionFilter } from "./fee-stats";

export interface CollectionHealth {
  last_run_at: string | null;
  last_run_status: string | null;
  success_rate_24h: number;
  avg_confidence: number;
  institutions_failing: number;
  total_collected_24h: number;
  collection_runs_7d: number;
}

export async function getCollectionHealth(): Promise<CollectionHealth> {
  const [lastRun] = await sql<{ completed_at: string | null; status: string }[]>`
    SELECT completed_at, status FROM source_collection_runs
    ORDER BY started_at DESC LIMIT 1`;

  const [recent] = await sql<{ total: number; succeeded: number }[]>`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as succeeded
    FROM source_documents
    WHERE crawled_at > NOW() - INTERVAL '1 day'`;

  const [confidence] = await sql<{ avg_conf: number | null }[]>`
    SELECT AVG(extraction_confidence) as avg_conf
    FROM published_fee_catalog
    WHERE created_at > NOW() - INTERVAL '1 day'`;

  const [failing] = await sql<{ cnt: number }[]>`
    SELECT COUNT(*) as cnt FROM institution_sources
    WHERE consecutive_failures > 3`;

  const [runs7d] = await sql<{ cnt: number }[]>`
    SELECT COUNT(*) as cnt FROM source_collection_runs
    WHERE started_at > NOW() - INTERVAL '7 days'`;

  return {
    last_run_at: lastRun?.completed_at ?? null,
    last_run_status: lastRun?.status ?? null,
    success_rate_24h:
      Number(recent.total) > 0 ? Number(recent.succeeded) / Number(recent.total) : 0,
    avg_confidence: Number(confidence.avg_conf ?? 0),
    institutions_failing: Number(failing.cnt),
    total_collected_24h: Number(recent.total),
    collection_runs_7d: Number(runs7d.cnt),
  };
}

export interface DistrictMetric {
  district: number;
  name: string;
  institution_count: number;
  with_fee_url: number;
  fee_url_pct: number;
  total_fees: number;
  flagged_count: number;
  flag_rate: number;
  avg_confidence: number;
}

export async function getDistrictMetrics(filters?: {
  charter_type?: string;
  asset_tiers?: string[];
}): Promise<DistrictMetric[]> {
  const conditions = ["ct.fed_district IS NOT NULL", activeInstitutionFilter("ct")];
  const params: (string | number)[] = [];
  let paramIdx = 1;

  if (filters?.charter_type) {
    conditions.push(`ct.charter_type = $${paramIdx++}`);
    params.push(filters.charter_type);
  }
  if (filters?.asset_tiers && filters.asset_tiers.length > 0) {
    const placeholders = filters.asset_tiers.map(() => `$${paramIdx++}`).join(",");
    conditions.push(`ct.asset_size_tier IN (${placeholders})`);
    params.push(...filters.asset_tiers);
  }

  const where = conditions.join(" AND ");

  const rows = (await sql.unsafe(
    `SELECT ct.fed_district as district,
            COUNT(DISTINCT ct.id) as institution_count,
            COUNT(DISTINCT CASE WHEN ct.fee_schedule_url IS NOT NULL THEN ct.id END) as with_fee_url,
            COUNT(ef.id) as total_fees,
            SUM(CASE WHEN ef.validation_flags IS NOT NULL AND ef.validation_flags != '[]' THEN 1 ELSE 0 END) as flagged_count,
            AVG(ef.extraction_confidence) as avg_confidence
     FROM institution_sources ct
     LEFT JOIN published_fee_catalog ef ON ct.id = ef.institution_id
     WHERE ${where}
     GROUP BY ct.fed_district
     ORDER BY ct.fed_district`,
    params,
  )) as {
    district: number;
    institution_count: number;
    with_fee_url: number;
    total_fees: number;
    flagged_count: number;
    avg_confidence: number | null;
  }[];

  const districtNames: Record<number, string> = {
    1: "Boston",
    2: "New York",
    3: "Philadelphia",
    4: "Cleveland",
    5: "Richmond",
    6: "Atlanta",
    7: "Chicago",
    8: "St. Louis",
    9: "Minneapolis",
    10: "Kansas City",
    11: "Dallas",
    12: "San Francisco",
  };

  return rows.map((r) => {
    const instCount = Number(r.institution_count);
    const feeUrlCount = Number(r.with_fee_url);
    const totalFees = Number(r.total_fees);
    const flaggedCount = Number(r.flagged_count);
    return {
      district: Number(r.district),
      name: districtNames[Number(r.district)] ?? `District ${r.district}`,
      institution_count: instCount,
      with_fee_url: feeUrlCount,
      fee_url_pct: instCount > 0 ? feeUrlCount / instCount : 0,
      total_fees: totalFees,
      flagged_count: flaggedCount,
      flag_rate: totalFees > 0 ? flaggedCount / totalFees : 0,
      avg_confidence: Number(r.avg_confidence ?? 0),
    };
  });
}
