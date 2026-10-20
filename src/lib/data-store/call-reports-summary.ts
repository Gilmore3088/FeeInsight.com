import { MAX_COHORT_REPORTERS } from "@/lib/data-catalog/call-cohort-history";
import type { FinancialSource } from "./financial-sources";
import type { LatestDateSql } from "./call-reports-legacy";
import { COMPARABLE_CHARTER_SOURCE, SAME_SCALE_SOURCES, sourceScope } from "./call-report-sql";

/**
 * The call-report readers' SQL over call_report_quarterly_income, where each filing's
 * standalone quarter is already split out (call-report-quarters.ts). Each function is the twin
 * of the same-named one in call-reports-legacy.ts: same parameters, same columns, same numbers
 * (proved in call-report-quarters.db.test.ts).
 *
 * Column map from the legacy SQL: inf.report_date::date -> report_day,
 * DATE_TRUNC('quarter', ...) -> quarter_start, inf.id -> record_id, the window rule's income ->
 * quarter_income, QUARTER_SC (the exact prior-quarter-end rule) -> prior_quarter_end_income,
 * service_charge_income as filed -> filed_service_charge_income.
 */
const Q = "call_report_quarterly_income";

export function latestScopedDateSql(source: FinancialSource): string {
  return `SELECT inf.report_date AS latest_date
       FROM ${Q} inf
       JOIN institution_sources ct ON ct.id = inf.institution_id
      WHERE inf.filed_service_charge_income > 0 AND ${SAME_SCALE_SOURCES}
        AND ${COMPARABLE_CHARTER_SOURCE} AND ${sourceScope(source)}
      ORDER BY inf.report_date DESC LIMIT 1`;
}

/** Unmatched filings (institution_id null) are stored too, so this matches the legacy MAX. */
export function latestAnyDate(sql: LatestDateSql): Promise<ReadonlyArray<{ latest_date?: unknown }>> {
  return sql.unsafe(`SELECT MAX(report_date)::text AS latest_date
      FROM ${Q}
      WHERE filed_service_charge_income > 0
        AND source IN ('fdic', 'ncua')`) as Promise<ReadonlyArray<{ latest_date?: unknown }>>;
}

export function peerMediansSql(source: FinancialSource): string {
  return `SELECT TO_CHAR(inf.report_day, 'YYYY-MM-DD') AS quarter_end,
            CASE WHEN COUNT(*) >= $4 THEN PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY inf.quarter_income) END AS median_thousands,
            COUNT(*)::int AS institutions,
            (ARRAY_AGG(DISTINCT inf.institution_id ORDER BY inf.institution_id))[1:${MAX_COHORT_REPORTERS}] AS reporting_institution_ids
       FROM ${Q} inf
       JOIN institution_sources ct ON ct.id = inf.institution_id
      WHERE ${SAME_SCALE_SOURCES}
        AND ct.charter_type = $1
        AND ct.asset_size_tier = $2
        AND ${COMPARABLE_CHARTER_SOURCE} AND ${sourceScope(source)}
        AND inf.quarter_income > 0
      GROUP BY inf.report_day
      ORDER BY inf.report_day DESC
      LIMIT $3`;
}

export function revenueTrendSql(source?: FinancialSource): string {
  return `WITH bounds AS (
       SELECT TO_CHAR(DATE_TRUNC('year', MAX(inf.report_date)::date - MAKE_INTERVAL(months => 3 * ($1::int + 4))),
                      'YYYY-MM-DD') AS from_date
         FROM ${Q} inf
         JOIN institution_sources ct ON ct.id = inf.institution_id
        WHERE ${SAME_SCALE_SOURCES} AND ${COMPARABLE_CHARTER_SOURCE} AND ${sourceScope(source)}
     )
     SELECT
       TO_CHAR(inf.quarter_start, 'YYYY-"Q"Q')                  AS quarter,
       MIN(inf.report_date)                                     AS quarter_date,
       SUM(inf.quarter_income)                                  AS total_service_charges,
       COUNT(DISTINCT ct.id)                                    AS total_institutions,
       SUM(CASE WHEN ct.charter_type = 'bank' THEN inf.quarter_income ELSE 0 END)
                                                                 AS bank_service_charges,
       SUM(CASE WHEN ct.charter_type = 'credit_union' THEN inf.quarter_income ELSE 0 END)
                                                                 AS cu_service_charges,
       COUNT(DISTINCT inf.institution_id) FILTER (WHERE inf.source = 'fdic') AS bank_reporters,
       COUNT(DISTINCT inf.institution_id) FILTER (WHERE inf.source = 'ncua') AS cu_reporters,
       (ARRAY_AGG(DISTINCT inf.institution_id ORDER BY inf.institution_id) FILTER (WHERE inf.source = 'fdic'))[1:${MAX_COHORT_REPORTERS}] AS bank_reporting_ids,
       (ARRAY_AGG(DISTINCT inf.institution_id ORDER BY inf.institution_id) FILTER (WHERE inf.source = 'ncua'))[1:${MAX_COHORT_REPORTERS}] AS cu_reporting_ids
     FROM ${Q} inf
     JOIN institution_sources ct ON ct.id = inf.institution_id
     CROSS JOIN bounds
     WHERE ${SAME_SCALE_SOURCES} AND ${COMPARABLE_CHARTER_SOURCE} AND ${sourceScope(source)}
       AND inf.report_date >= bounds.from_date
       AND inf.quarter_income > 0
     GROUP BY inf.quarter_start
     ORDER BY inf.quarter_start DESC
     LIMIT $1`;
}

export function topRevenueSql(source?: FinancialSource): string {
  return `SELECT
         ct.cert_number,
         ct.institution_name,
         COALESCE(ct.charter_type, 'unknown') AS charter_type,
         inf.report_date                                         AS report_date,
         inf.prior_quarter_end_income                            AS service_charge_income,
         inf.total_assets
       FROM ${Q} inf
       JOIN institution_sources ct ON ct.id = inf.institution_id
       WHERE inf.report_date = $1
         AND inf.prior_quarter_end_income > 0
         AND ${SAME_SCALE_SOURCES}
         AND ${COMPARABLE_CHARTER_SOURCE} AND ${sourceScope(source)}
       ORDER BY inf.prior_quarter_end_income DESC
       LIMIT $2`;
}

export function institutionRevenueTrendSql(source?: FinancialSource): string {
  return `SELECT
         quarter,
         service_charge_income,
         fee_income_ratio
       FROM (
         SELECT
           TO_CHAR(inf.quarter_start, 'YYYY-"Q"Q') AS quarter,
           inf.report_day AS report_date,
           inf.prior_quarter_end_income AS service_charge_income,
           inf.fee_income_ratio,
           ROW_NUMBER() OVER (
             PARTITION BY inf.quarter_start
             ORDER BY inf.report_day DESC, inf.record_id DESC
           ) AS quarter_rank
         FROM ${Q} inf
         JOIN institution_sources ct ON ct.id = inf.institution_id
         WHERE inf.institution_id = $1
           AND inf.prior_quarter_end_income IS NOT NULL
           AND ${SAME_SCALE_SOURCES}
           AND ${COMPARABLE_CHARTER_SOURCE} AND ${sourceScope(source)}
       ) ranked
       WHERE quarter_rank = 1
       ORDER BY report_date DESC
       LIMIT $2`;
}

export const PEER_SUBJECT_SQL: string = `SELECT ct.institution_name, ct.charter_type, inf.source, inf.total_assets,
            inf.prior_quarter_end_income AS service_charge_income, inf.fee_income_ratio, inf.report_date
       FROM ${Q} inf
       JOIN institution_sources ct ON ct.id = inf.institution_id
      WHERE inf.institution_id = $1
        AND ${SAME_SCALE_SOURCES} AND ${COMPARABLE_CHARTER_SOURCE}
      ORDER BY inf.report_date DESC, inf.record_id DESC
      LIMIT 1`;

const PEER_SCOPE = `inf.report_date = $1
        AND inf.total_assets >= $2 AND inf.total_assets < $3
        AND ct.charter_type = $4 AND inf.source = $5`;
const SC = "inf.prior_quarter_end_income";

export const PEER_STATS_SQL: string = `SELECT COUNT(DISTINCT inf.institution_id)::int AS eligible_count,
            COUNT(DISTINCT inf.institution_id) FILTER (WHERE ${SC} > 0)::int AS peer_count,
            COUNT(DISTINCT inf.institution_id) FILTER (WHERE ${SC} > 0 AND inf.fee_income_ratio IS NOT NULL)::int AS ratio_reported_count,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${SC}) FILTER (WHERE ${SC} > 0) AS median_sc,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY inf.fee_income_ratio) FILTER (WHERE ${SC} > 0 AND inf.fee_income_ratio IS NOT NULL) AS median_fee_ratio
       FROM ${Q} inf
       JOIN institution_sources ct ON ct.id = inf.institution_id
      WHERE ${PEER_SCOPE} AND ${SAME_SCALE_SOURCES} AND ${COMPARABLE_CHARTER_SOURCE}`;

export const PEER_RANK_SQL: string = `SELECT COUNT(DISTINCT inf.institution_id)::int AS better_count
       FROM ${Q} inf
       JOIN institution_sources ct ON ct.id = inf.institution_id
      WHERE ${PEER_SCOPE} AND ${SAME_SCALE_SOURCES} AND ${COMPARABLE_CHARTER_SOURCE}
        AND ${SC} > $6`;

export function districtIncomeTrendSql(source?: FinancialSource): string {
  return `WITH quarterly AS (
         SELECT inf.institution_id, inf.quarter_start, inf.quarter_income AS income
           FROM ${Q} inf
           JOIN institution_sources ct ON ct.id = inf.institution_id
          WHERE ${SAME_SCALE_SOURCES} AND ${COMPARABLE_CHARTER_SOURCE} AND ${sourceScope(source)}
       ),
       recent AS (
         SELECT DISTINCT quarter_start AS q FROM quarterly ORDER BY 1 DESC LIMIT $1
       )
       SELECT TO_CHAR(q.quarter_start, 'YYYY-"Q"Q') AS quarter,
              ct.fed_district,
              SUM(q.income) AS total_service_charges,
              COUNT(DISTINCT q.institution_id) AS institutions
         FROM quarterly q
         JOIN institution_sources ct ON ct.id = q.institution_id
        WHERE q.income > 0
          AND ct.fed_district IS NOT NULL
          AND q.quarter_start IN (SELECT q FROM recent)
        GROUP BY 1, 2
        ORDER BY 1 DESC, 2`;
}

export function districtFeeRevenueSql(source?: FinancialSource): string {
  return `SELECT
       ct.fed_district,
       COUNT(DISTINCT inf.institution_id)::int  AS institution_count,
       COALESCE(SUM(${SC}), 0)::bigint AS total_sc_income,
       COALESCE(AVG(${SC}), 0)::bigint AS avg_sc_income,
       COALESCE(SUM(inf.other_noninterest_income), 0)::bigint AS total_other_noninterest
     FROM ${Q} inf
     JOIN institution_sources ct ON ct.id = inf.institution_id
     WHERE inf.report_date = $1
       AND ct.fed_district = $2
       AND ${SC} > 0
       AND ${SAME_SCALE_SOURCES}
       AND ${COMPARABLE_CHARTER_SOURCE} AND ${sourceScope(source)}
     GROUP BY ct.fed_district`;
}

export function revenueByTierSql(source?: FinancialSource): string {
  return `SELECT
       CASE
         WHEN inf.total_assets < 100000                THEN 'micro'
         WHEN inf.total_assets < 1000000               THEN 'community'
         WHEN inf.total_assets < 10000000              THEN 'midsize'
         WHEN inf.total_assets < 250000000             THEN 'regional'
         ELSE                                               'mega'
       END AS tier,
       COUNT(DISTINCT inf.institution_id)::int        AS institution_count,
       SUM(${SC})::bigint                              AS total_sc_income,
       AVG(${SC})::bigint                              AS avg_sc_income
     FROM ${Q} inf
     JOIN institution_sources ct ON ct.id = inf.institution_id
     WHERE inf.report_date = $1
       AND ${SC} > 0
       AND inf.total_assets > 0
       AND ${SAME_SCALE_SOURCES}
       AND ${COMPARABLE_CHARTER_SOURCE} AND ${sourceScope(source)}
     GROUP BY 1
     ORDER BY MIN(inf.total_assets)`;
}

/**
 * The legacy intensity reads ran the year-to-date split over only the last 30 months of
 * filings, so an NCUA quarter whose previous filing fell before that cutoff had no income. The
 * stored prior_report_day reproduces exactly that: such a quarter reads as null here too.
 */
export const INTENSITY_QUARTERS_SQL: string = `subject AS (
       SELECT id, charter_type, asset_size_tier FROM institution_sources
        WHERE id = $1 AND charter_type IN ('bank', 'credit_union') AND asset_size_tier IS NOT NULL
     ),
     quarterly AS (
       SELECT inf.institution_id,
              inf.report_day AS rd,
              inf.total_deposits AS deposits,
              CASE
                WHEN inf.source = 'ncua' AND EXTRACT(QUARTER FROM inf.report_day) > 1
                     AND inf.prior_report_day < CURRENT_DATE - INTERVAL '30 months' THEN NULL
                ELSE inf.quarter_income
              END AS income
         FROM ${Q} inf
         JOIN institution_sources ct ON ct.id = inf.institution_id
         JOIN subject s ON ct.charter_type = s.charter_type AND ct.asset_size_tier = s.asset_size_tier
        WHERE ${SAME_SCALE_SOURCES} AND ${COMPARABLE_CHARTER_SOURCE}
          AND inf.report_day >= CURRENT_DATE - INTERVAL '30 months'
     )`;
