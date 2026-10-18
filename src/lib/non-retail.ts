/**
 * Institutions that offer no retail deposit accounts, so they have no consumer fee schedule to
 * publish (custody, trust, wealth-management and banking-as-a-service banks). James, 2026-10-18
 * on #1754: "i think we can skip them. just note on their records they are non-retail". The
 * top 10 per state count (`top-ten-coverage.ts`) skips them and gives each slot to the next
 * institution in that state, and their admin page says so. Add an id here only on James's word.
 */
export const NON_RETAIL_INSTITUTIONS: ReadonlyMap<number, string> = new Map([
  [10, "The Bank of New York Mellon: custody and asset-servicing bank"],
  [11, "State Street Bank and Trust Company: custody and asset-servicing bank"],
  [13, "Morgan Stanley Bank, N.A.: wealth-management bank for Morgan Stanley clients"],
  [28, "UBS Bank USA: wealth-management bank for UBS clients"],
  [72, "BNY Mellon, N.A.: wealth-management and custody bank"],
  [99, "TriState Capital Bank: private and commercial bank, no retail schedule"],
  [183, "The Bancorp Bank, N.A.: banking-as-a-service bank for partner programs"],
]);

export function isNonRetail(institutionId: number): boolean {
  return NON_RETAIL_INSTITUTIONS.has(institutionId);
}
