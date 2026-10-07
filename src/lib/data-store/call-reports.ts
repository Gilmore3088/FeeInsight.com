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

/**
 * NCUA 5300 income lines are year-to-date; FDIC rows are already quarterly. Single-quarter
 * reads join each NCUA row to the same credit union's prior quarter in the same year
 * (`prev`), and QUARTER_SC is that quarter's own service-charge income: the YTD minus the
 * prior YTD (Q1 stands alone), or NULL when the prior quarter is missing. Reading the raw
 * YTD as a quarter doubled Q2 credit-union income (Q2 2026: $5.16B YTD vs $2.64B in the quarter).
 */
const PRIOR_QUARTER_JOIN = `LEFT JOIN institution_financial_records prev
       ON inf.source = 'ncua'
      AND prev.institution_id = inf.institution_id
      AND prev.source = inf.source
      AND EXTRACT(QUARTER FROM inf.report_date::date) > 1
      AND prev.report_date = TO_CHAR(DATE_TRUNC('quarter', inf.report_date::date)::date - 1, 'YYYY-MM-DD')`;
const QUARTER_SC = `(CASE
       WHEN inf.source <> 'ncua' OR EXTRACT(QUARTER FROM inf.report_date::date) = 1 THEN inf.service_charge_income
       WHEN prev.service_charge_income IS NOT NULL THEN inf.service_charge_income - prev.service_charge_income
     END)`;

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

export interface PeerIncomeQuarter {
  quarter_end: string;
  /** Median quarterly deposit service charges among filers, in thousands. */
  median_thousands: number;
  institutions: number;
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
): Promise<PeerIncomeQuarter[]> {
  const sql = getSql();
  const rows = (await sql.unsafe(
    `WITH filed AS (
       SELECT inf.institution_id,
              inf.source,
              inf.report_date::date AS rd,
              inf.service_charge_income AS amount,
              LAG(inf.service_charge_income) OVER w AS prior_amount,
              LAG(inf.report_date::date) OVER w AS prior_rd
         FROM institution_financial_records inf
         JOIN institution_sources ct ON ct.id = inf.institution_id
        WHERE ${SAME_SCALE_SOURCES}
          AND ct.charter_type = $1
          AND ct.asset_size_tier = $2
       WINDOW w AS (PARTITION BY inf.institution_id, inf.source, EXTRACT(YEAR FROM inf.report_date::date)
                    ORDER BY inf.report_date::date)
     ),
     quarterly AS (
       SELECT rd,
              CASE
                WHEN source <> 'ncua' OR EXTRACT(QUARTER FROM rd) = 1 THEN amount
                WHEN prior_rd IS NOT NULL AND rd - prior_rd BETWEEN 80 AND 100 THEN amount - prior_amount
                ELSE NULL
              END AS income
         FROM filed
     )
     SELECT TO_CHAR(rd, 'YYYY-MM-DD') AS quarter_end,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY income) AS median_thousands,
            COUNT(*)::int AS institutions
       FROM quarterly
      WHERE income > 0
      GROUP BY rd
      ORDER BY rd DESC
      LIMIT $3`,
    [charterType, assetTier, quarterCount],
  )) as { quarter_end: string; median_thousands: string | number; institutions: number }[];
  return rows.map((r) => ({
    quarter_end: r.quarter_end,
    median_thousands: Number(r.median_thousands),
    institutions: Number(r.institutions),
  }));
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
  // NCUA 5300 income lines are year-to-date: a credit union's quarter is its YTD minus
  // the prior quarter's YTD in the same year (Q1 stands alone). FDIC rows are already
  // quarterly. Summing NCUA YTD as quarters inflated Q2-Q4 credit union income up to 4x.
  const rows = await sql.unsafe(
    `WITH filed AS (
       SELECT inf.institution_id,
              inf.source,
              inf.report_date,
              inf.report_date::date AS rd,
              inf.service_charge_income AS amount,
              LAG(inf.service_charge_income) OVER w AS prior_amount,
              LAG(inf.report_date::date) OVER w AS prior_rd
         FROM institution_financial_records inf
        WHERE ${SAME_SCALE_SOURCES}
       WINDOW w AS (PARTITION BY inf.institution_id, inf.source, EXTRACT(YEAR FROM inf.report_date::date)
                    ORDER BY inf.report_date::date)
     ),
     quarterly AS (
       SELECT institution_id, report_date, rd,
              CASE
                WHEN source <> 'ncua' OR EXTRACT(QUARTER FROM rd) = 1 THEN amount
                WHEN prior_rd IS NOT NULL AND rd - prior_rd BETWEEN 80 AND 100 THEN amount - prior_amount
                ELSE NULL
              END AS service_charge_income
         FROM filed
     )
     SELECT
       TO_CHAR(DATE_TRUNC('quarter', inf.rd), 'YYYY-"Q"Q')       AS quarter,
       MIN(inf.report_date)                                     AS quarter_date,
       SUM(inf.service_charge_income)                           AS total_service_charges,
       COUNT(DISTINCT ct.cert_number)                           AS total_institutions,
       SUM(CASE WHEN ct.charter_type = 'bank' THEN inf.service_charge_income ELSE 0 END)
                                                                 AS bank_service_charges,
       SUM(CASE WHEN ct.charter_type = 'credit_union' THEN inf.service_charge_income ELSE 0 END)
                                                                 AS cu_service_charges
     FROM quarterly inf
     JOIN institution_sources ct ON ct.id = inf.institution_id
     WHERE inf.service_charge_income > 0
     GROUP BY DATE_TRUNC('quarter', inf.rd)
     ORDER BY DATE_TRUNC('quarter', inf.rd) DESC
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
         ${QUARTER_SC}                                           AS service_charge_income,
         inf.total_assets
       FROM institution_financial_records inf
       JOIN institution_sources ct ON ct.id = inf.institution_id
       ${PRIOR_QUARTER_JOIN}
       WHERE inf.report_date = $1
         AND ${QUARTER_SC} > 0
         AND ${SAME_SCALE_SOURCES}
       ORDER BY ${QUARTER_SC} DESC
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
           ${QUARTER_SC} AS service_charge_income,
           inf.fee_income_ratio,
           ROW_NUMBER() OVER (
             PARTITION BY DATE_TRUNC('quarter', inf.report_date::date)
             ORDER BY inf.report_date::date DESC, inf.id DESC
           ) AS quarter_rank
         FROM institution_financial_records inf
         ${PRIOR_QUARTER_JOIN}
         WHERE inf.institution_id = $1
           AND ${QUARTER_SC} IS NOT NULL
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
    `SELECT ct.institution_name, inf.total_assets, ${QUARTER_SC} AS service_charge_income,
            inf.fee_income_ratio, inf.report_date
     FROM institution_financial_records inf
     JOIN institution_sources ct ON ct.id = inf.institution_id
     ${PRIOR_QUARTER_JOIN}
     WHERE inf.institution_id = $1
       AND ${QUARTER_SC} IS NOT NULL
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
       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${QUARTER_SC}) AS median_sc,
       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY inf.fee_income_ratio) AS median_fee_ratio
     FROM institution_financial_records inf
     ${PRIOR_QUARTER_JOIN}
     WHERE inf.report_date = $1
       AND inf.total_assets >= $2 AND inf.total_assets < $3
       AND ${QUARTER_SC} > 0
       AND ${SAME_SCALE_SOURCES}`,
    [inst.report_date, tierMin, tierMax]
  ) as { peer_count: string; median_sc: string; median_fee_ratio: string | null }[];

  const rankRows = await sql.unsafe(
    `SELECT COUNT(*)::int AS better_count
     FROM institution_financial_records inf
     ${PRIOR_QUARTER_JOIN}
     WHERE inf.report_date = $1
       AND inf.total_assets >= $2 AND inf.total_assets < $3
       AND ${QUARTER_SC} > $4
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
export async function getDistrictIncomeTrend(quarterCount = 20): Promise<DistrictIncomeQuarter[]> {
  const sql = getSql();
  try {
    const rows = await sql.unsafe(
      `WITH filed AS (
         SELECT inf.institution_id,
                inf.source,
                inf.report_date::date AS rd,
                inf.service_charge_income AS amount,
                LAG(inf.service_charge_income) OVER w AS prior_amount,
                LAG(inf.report_date::date) OVER w AS prior_rd
           FROM institution_financial_records inf
          WHERE ${SAME_SCALE_SOURCES}
         WINDOW w AS (PARTITION BY inf.institution_id, inf.source, EXTRACT(YEAR FROM inf.report_date::date)
                      ORDER BY inf.report_date::date)
       ),
       quarterly AS (
         SELECT institution_id, rd,
                CASE
                  WHEN source <> 'ncua' OR EXTRACT(QUARTER FROM rd) = 1 THEN amount
                  WHEN prior_rd IS NOT NULL AND rd - prior_rd BETWEEN 80 AND 100 THEN amount - prior_amount
                  ELSE NULL
                END AS income
           FROM filed
       ),
       recent AS (
         SELECT DISTINCT DATE_TRUNC('quarter', rd) AS q FROM quarterly ORDER BY 1 DESC LIMIT $1
       )
       SELECT TO_CHAR(DATE_TRUNC('quarter', q.rd), 'YYYY-"Q"Q') AS quarter,
              ct.fed_district,
              SUM(q.income) AS total_service_charges,
              COUNT(DISTINCT q.institution_id) AS institutions
         FROM quarterly q
         JOIN institution_sources ct ON ct.id = q.institution_id
        WHERE q.income > 0
          AND ct.fed_district IS NOT NULL
          AND DATE_TRUNC('quarter', q.rd) IN (SELECT q FROM recent)
        GROUP BY 1, 2
        ORDER BY 1 DESC, 2`,
      [quarterCount],
    ) as { quarter: string; fed_district: string | number; total_service_charges: string; institutions: string }[];
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
       COALESCE(SUM(${QUARTER_SC}), 0)::bigint AS total_sc_income,
       COALESCE(AVG(${QUARTER_SC}), 0)::bigint AS avg_sc_income,
       COALESCE(SUM(inf.other_noninterest_income), 0)::bigint AS total_other_noninterest
     FROM institution_financial_records inf
     JOIN institution_sources ct ON ct.id = inf.institution_id
     ${PRIOR_QUARTER_JOIN}
     WHERE inf.report_date = $1
       AND ct.fed_district = $2
       AND ${QUARTER_SC} > 0
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
       SUM(${QUARTER_SC})::bigint                      AS total_sc_income,
       AVG(${QUARTER_SC})::bigint                      AS avg_sc_income
     FROM institution_financial_records inf
     ${PRIOR_QUARTER_JOIN}
     WHERE inf.report_date = $1
       AND ${QUARTER_SC} > 0
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
  const rows = (await sql.unsafe(
    `WITH subject AS (
       SELECT id, charter_type, asset_size_tier FROM institution_sources
        WHERE id = $1 AND charter_type IS NOT NULL AND asset_size_tier IS NOT NULL
     ),
     filed AS (
       SELECT inf.institution_id,
              inf.source,
              inf.report_date::date AS rd,
              inf.service_charge_income AS amount,
              inf.total_deposits AS deposits,
              LAG(inf.service_charge_income) OVER w AS prior_amount,
              LAG(inf.report_date::date) OVER w AS prior_rd
         FROM institution_financial_records inf
         JOIN institution_sources ct ON ct.id = inf.institution_id
         JOIN subject s ON ct.charter_type = s.charter_type AND ct.asset_size_tier = s.asset_size_tier
        WHERE ${SAME_SCALE_SOURCES}
          AND inf.report_date::date >= CURRENT_DATE - INTERVAL '30 months'
       WINDOW w AS (PARTITION BY inf.institution_id, inf.source, EXTRACT(YEAR FROM inf.report_date::date)
                    ORDER BY inf.report_date::date)
     ),
     quarterly AS (
       SELECT institution_id, rd, deposits,
              CASE
                WHEN source <> 'ncua' OR EXTRACT(QUARTER FROM rd) = 1 THEN amount
                WHEN prior_rd IS NOT NULL AND rd - prior_rd BETWEEN 80 AND 100 THEN amount - prior_amount
                ELSE NULL
              END AS income
         FROM filed
     ),
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
