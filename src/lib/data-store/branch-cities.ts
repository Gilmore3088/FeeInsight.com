import { sql } from "./connection";

/**
 * How many cities an institution has branches in: bank branches from the latest FDIC Summary of
 * Deposits year, credit union offices from the NCUA branch file. The fee check uses it to decide
 * whether its headquarters city stands for the institution's market (a bank in a few dozen
 * cities) or not (a national bank). Both lookups use the tables' institution_id indexes.
 */
export async function getInstitutionBranchCityCount(institutionId: number): Promise<number> {
  const rows = (await sql`
    SELECT
      (SELECT COUNT(DISTINCT (state, UPPER(city)))
         FROM institution_branch_deposits
        WHERE institution_id = ${institutionId}
          AND year = (SELECT MAX(year) FROM institution_branch_deposits)
          AND city IS NOT NULL)
      + (SELECT COUNT(DISTINCT (state, UPPER(city)))
           FROM credit_union_branches
          WHERE institution_id = ${institutionId}
            AND city IS NOT NULL) AS cities
  `) as { cities: unknown }[];
  const n = Number(rows[0]?.cities);
  return Number.isFinite(n) ? n : 0;
}
