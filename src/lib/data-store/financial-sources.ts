/**
 * The institution_financial_records sources every reader may use.
 *
 * fdic and ncua rows carry every dollar column in thousands and fee_income_ratio
 * as a fraction. The table also holds 13,215 `ffiec` rows (report dates
 * 2025-09-30, 2025-12-31 and 2026-03-31, written once on 2026-08-10 by a loader
 * that no longer exists) in other units: balance-sheet columns in whole dollars,
 * service_charge_income about 1,000,000x the fdic figure, fee_income_ratio about
 * 1,000x, and net_income null. 12,934 of them duplicate an fdic/ncua row for the
 * same institution and quarter, so a reader that does not filter by source can
 * pick an ffiec row as "the latest" quarter or sum both rows.
 *
 * Until the ffiec rows are archived, every read filters to these sources.
 * Tagged-template queries (which cannot splice a raw string) write the literal
 * `source IN ('fdic', 'ncua')`; string queries use financialSourceFilter().
 * `scripts/ci-guards.sh financial-source-kill` checks every reader in src/.
 */
export const FINANCIAL_SOURCES = ["fdic", "ncua"] as const;
export type FinancialSource = (typeof FINANCIAL_SOURCES)[number];

/** `('fdic', 'ncua')`, for `source IN ...`. */
export const FINANCIAL_SOURCES_SQL = `(${FINANCIAL_SOURCES.map((s) => `'${s}'`).join(", ")})`;

/** `alias.source IN ('fdic', 'ncua')`, or unqualified when no alias is given. */
export function financialSourceFilter(alias?: string): string {
  return `${alias ? `${alias}.` : ""}source IN ${FINANCIAL_SOURCES_SQL}`;
}

export function isFinancialSource(source: string): source is FinancialSource {
  return (FINANCIAL_SOURCES as readonly string[]).includes(source.toLowerCase());
}
