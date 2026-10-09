/**
 * National online and branchless banks (rule v2): in the latest FDIC Summary of Deposits the bank
 * holds $3B or more in deposits through at most 4 offices, one of which holds at least 90% of it
 * (Ally, SoFi, Sallie Mae and Optum in Salt Lake City; Schwab in Dallas; Live Oak in Wilmington;
 * Goldman Sachs and the trust and wholesale banks). A charter address puts these banks in a
 * county or metro, but they are not its local competitors, so local comparisons, competitor
 * coverage and the market-gap ranking leave them out (coordinator, 23:57 UTC Oct 8 and 01:57 UTC
 * Oct 9). The $3B floor keeps one-office community banks in their own market. Credit unions file
 * no Summary of Deposits and are never excluded.
 *
 * Use as `HAVING COUNT(*) <= ${BRANCHLESS_MAX_OFFICES} AND SUM(b.deposits) >= ${BRANCHLESS_MIN_DEPOSITS}
 * AND MAX(b.deposits) >= ${BRANCHLESS_ONE_OFFICE_SHARE} * SUM(b.deposits)` over one year's
 * institution_branch_deposits rows grouped by institution.
 */
export const BRANCHLESS_MAX_OFFICES = 4;
/** Thousands of dollars, as the Summary of Deposits reports them ($3B). */
export const BRANCHLESS_MIN_DEPOSITS = 3_000_000;
export const BRANCHLESS_ONE_OFFICE_SHARE = 0.9;
