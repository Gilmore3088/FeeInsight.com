import { canonicalFinancialSourceSql } from "./financial-peer-contract";
import { financialSourceFilter } from "./financial-sources";
import { PRIOR_QUARTER_JOIN, QUARTER_SC } from "./call-report-sql";

/**
 * SQL for the Hamilton chat's derived call-report readers (derived-analytics.ts, health.ts), in
 * twins: the per-request text over institution_financial_records (kept unchanged as the
 * fallback and as the test oracle) and the same rows over call_report_quarterly_income, where
 * each filing's standalone quarter is already split out. call-report-derived.db.test.ts proves
 * each pair returns the same rows.
 *
 * Readers that need a column the summary does not store (total_revenue, total_loans, roa, roe,
 * efficiency_ratio) still read the filings; see the PR that added this file.
 */
const Q = "call_report_quarterly_income";

/** `source = 'fdic'`, `source = 'ncua'` or both; never caller text. */
export type ScopedSource = "source = 'fdic'" | "source = 'ncua'" | "source IN ('fdic', 'ncua')";

/**
 * getRevenuePerInstitutionTrend's `quarters` CTE: each institution's standalone quarter (the
 * exact prior-quarter-end rule) at the latest `quarterCount` filing dates.
 */
export function revenuePerInstitutionLegacySql(scopedSource: ScopedSource, quarterCount: number): string {
  return `SELECT inf.institution_id, inf.report_date, inf.source,
        inf.total_assets, ct.asset_size_tier, ct.charter_type,
        ${QUARTER_SC} AS quarter_income
      FROM institution_financial_records inf
      JOIN institution_sources ct ON ct.id = inf.institution_id
      ${PRIOR_QUARTER_JOIN}
      WHERE inf.source IN ('fdic', 'ncua')
        AND ${canonicalFinancialSourceSql("inf", "ct")}
        AND inf.${scopedSource}
        AND inf.report_date IN (
          SELECT DISTINCT report_date FROM institution_financial_records
          WHERE source IN ('fdic', 'ncua') AND ${scopedSource}
          ORDER BY report_date DESC LIMIT ${quarterCount}
        )`;
}

/** The summary twin: unmatched filings are stored too, so the latest-dates list is the same. */
export function revenuePerInstitutionSummarySql(scopedSource: ScopedSource, quarterCount: number): string {
  return `SELECT inf.institution_id, inf.report_date, inf.source,
        inf.total_assets, ct.asset_size_tier, ct.charter_type,
        inf.prior_quarter_end_income AS quarter_income
      FROM ${Q} inf
      JOIN institution_sources ct ON ct.id = inf.institution_id
      WHERE inf.source IN ('fdic', 'ncua')
        AND ${canonicalFinancialSourceSql("inf", "ct")}
        AND inf.${scopedSource}
        AND inf.report_date IN (
          SELECT DISTINCT report_date FROM ${Q}
          WHERE source IN ('fdic', 'ncua') AND ${scopedSource}
          ORDER BY report_date DESC LIMIT ${quarterCount}
        )`;
}

const CHARTER_MATCH = `((ct.charter_type = 'bank' AND inf.source = 'fdic')
           OR (ct.charter_type = 'credit_union' AND inf.source = 'ncua'))`;

/** Quarterly balance totals for the growth trend. $1 rows, $2 source or null. */
export function growthTrendLegacySql(column: "total_deposits" | "total_loans"): string {
  return `SELECT
         TO_CHAR(DATE_TRUNC('quarter', inf.report_date::date), 'YYYY-"Q"Q') AS quarter,
         MIN(inf.report_date::text)                                            AS quarter_date,
         SUM(inf.${column})                                                    AS absolute
       FROM institution_financial_records inf
       JOIN institution_sources ct ON ct.id = inf.institution_id
       WHERE inf.${column} IS NOT NULL AND inf.${column} > 0
         AND ${financialSourceFilter("inf")}
         AND ${CHARTER_MATCH}
         AND ($2::text IS NULL OR inf.source = $2)
       GROUP BY DATE_TRUNC('quarter', inf.report_date::date)
       ORDER BY DATE_TRUNC('quarter', inf.report_date::date) DESC
       LIMIT $1`;
}

/** The summary stores total_deposits, not total_loans, so only deposits have a twin. */
export const DEPOSIT_GROWTH_SUMMARY_SQL = `SELECT
         TO_CHAR(inf.quarter_start, 'YYYY-"Q"Q') AS quarter,
         MIN(inf.report_date)                    AS quarter_date,
         SUM(inf.total_deposits)                 AS absolute
       FROM ${Q} inf
       JOIN institution_sources ct ON ct.id = inf.institution_id
       WHERE inf.total_deposits IS NOT NULL AND inf.total_deposits > 0
         AND ${financialSourceFilter("inf")}
         AND ${CHARTER_MATCH}
         AND ($2::text IS NULL OR inf.source = $2)
       GROUP BY inf.quarter_start
       ORDER BY inf.quarter_start DESC
       LIMIT $1`;

/** Institutions with a filing per quarter, by charter. $1 rows, $2 source or null. */
export const INSTITUTION_COUNT_LEGACY_SQL = `SELECT
         TO_CHAR(DATE_TRUNC('quarter', inf.report_date::date), 'YYYY-"Q"Q') AS quarter,
         COUNT(DISTINCT CASE WHEN ct.charter_type = 'bank' THEN inf.institution_id END)         AS bank_count,
         COUNT(DISTINCT CASE WHEN ct.charter_type = 'credit_union' THEN inf.institution_id END) AS cu_count
       FROM institution_financial_records inf
       JOIN institution_sources ct ON ct.id = inf.institution_id
       WHERE ${financialSourceFilter("inf")}
         AND ${CHARTER_MATCH}
         AND ($2::text IS NULL OR inf.source = $2)
       GROUP BY DATE_TRUNC('quarter', inf.report_date::date)
       ORDER BY DATE_TRUNC('quarter', inf.report_date::date) DESC
       LIMIT $1`;

export const INSTITUTION_COUNT_SUMMARY_SQL = `SELECT
         TO_CHAR(inf.quarter_start, 'YYYY-"Q"Q') AS quarter,
         COUNT(DISTINCT CASE WHEN ct.charter_type = 'bank' THEN inf.institution_id END)         AS bank_count,
         COUNT(DISTINCT CASE WHEN ct.charter_type = 'credit_union' THEN inf.institution_id END) AS cu_count
       FROM ${Q} inf
       JOIN institution_sources ct ON ct.id = inf.institution_id
       WHERE ${financialSourceFilter("inf")}
         AND ${CHARTER_MATCH}
         AND ($2::text IS NULL OR inf.source = $2)
       GROUP BY inf.quarter_start
       ORDER BY inf.quarter_start DESC
       LIMIT $1`;
