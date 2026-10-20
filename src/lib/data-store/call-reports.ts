import { getSql } from "./connection";
import { readCallCohortHistory, type CallCohortHistory } from "@/lib/data-catalog/call-cohort-history";
import type { FinancialSource } from "./financial-sources";
import { financialSourceForCharter, financialPeerComparison, type FinancialPeerComparison } from "./financial-peer-contract";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "./fee-stats";
import { FDIC_TIER_BREAKPOINTS, getTierForAssets } from "../fed-districts";
import { institutionDisplayName } from "@/lib/institution-display-name";
import { dateText, historyRead } from "./call-report-sql";
import { callReportQuartersReady } from "./call-report-quarters";
import * as legacy from "./call-reports-legacy";
import * as summary from "./call-reports-summary";

/**
 * Call-report income readers. Each one reads call_report_quarterly_income, where every
 * filing's standalone quarter is computed once per quarterly load (call-report-quarters.ts),
 * and falls back to recomputing it from institution_financial_records per request
 * (call-reports-legacy.ts) only while that table is missing or empty. Both paths return the
 * same numbers (call-report-quarters.db.test.ts).
 */
export { PRIOR_QUARTER_JOIN, QUARTER_SC } from "./call-report-sql";

type Sql = ReturnType<typeof getSql>;
type Variant = typeof legacy;

/** The SQL set to use for this request: the summary table, or the per-request fallback. */
async function variant(sql: Sql): Promise<Variant> {
  return (await callReportQuartersReady(sql as never)) ? summary : legacy;
}

/** The newest filing date with positive income, in `source` or across both regulators. */
async function latestDate(sql: Sql, sqls: Variant, source?: FinancialSource): Promise<string | null> {
  const rows = source
    ? await sql.unsafe(sqls.latestScopedDateSql(source))
    : await sqls.latestAnyDate(sql as unknown as legacy.LatestDateSql);
  return dateText(rows[0]?.latest_date);
}

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
  cohort_history?: CallCohortHistory;
}

export interface PeerIncomeQuarter {
  quarter_end: string;
  /** Median quarterly deposit service charges among filers, in thousands. */
  median_thousands: number | null;
  institutions: number;
}

export interface PeerIncomeHistory {
  quarters: PeerIncomeQuarter[];
  cohort_history?: CallCohortHistory;
}

/**
 * Median quarterly deposit service charges for one charter and asset tier, newest quarter
 * first. NCUA year-to-date figures are split into quarters the same way as getRevenueTrend;
 * an institution counts in a quarter only when it reported positive income for it.
 */
export async function getPeerServiceChargeMedians(
  charterType: string,
  assetTier: string,
  quarterCount = 8,
  subjectId?: number,
): Promise<PeerIncomeHistory> {
  const source = financialSourceForCharter(charterType);
  if (!source) return { quarters: [] };
  const sql = getSql();
  const sqls = await variant(sql);
  const rows = (await sql.unsafe(
    sqls.peerMediansSql(source),
    [charterType, assetTier, quarterCount, MIN_INSTITUTIONS_FOR_MEDIAN],
  )) as { quarter_end: string; median_thousands: string | number | null; institutions: number; reporting_institution_ids?: (number | string)[] }[];
  return {
    quarters: rows.map((r) => ({
      quarter_end: r.quarter_end,
      median_thousands: Number(r.institutions) >= MIN_INSTITUTIONS_FOR_MEDIAN && r.median_thousands !== null ? Number(r.median_thousands) : null,
      institutions: Number(r.institutions),
    })),
    cohort_history: await readCallCohortHistory({ requestedIds: null, subjectId,
      eligibility_basis: "positive_standalone_quarter_income_current_registry_charter_and_size",
      periods: rows.map((r) => ({ period: r.quarter_end, sources: [source], unit: "thousands of dollars", period_basis: "standalone_quarter",
        institution_count: Number(r.institutions), reporting_institution_ids: r.reporting_institution_ids })) }, historyRead),
  };
}

export interface TopRevenueInstitution {
  cert_number: string;
  institution_name: string | null;
  charter_type: string;
  report_date: string;
  service_charge_income: number;
  total_assets: number | null;
}

/**
 * Quarterly service-charge income nationally, newest quarter first. NCUA 5300 income lines are
 * year-to-date: a credit union's quarter is its YTD minus the prior quarter's YTD in the same
 * year (Q1 stands alone); FDIC rows are already quarterly. Summing NCUA YTD as quarters inflated
 * Q2-Q4 credit union income up to 4x. Only the years the newest quarters fall in are read (plus
 * four spare quarters for a missing filing period).
 */
export async function getRevenueTrend(quarterCount = 8, source?: FinancialSource): Promise<RevenueTrend> {
  const sql = getSql();

  try {
    const sqls = await variant(sql);
    const rows = await sql.unsafe(sqls.revenueTrendSql(source), [quarterCount]) as {
      quarter: string;
      quarter_date: string;
      total_service_charges: string;
      total_institutions: string;
      bank_service_charges: string;
      cu_service_charges: string;
      bank_reporters?: string;
      cu_reporters?: string;
      bank_reporting_ids?: (number | string)[];
      cu_reporting_ids?: (number | string)[];
    }[];

    const snapshots: RevenueSnapshot[] = rows.map((row) => ({
      quarter: row.quarter,
      total_service_charges: Number(row.total_service_charges),
      total_institutions: Number(row.total_institutions),
      bank_service_charges: Number(row.bank_service_charges),
      cu_service_charges: Number(row.cu_service_charges),
      // No reviewed constant economic-cohort basis has been established.
      yoy_change_pct: null,
    }));

    // Cross-sectional arithmetic cannot establish growth of a stable economic cohort.
    // Equal charter IDs still do not account for acquisitions or other perimeter changes.
    const cohort_history = await readCallCohortHistory({ requestedIds: null,
      eligibility_basis: "positive_standalone_quarter_income",
      periods: rows.flatMap((row) => (["fdic", "ncua"] as const).filter((family) => source === undefined || source === family).map((family) => ({
        period: row.quarter_date, sources: [family], unit: "thousands of dollars", period_basis: "standalone_quarter",
        institution_count: Number((family === "fdic" ? row.bank_reporters : row.cu_reporters) ?? (source === family ? row.total_institutions : 0)),
        reporting_institution_ids: family === "fdic" ? row.bank_reporting_ids : row.cu_reporting_ids,
      }))) }, historyRead);

    return {
      quarters: snapshots,
      latest: snapshots[0] ?? null,
      cohort_history,
    };
  } catch {
    return { quarters: [], latest: null };
  }
}

export async function getTopRevenueInstitutions(
  limit = 10,
  source?: FinancialSource,
): Promise<TopRevenueInstitution[]> {
  const sql = getSql();

  try {
    const sqls = await variant(sql);
    const latest = await latestDate(sql, sqls, source);
    if (!latest) return [];

    const rows = await sql.unsafe(sqls.topRevenueSql(source), [latest, limit]) as {
      cert_number: string;
      institution_name: string | null;
      charter_type: string;
      report_date: string;
      service_charge_income: string;
      total_assets: string | null;
    }[];

    return rows.map((row) => ({
      cert_number: row.cert_number,
      institution_name: institutionDisplayName(row.institution_name),
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
  quarterCount = 8,
  source?: FinancialSource,
): Promise<InstitutionRevenueQuarter[]> {
  const sql = getSql();

  try {
    const sqls = await variant(sql);
    const rows = await sql.unsafe(
      sqls.institutionRevenueTrendSql(source),
      [targetId, quarterCount],
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
  /** The same-source, same-charter, same-date comparison used for every rank and median. */
  comparison?: FinancialPeerComparison;
}

export async function getInstitutionPeerRanking(
  targetId: number
): Promise<PeerRanking | null> {
  const sql = getSql();
  const sqls = await variant(sql);
  const instRows = await sql.unsafe(sqls.PEER_SUBJECT_SQL, [targetId]) as {
    institution_name: string;
    charter_type: string;
    source: string;
    total_assets: string;
    service_charge_income: string;
    fee_income_ratio: string | null;
    report_date: string;
  }[];
  const inst = instRows[0];
  if (!inst) return null;
  const source = financialSourceForCharter(inst.charter_type);
  // Fail closed even if a fixture, alternate connection or future SQL edit returns a mismatch.
  if (!source || inst.source !== source || !/^\d{4}-\d{2}-\d{2}$/.test(inst.report_date)) return null;
  const totalAssets = Number(inst.total_assets);
  const scIncome = Number(inst.service_charge_income);
  if (!Number.isFinite(totalAssets) || totalAssets <= 0 || !Number.isFinite(scIncome) || scIncome <= 0) return null;
  const feeRatio = inst.fee_income_ratio !== null && Number.isFinite(Number(inst.fee_income_ratio)) ? Number(inst.fee_income_ratio) : null;

  // Preserve the existing numeric asset cohort, with its exact dollar boundaries exposed.
  const tier = getTierForAssets(totalAssets * 1_000);
  const [tierMinDollars, tierMaxDollars] = FDIC_TIER_BREAKPOINTS[tier];
  const tierMin = tierMinDollars / 1_000;
  const tierMax = Number.isFinite(tierMaxDollars) ? tierMaxDollars / 1_000 : Number.MAX_SAFE_INTEGER;
  const parameters = [inst.report_date, tierMin, tierMax, inst.charter_type, source];
  const statsRows = await sql.unsafe(sqls.PEER_STATS_SQL, parameters) as {
    eligible_count: string; peer_count: string; ratio_reported_count: string;
    median_sc: string | null; median_fee_ratio: string | null;
  }[];
  const rankRows = await sql.unsafe(sqls.PEER_RANK_SQL, [...parameters, scIncome]) as { better_count: string }[];
  const stats = statsRows[0];
  const peerCount = Number(stats?.peer_count ?? 0);
  const ratioCount = Number(stats?.ratio_reported_count ?? 0);
  const enoughPeers = peerCount >= MIN_INSTITUTIONS_FOR_MEDIAN;
  const enoughRatios = ratioCount >= MIN_INSTITUTIONS_FOR_MEDIAN;
  return {
    institution_name: inst.institution_name || null,
    tier,
    sc_income: scIncome,
    sc_rank: Number(rankRows[0]?.better_count ?? 0) + 1,
    peer_count: peerCount,
    peer_median_sc: enoughPeers && stats?.median_sc != null ? Number(stats.median_sc) : null,
    fee_income_ratio: feeRatio,
    peer_median_fee_ratio: enoughRatios && stats?.median_fee_ratio != null ? Number(stats.median_fee_ratio) : null,
    comparison: financialPeerComparison({
      source, reportDate: inst.report_date, tier,
      minimumAssetsUsd: tierMinDollars, maximumAssetsUsd: tierMaxDollars,
      subjectIncluded: true,
      eligibleCount: Number(stats?.eligible_count ?? 0),
      reportedCount: peerCount, ratioReportedCount: ratioCount,
      minimumMedianCount: MIN_INSTITUTIONS_FOR_MEDIAN,
    }),
  };
}

export interface DistrictIncomeQuarter {
  quarter: string;
  fed_district: number;
  /** Quarterly deposit service-charge income, in thousands. */
  total_service_charges: number;
  institutions: number;
}

/**
 * Quarterly service-charge income by Fed district, newest quarter first, for the last
 * `quarterCount` quarters. NCUA year-to-date figures are split into quarters the same
 * way as getRevenueTrend; only positive quarterly income counts.
 */
export async function getDistrictIncomeTrend(quarterCount = 20, source?: FinancialSource): Promise<DistrictIncomeQuarter[]> {
  const sql = getSql();
  try {
    const sqls = await variant(sql);
    const rows = await sql.unsafe(sqls.districtIncomeTrendSql(source), [quarterCount]) as {
      quarter: string; fed_district: string | number; total_service_charges: string; institutions: string;
    }[];
    return rows.map((r) => ({
      quarter: r.quarter,
      fed_district: Number(r.fed_district),
      total_service_charges: Number(r.total_service_charges),
      institutions: Number(r.institutions),
    }));
  } catch {
    return [];
  }
}

export interface DistrictFeeRevenue {
  fed_district: number;
  /** The filing date every figure comes from (the newest one with income, unless one was asked for). */
  report_date: string;
  /** Present when the read was scoped to one regulator; unscoped reads pool unlike measures. */
  source?: FinancialSource;
  /** Institutions with positive single-quarter income at report_date. */
  institution_count: number;
  total_sc_income: number;
  avg_sc_income: number;
  total_other_noninterest: number;
}

export async function getDistrictFeeRevenue(
  district: number,
  reportDate?: string,
  source?: FinancialSource,
): Promise<DistrictFeeRevenue | null> {
  const sql = getSql();
  const sqls = await variant(sql);

  // Find latest report date if not specified
  const date = reportDate || await latestDate(sql, sqls, source);
  if (!date) return null;

  const rows = await sql.unsafe(sqls.districtFeeRevenueSql(source), [date, district]) as {
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
    report_date: date,
    ...(source ? { source } : {}),
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
  reportDate?: string,
  source?: FinancialSource,
): Promise<TierRevenue[]> {
  const sql = getSql();
  const sqls = await variant(sql);

  const date = reportDate || await latestDate(sql, sqls, source);
  if (!date) return [];

  const rows = await sql.unsafe(sqls.revenueByTierSql(source), [date]) as {
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

export interface IntensityQuarter {
  quarterEnd: string;
  /** The quarter's deposit service charges, annualized, per $1,000 of deposits at quarter end. */
  own: number | null;
  peerMedian: number | null;
  peers: number;
}

/**
 * The same measure quarter by quarter over the last two years, for the trend chart: each
 * quarter's service charges times four per $1,000 of that quarter's deposits, for the
 * institution and the median of its charter and asset tier (the subject excluded).
 */
export async function getServiceChargeIntensityTrend(institutionId: number): Promise<IntensityQuarter[]> {
  const sql = getSql();
  const sqls = await variant(sql);
  const rows = (await sql.unsafe(
    `WITH ${sqls.INTENSITY_QUARTERS_SQL},
     latest AS (SELECT MAX(rd) AS rd FROM quarterly),
     qratio AS (
       SELECT q.institution_id, q.rd, q.income * 4000.0 / q.deposits AS r
         FROM quarterly q, latest l
        WHERE q.income > 0 AND q.deposits > 0 AND q.rd > l.rd - INTERVAL '2 years'
     )
     SELECT TO_CHAR(rd, 'YYYY-MM-DD') AS quarter_end,
            MAX(r) FILTER (WHERE institution_id = (SELECT id FROM subject)) AS own,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY r) FILTER (WHERE institution_id <> (SELECT id FROM subject)) AS peer_median,
            (COUNT(*) FILTER (WHERE institution_id <> (SELECT id FROM subject)))::int AS peers
       FROM qratio
      GROUP BY rd
      ORDER BY rd`,
    [institutionId],
  )) as { quarter_end: string; own: string | number | null; peer_median: string | number | null; peers: number }[];
  const num = (v: string | number | null) => (v === null ? null : Number(v));
  return rows.map((r) => ({ quarterEnd: r.quarter_end, own: num(r.own), peerMedian: Number(r.peers) >= MIN_INSTITUTIONS_FOR_MEDIAN ? num(r.peer_median) : null, peers: Number(r.peers) }));
}

export interface ServiceChargeIntensity {
  quarterEnd: string;
  /** Deposit service charges over the last four quarters per $1,000 of deposits at the latest quarter. */
  own: number | null;
  peerMedian: number | null;
  /** Filers of the same charter and asset tier with all four quarters on file, the subject excluded. */
  peers: number;
  /** Peers below the subject, for its percentile. */
  peersBelow: number;
  charterType: string;
  assetTier: string;
}

/**
 * One institution's deposit service charge income scaled by its deposits, beside the median of
 * its charter and asset tier: the income side of the "why" split. Trailing four quarters, NCUA
 * year-to-date lines split into quarters as in getPeerServiceChargeMedians.
 */
export async function getServiceChargeIntensity(institutionId: number): Promise<ServiceChargeIntensity | null> {
  const sql = getSql();
  const sqls = await variant(sql);
  const rows = (await sql.unsafe(
    `WITH ${sqls.INTENSITY_QUARTERS_SQL},
     latest AS (SELECT MAX(rd) AS rd FROM quarterly),
     ttm AS (
       SELECT q.institution_id,
              SUM(q.income) AS income,
              COUNT(q.income) AS quarters,
              MAX(q.deposits) FILTER (WHERE q.rd = l.rd) AS deposits
         FROM quarterly q, latest l
        WHERE q.rd > l.rd - INTERVAL '1 year'
        GROUP BY q.institution_id
     ),
     ratio AS (
       SELECT institution_id, income * 1000.0 / deposits AS r
         FROM ttm WHERE quarters = 4 AND income > 0 AND deposits > 0
     )
     SELECT TO_CHAR((SELECT rd FROM latest), 'YYYY-MM-DD') AS quarter_end,
            s.charter_type,
            s.asset_size_tier,
            (SELECT r FROM ratio WHERE institution_id = s.id) AS own,
            (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY r) FROM ratio WHERE institution_id <> s.id) AS peer_median,
            (SELECT COUNT(*)::int FROM ratio WHERE institution_id <> s.id) AS peers,
            (SELECT COUNT(*)::int FROM ratio p WHERE p.institution_id <> s.id
                AND p.r < (SELECT r FROM ratio WHERE institution_id = s.id)) AS peers_below
       FROM subject s`,
    [institutionId],
  )) as {
    quarter_end: string | null;
    charter_type: string;
    asset_size_tier: string;
    own: string | number | null;
    peer_median: string | number | null;
    peers: number;
    peers_below: number;
  }[];
  const r = rows[0];
  if (!r || !r.quarter_end) return null;
  const num = (v: string | number | null) => (v === null ? null : Number(v));
  return {
    quarterEnd: r.quarter_end,
    own: num(r.own),
    peerMedian: r.peers >= MIN_INSTITUTIONS_FOR_MEDIAN ? num(r.peer_median) : null,
    peers: Number(r.peers),
    peersBelow: Number(r.peers_below),
    charterType: r.charter_type,
    assetTier: r.asset_size_tier,
  };
}
