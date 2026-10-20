import { getSql, type withTransaction } from "./connection";
import { financialSourceFilter, type FinancialSource } from "./financial-sources";
import { canonicalFinancialSourceSql } from "./financial-peer-contract";

/**
 * SQL pieces shared by the call-report readers (call-reports.ts) and the per-request
 * computation they fall back to (call-reports-legacy.ts).
 *
 * fdic and ncua rows report dollars in thousands. ffiec rows duplicate the fdic
 * quarters in other units (whole-dollar balances, service charges over-scaled
 * further; see financial-units.ts), so mixing them into one series or one peer
 * group produces fake drops and wrong ranks. Every query reads the
 * thousands-scale sources only (see financial-sources.ts).
 */
export const SAME_SCALE_SOURCES = financialSourceFilter("inf");

/** Canonical charter identity and the regulator's measure must agree. */
export const COMPARABLE_CHARTER_SOURCE = canonicalFinancialSourceSql("inf", "ct");

export function sourceScope(source?: FinancialSource): string {
  if (source === undefined) return "TRUE";
  // Runtime fail-closed as well as the TypeScript boundary.
  return source === "fdic" || source === "ncua" ? `inf.source = '${source}'` : "FALSE";
}

/**
 * NCUA 5300 income lines are year-to-date; FDIC rows are already quarterly. Single-quarter
 * reads join each NCUA row to the same credit union's prior quarter in the same year
 * (`prev`), and QUARTER_SC is that quarter's own service-charge income: the YTD minus the
 * prior YTD (Q1 stands alone), or NULL when the prior quarter is missing. Reading the raw
 * YTD as a quarter doubled Q2 credit-union income (Q2 2026: $5.16B YTD vs $2.64B in the quarter).
 * call_report_quarterly_income stores this figure as prior_quarter_end_income.
 */
export const PRIOR_QUARTER_JOIN = `LEFT JOIN institution_financial_records prev
       ON inf.source = 'ncua'
      AND prev.institution_id = inf.institution_id
      AND prev.source = inf.source
      AND EXTRACT(QUARTER FROM inf.report_date::date) > 1
      AND prev.report_date = TO_CHAR(DATE_TRUNC('quarter', inf.report_date::date)::date - 1, 'YYYY-MM-DD')`;
export const QUARTER_SC = `(CASE
       WHEN inf.source <> 'ncua' OR EXTRACT(QUARTER FROM inf.report_date::date) = 1 THEN inf.service_charge_income
       WHEN prev.service_charge_income IS NOT NULL THEN inf.service_charge_income - prev.service_charge_income
     END)`;

/**
 * The window rule for a filing's own quarter, over a CTE with `source`, `rd` (date), `amount`,
 * `prior_amount` and `prior_rd` (LAG over the filer's filings in the same calendar year): the
 * YTD minus the previous filing when it is 80-100 days earlier, Q1 and FDIC rows as filed.
 * call_report_quarterly_income stores this figure as quarter_income.
 */
export const WINDOW_QUARTER_INCOME = `CASE
                WHEN source <> 'ncua' OR EXTRACT(QUARTER FROM rd) = 1 THEN amount
                WHEN prior_rd IS NOT NULL AND rd - prior_rd BETWEEN 80 AND 100 THEN amount - prior_amount
                ELSE NULL
              END`;

/**
 * Optional identity/lifecycle reads use the same connection owner as the financial reader.
 * A missing registry field or timed-out diagnostic read cannot erase valid filing statistics.
 */
export const historyRead: typeof withTransaction = (callback) =>
  getSql().begin((tx) => callback(tx as unknown as ReturnType<typeof getSql>)) as ReturnType<typeof callback>;

export function dateText(value: unknown): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
}
