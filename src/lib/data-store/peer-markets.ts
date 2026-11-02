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
        )
        -- Each branch city's metro is looked up on its own through the state-and-city index; a
        -- city-to-metro list built from every branch of the year took ~0.6 s per page
        -- (findings/2026-11-02-branch-reads-scanned-every-branch-per-page.md).
        SELECT m.msa_code, MAX(m.msa_name) AS msa_name, SUM(p.n) AS n
          FROM places p
          CROSS JOIN LATERAL (
            SELECT d.msa_code, d.msa_name
              FROM institution_branch_deposits d
             WHERE d.state = p.state AND UPPER(d.city) = p.city AND d.year = ${year}
               AND d.msa_code IS NOT NULL AND d.msa_code > 0
             ORDER BY d.msa_code
             LIMIT 1
          ) m
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

/**
 * The cities inside a metro where each of these institutions has a branch, from the same branch
 * records that define the metro (FDIC Summary of Deposits; NCUA branches in the metro's cities).
 * One row per institution and city.
 */
export async function getMarketBranchCities(
  code: number,
  institutionIds: number[],
): Promise<{ institution_id: number; city: string; state: string }[]> {
  if (institutionIds.length === 0) return [];
  const year = await latestSodYear();
  const rows = (await sql`
    WITH places AS (
      SELECT DISTINCT state, UPPER(city) AS city FROM institution_branch_deposits WHERE year = ${year} AND msa_code = ${code}
    )
    SELECT DISTINCT institution_id, UPPER(city) AS city, state FROM institution_branch_deposits
     WHERE year = ${year} AND msa_code = ${code} AND institution_id = ANY(${institutionIds}::bigint[])
       AND city IS NOT NULL AND state IS NOT NULL
    UNION
    SELECT DISTINCT c.institution_id, UPPER(c.city) AS city, c.state FROM credit_union_branches c
      JOIN places p ON c.state = p.state AND UPPER(c.city) = p.city
     WHERE c.institution_id = ANY(${institutionIds}::bigint[])
  `) as { institution_id: unknown; city: string; state: string }[];
  return rows.map((r) => ({ institution_id: Number(r.institution_id), city: r.city, state: r.state }));
}

/**
 * Each institution's presence in a metro: its branches there (FDIC Summary of Deposits for banks,
 * NCUA branches in the metro's cities for credit unions) and, for banks, the deposits they hold
 * (whole dollars), with every institution's deposits in the metro for a share. Credit unions report
 * no deposits by branch, so theirs is null.
 */
export async function getMarketPresence(
  code: number,
  institutionIds: number[],
): Promise<{ totalDeposits: number; rows: { institution_id: number; branches: number; deposits: number | null }[] }> {
  if (institutionIds.length === 0) return { totalDeposits: 0, rows: [] };
  const year = await latestSodYear();
  const [total] = (await sql`
    SELECT COALESCE(SUM(deposits), 0) AS deposits FROM institution_branch_deposits WHERE year = ${year} AND msa_code = ${code}
  `) as { deposits: unknown }[];
  const rows = (await sql`
    WITH places AS (
      SELECT DISTINCT state, UPPER(city) AS city FROM institution_branch_deposits WHERE year = ${year} AND msa_code = ${code}
    )
    SELECT institution_id, COUNT(*)::int AS branches, SUM(deposits) AS deposits FROM institution_branch_deposits
     WHERE year = ${year} AND msa_code = ${code} AND institution_id = ANY(${institutionIds}::bigint[])
     GROUP BY institution_id
    UNION ALL
    SELECT c.institution_id, COUNT(*)::int, NULL FROM credit_union_branches c
      JOIN places p ON c.state = p.state AND UPPER(c.city) = p.city
     WHERE c.institution_id = ANY(${institutionIds}::bigint[])
     GROUP BY c.institution_id
  `) as { institution_id: unknown; branches: unknown; deposits: unknown }[];
  const SOD_THOUSANDS = 1_000;
  return {
    totalDeposits: Number(total?.deposits ?? 0) * SOD_THOUSANDS,
    rows: rows.map((r) => ({
      institution_id: Number(r.institution_id),
      branches: Number(r.branches),
      deposits: r.deposits === null || r.deposits === undefined ? null : Number(r.deposits) * SOD_THOUSANDS,
    })),
  };
}
