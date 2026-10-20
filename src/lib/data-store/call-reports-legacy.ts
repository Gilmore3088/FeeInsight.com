import { MAX_COHORT_REPORTERS } from "@/lib/data-catalog/call-cohort-history";
import type { FinancialSource } from "./financial-sources";
import {
  COMPARABLE_CHARTER_SOURCE, PRIOR_QUARTER_JOIN, QUARTER_SC, SAME_SCALE_SOURCES, sourceScope,
} from "./call-report-sql";

/**
 * The call-report readers' SQL as it ran before call_report_quarterly_income existed: every
 * request re-reads institution_financial_records, casts the TEXT report_date and splits NCUA
 * year-to-date income into quarters itself. Kept, text unchanged, for two jobs only:
 *  - the fallback while the summary table is missing or empty (call-report-quarters.ts logs it);
 *  - the oracle the summary readers are proved equal to (call-report-quarters.db.test.ts).
 * Each function returns SQL taking exactly the parameters, and returning exactly the columns,
 * of its summary-backed twin in call-reports.ts. Do not edit one without the other.
 */

export function latestScopedDateSql(source: FinancialSource): string {
  return `SELECT inf.report_date::text AS latest_date
       FROM institution_financial_records inf
       JOIN institution_sources ct ON ct.id = inf.institution_id
      WHERE inf.service_charge_income > 0 AND ${SAME_SCALE_SOURCES}
        AND ${COMPARABLE_CHARTER_SOURCE} AND ${sourceScope(source)}
      ORDER BY inf.report_date DESC LIMIT 1`;
}

/** Any source's latest date with positive income; unmatched filings count, as before. */
export function latestAnyDate(sql: LatestDateSql): Promise<ReadonlyArray<{ latest_date?: unknown }>> {
  return sql`
      SELECT MAX(report_date)::text AS latest_date
      FROM institution_financial_records
      WHERE service_charge_income > 0
        AND source IN ('fdic', 'ncua')
    ` as unknown as Promise<ReadonlyArray<{ latest_date?: unknown }>>;
}

/** The connection's tagged-template and string query forms, as latestAnyDate uses them. */
export type LatestDateSql = ((strings: TemplateStringsArray, ...values: unknown[]) => unknown) & {
  unsafe: (query: string) => unknown;
};

/** $1 charter, $2 tier, $3 quarters, $4 median floor. */
export function peerMediansSql(source: FinancialSource): string {
  return `WITH filed AS (
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
          AND ${COMPARABLE_CHARTER_SOURCE} AND ${sourceScope(source)}
       WINDOW w AS (PARTITION BY inf.institution_id, inf.source, EXTRACT(YEAR FROM inf.report_date::date)
                    ORDER BY inf.report_date::date)
     ),
     quarterly AS (
       SELECT institution_id, source, rd,
              CASE
                WHEN source <> 'ncua' OR EXTRACT(QUARTER FROM rd) = 1 THEN amount
                WHEN prior_rd IS NOT NULL AND rd - prior_rd BETWEEN 80 AND 100 THEN amount - prior_amount
                ELSE NULL
              END AS income
         FROM filed
     )
     SELECT TO_CHAR(rd, 'YYYY-MM-DD') AS quarter_end,
            CASE WHEN COUNT(*) >= $4 THEN PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY income) END AS median_thousands,
            COUNT(*)::int AS institutions,
            (ARRAY_AGG(DISTINCT institution_id ORDER BY institution_id))[1:${MAX_COHORT_REPORTERS}] AS reporting_institution_ids
       FROM quarterly
      WHERE income > 0
      GROUP BY rd
      ORDER BY rd DESC
      LIMIT $3`;
}

/** $1 quarters. */
export function revenueTrendSql(source?: FinancialSource): string {
  return `WITH bounds AS (
       SELECT TO_CHAR(DATE_TRUNC('year', MAX(inf.report_date)::date - MAKE_INTERVAL(months => 3 * ($1::int + 4))),
                      'YYYY-MM-DD') AS from_date
         FROM institution_financial_records inf
         JOIN institution_sources ct ON ct.id = inf.institution_id
        WHERE ${SAME_SCALE_SOURCES} AND ${COMPARABLE_CHARTER_SOURCE} AND ${sourceScope(source)}
     ),
     filed AS (
       SELECT inf.institution_id,
              inf.source,
              inf.report_date,
              inf.report_date::date AS rd,
              inf.service_charge_income AS amount,
              LAG(inf.service_charge_income) OVER w AS prior_amount,
              LAG(inf.report_date::date) OVER w AS prior_rd
         FROM institution_financial_records inf
         JOIN institution_sources ct ON ct.id = inf.institution_id
         CROSS JOIN bounds
        WHERE ${SAME_SCALE_SOURCES} AND ${COMPARABLE_CHARTER_SOURCE} AND ${sourceScope(source)}
          AND inf.report_date >= bounds.from_date
       WINDOW w AS (PARTITION BY inf.institution_id, inf.source, EXTRACT(YEAR FROM inf.report_date::date)
                    ORDER BY inf.report_date::date)
     ),
     quarterly AS (
       SELECT institution_id, source, report_date, rd,
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
       COUNT(DISTINCT ct.id)                                    AS total_institutions,
       SUM(CASE WHEN ct.charter_type = 'bank' THEN inf.service_charge_income ELSE 0 END)
                                                                 AS bank_service_charges,
       SUM(CASE WHEN ct.charter_type = 'credit_union' THEN inf.service_charge_income ELSE 0 END)
                                                                 AS cu_service_charges,
       COUNT(DISTINCT inf.institution_id) FILTER (WHERE inf.source = 'fdic') AS bank_reporters,
       COUNT(DISTINCT inf.institution_id) FILTER (WHERE inf.source = 'ncua') AS cu_reporters,
       (ARRAY_AGG(DISTINCT inf.institution_id ORDER BY inf.institution_id) FILTER (WHERE inf.source = 'fdic'))[1:${MAX_COHORT_REPORTERS}] AS bank_reporting_ids,
       (ARRAY_AGG(DISTINCT inf.institution_id ORDER BY inf.institution_id) FILTER (WHERE inf.source = 'ncua'))[1:${MAX_COHORT_REPORTERS}] AS cu_reporting_ids
     FROM quarterly inf
     JOIN institution_sources ct ON ct.id = inf.institution_id
     WHERE inf.service_charge_income > 0
     GROUP BY DATE_TRUNC('quarter', inf.rd)
     ORDER BY DATE_TRUNC('quarter', inf.rd) DESC
     LIMIT $1`;
}

/** $1 report date, $2 limit. */
export function topRevenueSql(source?: FinancialSource): string {
  return `SELECT
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
         AND ${COMPARABLE_CHARTER_SOURCE} AND ${sourceScope(source)}
       ORDER BY ${QUARTER_SC} DESC
       LIMIT $2`;
}

/** $1 institution, $2 quarters. */
export function institutionRevenueTrendSql(source?: FinancialSource): string {
  return `SELECT
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
         JOIN institution_sources ct ON ct.id = inf.institution_id
         ${PRIOR_QUARTER_JOIN}
         WHERE inf.institution_id = $1
           AND ${QUARTER_SC} IS NOT NULL
           AND ${SAME_SCALE_SOURCES}
           AND ${COMPARABLE_CHARTER_SOURCE} AND ${sourceScope(source)}
       ) ranked
       WHERE quarter_rank = 1
       ORDER BY report_date DESC
       LIMIT $2`;
}

/** $1 institution. */
export const PEER_SUBJECT_SQL: string = `SELECT ct.institution_name, ct.charter_type, inf.source, inf.total_assets,
            ${QUARTER_SC} AS service_charge_income, inf.fee_income_ratio, inf.report_date
       FROM institution_financial_records inf
       JOIN institution_sources ct ON ct.id = inf.institution_id
       ${PRIOR_QUARTER_JOIN}
      WHERE inf.institution_id = $1
        AND ${SAME_SCALE_SOURCES} AND ${COMPARABLE_CHARTER_SOURCE}
      ORDER BY inf.report_date DESC, inf.id DESC
      LIMIT 1`;

const PEER_SCOPE = `inf.report_date = $1
        AND inf.total_assets >= $2 AND inf.total_assets < $3
        AND ct.charter_type = $4 AND inf.source = $5`;

/** $1 date, $2/$3 asset bounds, $4 charter, $5 source. */
export const PEER_STATS_SQL: string = `SELECT COUNT(DISTINCT inf.institution_id)::int AS eligible_count,
            COUNT(DISTINCT inf.institution_id) FILTER (WHERE ${QUARTER_SC} > 0)::int AS peer_count,
            COUNT(DISTINCT inf.institution_id) FILTER (WHERE ${QUARTER_SC} > 0 AND inf.fee_income_ratio IS NOT NULL)::int AS ratio_reported_count,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${QUARTER_SC}) FILTER (WHERE ${QUARTER_SC} > 0) AS median_sc,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY inf.fee_income_ratio) FILTER (WHERE ${QUARTER_SC} > 0 AND inf.fee_income_ratio IS NOT NULL) AS median_fee_ratio
       FROM institution_financial_records inf
       JOIN institution_sources ct ON ct.id = inf.institution_id
       ${PRIOR_QUARTER_JOIN}
      WHERE ${PEER_SCOPE} AND ${SAME_SCALE_SOURCES} AND ${COMPARABLE_CHARTER_SOURCE}`;

/** As PEER_STATS_SQL, plus $6 the subject's income. */
export const PEER_RANK_SQL: string = `SELECT COUNT(DISTINCT inf.institution_id)::int AS better_count
       FROM institution_financial_records inf
       JOIN institution_sources ct ON ct.id = inf.institution_id
       ${PRIOR_QUARTER_JOIN}
      WHERE ${PEER_SCOPE} AND ${SAME_SCALE_SOURCES} AND ${COMPARABLE_CHARTER_SOURCE}
        AND ${QUARTER_SC} > $6`;

/** $1 quarters. */
export function districtIncomeTrendSql(source?: FinancialSource): string {
  return `WITH filed AS (
         SELECT inf.institution_id,
                inf.source,
                inf.report_date::date AS rd,
                inf.service_charge_income AS amount,
                LAG(inf.service_charge_income) OVER w AS prior_amount,
                LAG(inf.report_date::date) OVER w AS prior_rd
           FROM institution_financial_records inf
           JOIN institution_sources ct ON ct.id = inf.institution_id
          WHERE ${SAME_SCALE_SOURCES} AND ${COMPARABLE_CHARTER_SOURCE} AND ${sourceScope(source)}
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
        ORDER BY 1 DESC, 2`;
}

/** $1 date, $2 district. */
export function districtFeeRevenueSql(source?: FinancialSource): string {
  return `SELECT
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
       AND ${COMPARABLE_CHARTER_SOURCE} AND ${sourceScope(source)}
     GROUP BY ct.fed_district`;
}

/** $1 date. */
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
       SUM(${QUARTER_SC})::bigint                      AS total_sc_income,
       AVG(${QUARTER_SC})::bigint                      AS avg_sc_income
     FROM institution_financial_records inf
     JOIN institution_sources ct ON ct.id = inf.institution_id
     ${PRIOR_QUARTER_JOIN}
     WHERE inf.report_date = $1
       AND ${QUARTER_SC} > 0
       AND inf.total_assets > 0
       AND ${SAME_SCALE_SOURCES}
       AND ${COMPARABLE_CHARTER_SOURCE} AND ${sourceScope(source)}
     GROUP BY 1
     ORDER BY MIN(inf.total_assets)`;
}

/** The subject, its peers' filings of the last 30 months, and their standalone quarters. */
const INTENSITY_QUARTERS = `subject AS (
       SELECT id, charter_type, asset_size_tier FROM institution_sources
        WHERE id = $1 AND charter_type IN ('bank', 'credit_union') AND asset_size_tier IS NOT NULL
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
        WHERE ${SAME_SCALE_SOURCES} AND ${COMPARABLE_CHARTER_SOURCE}
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
     )`;

export const INTENSITY_QUARTERS_SQL: string = INTENSITY_QUARTERS;
