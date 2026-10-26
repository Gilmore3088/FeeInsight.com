/**
 * FDIC and NCUA call-report money as Hamilton stores it (`institution_financial_records`, the call
 * report trend and peer readers, `institution_sources.asset_size`) is in thousands of dollars. A
 * writer handed 649 writes "$649" for what was $649,000 (#1077, Hills Bank). Every Hamilton read
 * model that gives call-report money to a writer converts it here, once, to whole dollars, so the
 * writer and the answer gate read the same dollar value.
 */

/** Stored call-report money is this many dollars per unit. */
export const CALL_REPORT_THOUSANDS = 1_000;

/** The call-report money fields of a financial record, each stored in thousands of dollars. */
export const CALL_REPORT_MONEY_FIELDS = [
  "total_assets", "total_deposits", "total_loans", "service_charge_income", "other_noninterest_income",
  "total_revenue", "overdraft_revenue", "nsf_revenue", "net_income", "net_interest_income", "noninterest_expense",
] as const;

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** A stored call-report amount (thousands of dollars) as whole dollars; null when it is missing or not a number. */
export function callReportDollars(thousands: unknown): number | null {
  const n = finiteNumber(thousands);
  return n === null ? null : Math.round(n * CALL_REPORT_THOUSANDS);
}

/**
 * A copy of a stored financial row with its call-report money fields in whole dollars. Fields the
 * row does not have stay absent and a missing value stays null, never zero; ratios, counts and
 * dates are untouched.
 */
export function callReportRowInDollars<T extends object>(row: T, fields: readonly string[] = CALL_REPORT_MONEY_FIELDS): T {
  const copy = { ...row } as Record<string, unknown>;
  for (const field of fields) {
    if (Object.hasOwn(copy, field)) copy[field] = callReportDollars(copy[field]);
  }
  return copy as T;
}
