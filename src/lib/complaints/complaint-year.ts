/**
 * CFPB complaint totals are stored per calendar year received, and the current year's row holds
 * only the complaints received so far (go-live item A5). Every sentence or label that states a
 * year's total says so when the year is still running, so a part-year total is never read as a
 * full year or set beside one as if the two were alike. Pure: no database imports.
 */

/** True when `year` is the calendar year still being counted (UTC). */
export function isPartialComplaintYear(year: string | number, now: Date = new Date()): boolean {
  return Number(year) === now.getUTCFullYear();
}

/** "2025", or "2026 to date" for the year still being counted: for labels and chart axes. */
export function complaintYearLabel(year: string | number, now: Date = new Date()): string {
  return isPartialComplaintYear(year, now) ? `${year} to date` : String(year);
}

/** "in 2025", or "so far in 2026" for the year still being counted: for running sentences. */
export function complaintYearPhrase(year: string | number, now: Date = new Date()): string {
  return isPartialComplaintYear(year, now) ? `so far in ${year}` : `in ${year}`;
}
