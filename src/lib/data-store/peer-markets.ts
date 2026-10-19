/**
 * Metro markets (MSAs) for peer groups, defined by where institutions have branches, the same
 * way the city market pages define them (city-market.ts): FDIC Summary of Deposits branches in
 * the metro, plus NCUA credit union branches in any city those bank branches sit in.
 */
import { sql } from "./connection";

export interface PeerMarket {
  code: number;
  name: string;
}

async function latestSodYear(): Promise<number> {
  const rows = (await sql`SELECT MAX(year) AS year FROM institution_branch_deposits`) as { year: unknown }[];
  return Number(rows[0]?.year) || new Date().getUTCFullYear();
}

/** The metro holding most of the institution's branches, or null when none is on record. */
export async function getHomeMarket(institutionId: number): Promise<PeerMarket | null> {
  const year = await latestSodYear();
  const bank = (await sql`
    SELECT msa_code, MAX(msa_name) AS msa_name, COUNT(*) AS n
      FROM institution_branch_deposits
     WHERE year = ${year} AND institution_id = ${institutionId} AND msa_code IS NOT NULL AND msa_code > 0
     GROUP BY msa_code ORDER BY n DESC, msa_code LIMIT 1
  `) as { msa_code: unknown; msa_name: string | null }[];
  const cu = bank.length
    ? bank
    : ((await sql`
        WITH places AS (
          SELECT state, UPPER(city) AS city, COUNT(*) AS n
            FROM credit_union_branches
           WHERE institution_id = ${institutionId}
           GROUP BY 1, 2
        ), metros AS (
          SELECT DISTINCT ON (state, UPPER(city)) state, UPPER(city) AS city, msa_code, msa_name
            FROM institution_branch_deposits
           WHERE year = ${year} AND msa_code IS NOT NULL AND msa_code > 0
           ORDER BY state, UPPER(city), msa_code
        )
        SELECT m.msa_code, MAX(m.msa_name) AS msa_name, SUM(p.n) AS n
          FROM places p JOIN metros m ON m.state = p.state AND m.city = p.city
         GROUP BY m.msa_code ORDER BY n DESC, m.msa_code LIMIT 1
      `) as { msa_code: unknown; msa_name: string | null }[]);
  const row = cu[0];
  return row ? { code: Number(row.msa_code), name: String(row.msa_name ?? "") } : null;
}

/** The metro's name and every institution with a branch in it, or null for an unknown code. */
export async function getMarketInstitutionIds(code: number): Promise<{ market: PeerMarket; ids: Set<number> } | null> {
  const year = await latestSodYear();
  const names = (await sql`
    SELECT MAX(msa_name) AS msa_name FROM institution_branch_deposits WHERE year = ${year} AND msa_code = ${code}
  `) as { msa_name: string | null }[];
  if (!names[0]?.msa_name) return null;
  const rows = (await sql`
    WITH places AS (
      SELECT DISTINCT state, UPPER(city) AS city FROM institution_branch_deposits WHERE year = ${year} AND msa_code = ${code}
    )
    SELECT DISTINCT institution_id FROM institution_branch_deposits
     WHERE year = ${year} AND msa_code = ${code} AND institution_id IS NOT NULL
    UNION
    SELECT DISTINCT c.institution_id FROM credit_union_branches c
      JOIN places p ON c.state = p.state AND UPPER(c.city) = p.city
     WHERE c.institution_id IS NOT NULL
  `) as { institution_id: unknown }[];
  return { market: { code, name: names[0].msa_name }, ids: new Set(rows.map((r) => Number(r.institution_id))) };
}
