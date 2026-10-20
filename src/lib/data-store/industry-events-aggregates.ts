import { sql } from "./connection";

/**
 * Reader over the holding-company fee-income lines from XBRL (sec_fee_income_facts). A concept
 * and year with fewer than MIN_GROUP filers gets a count and no median. Server only.
 */

/** Fewest filers a concept and year needs before it gets a median. */
const MIN_GROUP = 5;

/** Holding-company fee-income lines (XBRL) per concept and year: median with filer count. */
export async function getFeeIncomeFactMedians(sinceYear: number) {
  return sql<Array<{ concept: string; label: string | null; frame: string; filers: number; median: number | null }>>`
    SELECT concept, MAX(label) AS label, frame, COUNT(DISTINCT cik)::int AS filers,
           CASE WHEN COUNT(DISTINCT cik) >= ${MIN_GROUP} THEN percentile_cont(0.5) WITHIN GROUP (ORDER BY value)::float8 END AS median
      FROM sec_fee_income_facts
     WHERE frame >= ${`CY${sinceYear}`}
     GROUP BY concept, frame
     ORDER BY frame DESC, filers DESC
  `;
}
