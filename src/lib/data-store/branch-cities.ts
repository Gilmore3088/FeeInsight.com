import { sql } from "./connection";

export interface ZipCity {
  /** The city as the branch records spell it (upper case). */
  city: string;
  state: string;
}

/**
 * The city a five-digit ZIP code belongs to, read from the branch records the city pages use:
 * credit union offices from the NCUA branch file and bank branches from the latest FDIC Summary
 * of Deposits year. When a ZIP spans several city names, the one with the most branches wins.
 * Null when no bank or credit union branch sits in the ZIP, so the fee check asks for a city.
 */
export async function getBranchCityForZip(zip: string): Promise<ZipCity | null> {
  if (!/^\d{5}$/.test(zip)) return null;
  const rows = (await sql`
    SELECT state, UPPER(city) AS city, COUNT(*) AS branches
      FROM (
        SELECT state, city FROM credit_union_branches
         WHERE LEFT(zip, 5) = ${zip}
        UNION ALL
        SELECT state, city FROM institution_branch_deposits
         WHERE year = (SELECT MAX(year) FROM institution_branch_deposits)
           AND LEFT(zip, 5) = ${zip}
      ) b
     WHERE city IS NOT NULL AND city <> '' AND state IS NOT NULL
     GROUP BY state, UPPER(city)
     ORDER BY COUNT(*) DESC, UPPER(city)
     LIMIT 1
  `) as { state: unknown; city: unknown }[];
  const row = rows[0];
  if (!row || typeof row.city !== "string" || typeof row.state !== "string") return null;
  return { city: row.city, state: row.state.toUpperCase() };
}
