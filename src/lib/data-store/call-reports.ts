import { getSql } from "./connection";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "./fee-stats";
import { FDIC_TIER_BREAKPOINTS, getTierForAssets } from "../fed-districts";

/**
 * fdic and ncua rows report dollars in thousands. ffiec rows duplicate the fdic
 * quarters in other units (whole-dollar balances, service charges over-scaled
 * further; see financial-units.ts), so mixing them into one series or one peer
 * group produces fake drops and wrong ranks. Every query here reads the
 * thousands-scale sources only.
 */
const SAME_SCALE_SOURCES = "inf.source IN ('fdic', 'ncua')";

export interface RevenueSnapshot {
  quarter: string;
  total_service_charges: number;
  total_institutions: number;
  bank_service_charges: number;
  cu_service_charges: number;
  yoy_change_pct: number | null;
}

export interface RevenueTrend {
  quarters: RevenueSnapshot[];
  latest: RevenueSnapshot | null;
}

export interface TopRevenueInstitution {
  cert_number: string;
  institution_name: string | null;
  charter_type: string;
  report_date: string;
  service_charge_income: number;
  total_assets: number | null;
}

export async function getRevenueTrend(quarterCount = 8): Promise<RevenueTrend> {
  const sql = getSql();

  try {
  // institution_financial_records has institution_id, not cert_number/charter_type directly.
  // JOIN to institution_sources for charter_type and cert_number.
  // report_date is TEXT (e.g. '2024-12-31') — cast to date for DATE_TRUNC.
  const rows = await sql.unsafe(
    `SELECT
       TO_CHAR(DATE_TRUNC('quarter', inf.report_date::date), 'YYYY-"Q"Q') AS quarter,
       MIN(inf.report_date)                                     AS quarter_date,
       SUM(inf.service_charge_income)                           AS total_service_charges,
       COUNT(DISTINCT ct.cert_number)                           AS total_institutions,
       SUM(CASE WHEN ct.charter_type = 'bank' THEN inf.service_charge_income ELSE 0 END)
                                                                 AS bank_service_charges,
       SUM(CASE WHEN ct.charter_type = 'credit_union' THEN inf.service_charge_income ELSE 0 END)
                                                                 AS cu_service_charges
     FROM institution_financial_records inf
     JOIN institution_sources ct ON ct.id = inf.institution_id
     WHERE inf.service_charge_income > 0
       AND ${SAME_SCALE_SOURCES}
     GROUP BY DATE_TRUNC('quarter', inf.report_date::date)
     ORDER BY DATE_TRUNC('quarter', inf.report_date::date) DESC
     LIMIT $1`,
    [quarterCount]
  ) as {
    quarter: string;
    quarter_date: string;
    total_service_charges: string;
    total_institutions: string;
    bank_service_charges: string;
    cu_service_charges: string;
  }[];

  const snapshots: RevenueSnapshot[] = rows.map((row) => ({
    quarter: row.quarter,
    total_service_charges: Number(row.total_service_charges),
    total_institutions: Number(row.total_institutions),
    bank_service_charges: Number(row.bank_service_charges),
    cu_service_charges: Number(row.cu_service_charges),
    // YoY = compare to 4 quarters back (idx + 4); null if not available
    yoy_change_pct: null,
  }));

  // Attach YoY change: compare index i to index i+4 (same quarter, prior year)
  for (let i = 0; i < snapshots.length; i++) {
    const priorYearIdx = i + 4;
    if (priorYearIdx < snapshots.length) {
      const current = snapshots[i].total_service_charges;
      const prior = snapshots[priorYearIdx].total_service_charges;
      snapshots[i].yoy_change_pct =
        prior > 0 ? ((current - prior) / prior) * 100 : null;
    }
  }

  return {
    quarters: snapshots,
    latest: snapshots[0] ?? null,
  };
  } catch {
    return { quarters: [], latest: null };
  }
}

export async function getTopRevenueInstitutions(
  limit = 10
): Promise<TopRevenueInstitution[]> {
  const sql = getSql();

  try {
    // Find the latest report_date in institution_financial_records
    const [latestRow] = await sql`
      SELECT MAX(report_date) AS latest_date
      FROM institution_financial_records
      WHERE service_charge_income > 0
    `;

    if (!latestRow?.latest_date) return [];

    const latestDate = latestRow.latest_date instanceof Date
      ? latestRow.latest_date.toISOString().slice(0, 10)
      : String(latestRow.latest_date);

    const rows = await sql.unsafe(
      `SELECT
         ct.cert_number,
         ct.institution_name,
         COALESCE(ct.charter_type, 'unknown') AS charter_type,
         inf.report_date::text                                   AS report_date,
         inf.service_charge_income,
         inf.total_assets
       FROM institution_financial_records inf
       JOIN institution_sources ct ON ct.id = inf.institution_id
       WHERE inf.report_date = $1
         AND inf.service_charge_income > 0
         AND ${SAME_SCALE_SOURCES}
       ORDER BY inf.service_charge_income DESC
       LIMIT $2`,
      [latestDate, limit]
    ) as {
      cert_number: string;
      institution_name: string | null;
      charter_type: string;
      report_date: string;
      service_charge_income: string;
      total_assets: string | null;
    }[];

    return rows.map((row) => ({
      cert_number: row.cert_number,
      institution_name: row.institution_name,
      charter_type: row.charter_type,
      report_date: row.report_date,
      service_charge_income: Number(row.service_charge_income),
      total_assets: row.total_assets !== null ? Number(row.total_assets) : null,
    }));
  } catch {
    return [];
  }
}

export interface InstitutionRevenueQuarter {
  quarter: string;
  service_charge_income: number;
  fee_income_ratio: number | null;
  yoy_change_pct: number | null;
}

export async function getInstitutionRevenueTrend(
  targetId: number,
  quarterCount = 8
): Promise<InstitutionRevenueQuarter[]> {
  const sql = getSql();

  try {
    const rows = await sql.unsafe(
      `SELECT
         quarter,
         service_charge_income,
         fee_income_ratio
       FROM (
         SELECT
           TO_CHAR(DATE_TRUNC('quarter', inf.report_date::date), 'YYYY-"Q"Q') AS quarter,
           inf.report_date::date AS report_date,
           inf.service_charge_income,
           inf.fee_income_ratio,
           ROW_NUMBER() OVER (
             PARTITION BY DATE_TRUNC('quarter', inf.report_date::date)
             ORDER BY inf.report_date::date DESC, inf.id DESC
           ) AS quarter_rank
         FROM institution_financial_records inf
         WHERE inf.institution_id = $1
           AND inf.service_charge_income IS NOT NULL
           AND ${SAME_SCALE_SOURCES}
       ) ranked
       WHERE quarter_rank = 1
       ORDER BY report_date DESC
       LIMIT $2`,
      [targetId, quarterCount]
    ) as { quarter: string; service_charge_income: string; fee_income_ratio: string | null }[];

    return rows.map((row, idx) => {
      const sc = Number(row.service_charge_income);
      // Find same quarter suffix from prior year for YoY (e.g. "Q4" matches "Q4")
      const quarterSuffix = row.quarter.slice(5); // "Q4" from "2024-Q4"
      const priorIdx = rows.findIndex(
        (r, i) => i > idx && r.quarter.slice(5) === quarterSuffix
      );
      const priorSc = priorIdx >= 0 ? Number(rows[priorIdx].service_charge_income) : null;
      const yoy = priorSc !== null && priorSc > 0 ? ((sc - priorSc) / priorSc) * 100 : null;

      return {
        quarter: row.quarter,
        service_charge_income: sc,
        fee_income_ratio: row.fee_income_ratio !== null ? Number(row.fee_income_ratio) : null,
        yoy_change_pct: yoy !== null ? Math.round(yoy * 10) / 10 : null,
      };
    });
  } catch {
    return [];
  }
}

export interface PeerRanking {
  institution_name: string | null;
  tier: string;
  sc_income: number;
  sc_rank: number;
  peer_count: number;
  /** Null when fewer than MIN_INSTITUTIONS_FOR_MEDIAN peers report. */
  peer_median_sc: number | null;
  fee_income_ratio: number | null;
  peer_median_fee_ratio: number | null;
}

export async function getInstitutionPeerRanking(
  targetId: number
): Promise<PeerRanking | null> {
  const sql = getSql();

  const instRows = await sql.unsafe(
    `SELECT ct.institution_name, inf.total_assets, inf.service_charge_income,
            inf.fee_income_ratio, inf.report_date
     FROM institution_financial_records inf
     JOIN institution_sources ct ON ct.id = inf.institution_id
     WHERE inf.institution_id = $1
       AND inf.service_charge_income IS NOT NULL
       AND inf.total_assets IS NOT NULL
       AND ${SAME_SCALE_SOURCES}
     ORDER BY inf.report_date DESC
     LIMIT 1`,
    [targetId]
  ) as {
    institution_name: string;
    total_assets: string;
    service_charge_income: string;
    fee_income_ratio: string | null;
    report_date: string;
  }[];

  if (!instRows.length) return null;
  const inst = instRows[0];

  const totalAssets = Number(inst.total_assets);
  const scIncome = Number(inst.service_charge_income);
  const feeRatio = inst.fee_income_ratio !== null ? Number(inst.fee_income_ratio) : null;

  // total_assets is in thousands for fdic/ncua rows; the tier breakpoints are in dollars.
  const tier = getTierForAssets(totalAssets * 1_000);
  const [tierMinDollars, tierMaxDollars] = FDIC_TIER_BREAKPOINTS[tier];
  const tierMin = tierMinDollars / 1_000;
  const tierMax = Number.isFinite(tierMaxDollars) ? tierMaxDollars / 1_000 : Number.MAX_SAFE_INTEGER;

  const statsRows = await sql.unsafe(
    `SELECT
       COUNT(DISTINCT inf.institution_id)::int AS peer_count,
       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY inf.service_charge_income) AS median_sc,
       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY inf.fee_income_ratio) AS median_fee_ratio
     FROM institution_financial_records inf
     WHERE inf.report_date = $1
       AND inf.total_assets >= $2 AND inf.total_assets < $3
       AND inf.service_charge_income > 0
       AND ${SAME_SCALE_SOURCES}`,
    [inst.report_date, tierMin, tierMax]
  ) as { peer_count: string; median_sc: string; median_fee_ratio: string | null }[];

  const rankRows = await sql.unsafe(
    `SELECT COUNT(*)::int AS better_count
     FROM institution_financial_records inf
     WHERE inf.report_date = $1
       AND inf.total_assets >= $2 AND inf.total_assets < $3
       AND inf.service_charge_income > $4
       AND ${SAME_SCALE_SOURCES}`,
    [inst.report_date, tierMin, tierMax, scIncome]
  ) as { better_count: string }[];

  const stats = statsRows[0];
  const peerCount = stats ? Number(stats.peer_count) : 0;
  // Same minimum sample as the fee statistics contract: no peer median from a handful.
  const enoughPeers = peerCount >= MIN_INSTITUTIONS_FOR_MEDIAN;
  const rank = rankRows[0] ? Number(rankRows[0].better_count) + 1 : peerCount;

  return {
    institution_name: inst.institution_name || null,
    tier,
    sc_income: scIncome,
    sc_rank: rank,
    peer_count: peerCount,
    peer_median_sc: enoughPeers && stats?.median_sc != null ? Number(stats.median_sc) : null,
    fee_income_ratio: feeRatio,
    peer_median_fee_ratio: enoughPeers && stats?.median_fee_ratio ? Number(stats.median_fee_ratio) : null,
  };
}

export interface DistrictFeeRevenue {
  fed_district: number;
  institution_count: number;
  total_sc_income: number;
  avg_sc_income: number;
  total_other_noninterest: number;
}

export async function getDistrictFeeRevenue(
  district: number,
  reportDate?: string
): Promise<DistrictFeeRevenue | null> {
  const sql = getSql();

  // Find latest report date if not specified
  let date: string;
  if (reportDate) {
    date = reportDate;
  } else {
    const [row] = await sql`
      SELECT MAX(report_date)::text AS latest_date
      FROM institution_financial_records
      WHERE service_charge_income > 0
    `;
    if (!row?.latest_date) return null;
    date = String(row.latest_date);
  }

  const rows = await sql.unsafe(
    `SELECT
       ct.fed_district,
       COUNT(DISTINCT inf.institution_id)::int  AS institution_count,
       COALESCE(SUM(inf.service_charge_income), 0)::bigint AS total_sc_income,
       COALESCE(AVG(inf.service_charge_income), 0)::bigint AS avg_sc_income,
       COALESCE(SUM(inf.other_noninterest_income), 0)::bigint AS total_other_noninterest
     FROM institution_financial_records inf
     JOIN institution_sources ct ON ct.id = inf.institution_id
     WHERE inf.report_date = $1
       AND ct.fed_district = $2
       AND inf.service_charge_income > 0
       AND ${SAME_SCALE_SOURCES}
     GROUP BY ct.fed_district`,
    [date, district]
  ) as {
    fed_district: string;
    institution_count: string;
    total_sc_income: string;
    avg_sc_income: string;
    total_other_noninterest: string;
  }[];

  if (rows.length === 0) return null;

  const r = rows[0];
  return {
    fed_district: Number(r.fed_district),
    institution_count: Number(r.institution_count),
    total_sc_income: Number(r.total_sc_income),
    avg_sc_income: Number(r.avg_sc_income),
    total_other_noninterest: Number(r.total_other_noninterest),
  };
}

export interface TierRevenue {
  tier: string;
  institution_count: number;
  total_sc_income: number;
  avg_sc_income: number;
}
export async function getRevenueByTier(
  reportDate?: string
): Promise<TierRevenue[]> {
  const sql = getSql();

  let date = reportDate;
  if (!date) {
    const [row] = await sql`
      SELECT MAX(report_date)::text AS latest_date
      FROM institution_financial_records
      WHERE service_charge_income > 0
    `;
    if (!row?.latest_date) return [];
    date = row.latest_date as string;
  }

  const rows = await sql.unsafe(
    `SELECT
       CASE
         WHEN inf.total_assets < 100000                THEN 'micro'
         WHEN inf.total_assets < 1000000               THEN 'community'
         WHEN inf.total_assets < 10000000              THEN 'midsize'
         WHEN inf.total_assets < 250000000             THEN 'regional'
         ELSE                                               'mega'
       END AS tier,
       COUNT(DISTINCT inf.institution_id)::int        AS institution_count,
       SUM(inf.service_charge_income)::bigint          AS total_sc_income,
       AVG(inf.service_charge_income)::bigint          AS avg_sc_income
     FROM institution_financial_records inf
     WHERE inf.report_date = $1
       AND inf.service_charge_income > 0
       AND inf.total_assets > 0
       AND ${SAME_SCALE_SOURCES}
     GROUP BY 1
     ORDER BY MIN(inf.total_assets)`,
    [date]
  ) as {
    tier: string;
    institution_count: string;
    total_sc_income: string;
    avg_sc_income: string;
  }[];

  return rows.map((r) => ({
    tier: r.tier,
    institution_count: Number(r.institution_count),
    total_sc_income: Number(r.total_sc_income),
    avg_sc_income: Number(r.avg_sc_income),
  }));
}
