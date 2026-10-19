import { sql } from "./connection";
import { activeInstitutionFilter } from "./fee-stats";
import { cityKey, foldCitySpellings, placesInFold, sameCitySpellings, type StatePlace } from "@/lib/geo/city-names";

/**
 * The stored spellings of one city, read for the queries that match a city by name (#2092).
 * Headquarters records (`institution_sources.city`) and branch records (FDIC Summary of Deposits,
 * NCUA branches) spell one place several ways ("SAINT PETERSBURG", "ST. PETERSBURG"); every
 * reader that matches a city sends the spellings these return, folded by `cityKey`
 * (`src/lib/geo/city-names.ts`), so the city page, the state directory and the report markets
 * count one city once. Stored records keep their own spelling.
 */

/** Every headquarters spelling of the city in the state (active institutions), upper case, the one asked first. */
export async function hqCitySpellings(city: string, stateCode: string): Promise<string[]> {
  const rows = (await sql`
    SELECT DISTINCT UPPER(ct.city) AS city FROM institution_sources ct
     WHERE ct.state_code = ${stateCode.toUpperCase()} AND ct.city IS NOT NULL AND ct.city <> ''
       AND ${sql.unsafe(activeInstitutionFilter("ct"))}
  `) as { city: unknown }[];
  return sameCitySpellings(city, rows.map((r) => String(r.city)));
}

/**
 * The headquarters spelling a city is named under once its spellings are folded: the one most
 * active institutions use, as the city lists name it (`foldCitySummaries`). Null when no active
 * institution is headquartered there under any spelling.
 */
export async function hqCityName(city: string, stateCode: string): Promise<string | null> {
  const key = cityKey(city);
  if (!key) return null;
  const rows = (await sql`
    SELECT (array_agg(ct.city ORDER BY (ct.city = UPPER(ct.city)), ct.city))[1] AS city, COUNT(*) AS institutions
      FROM institution_sources ct
     WHERE ct.state_code = ${stateCode.toUpperCase()} AND ct.city IS NOT NULL AND ct.city <> ''
       AND ${sql.unsafe(activeInstitutionFilter("ct"))}
     GROUP BY LOWER(ct.city)
  `) as { city: unknown; institutions: unknown }[];
  const same = rows
    .map((r) => ({ name: String(r.city), branches: Number(r.institutions) || 0, row: null }))
    .filter((s) => cityKey(s.name) === key);
  return foldCitySpellings(same)[0]?.name ?? null;
}

/**
 * Every city spelling the branch records use in the state, upper case: bank branches of the given
 * Summary of Deposits year (the latest when none is given) and credit union branches.
 */
export async function storedBranchCities(stateCode: string, year?: number): Promise<string[]> {
  const state = stateCode.toUpperCase();
  const rows = (await sql`
    SELECT DISTINCT UPPER(city) AS city FROM institution_branch_deposits
     WHERE state = ${state} AND city IS NOT NULL AND city <> ''
       AND year = COALESCE(${year ?? null}::int, (SELECT MAX(year) FROM institution_branch_deposits))
    UNION
    SELECT DISTINCT UPPER(city) FROM credit_union_branches
     WHERE state = ${state} AND city IS NOT NULL AND city <> ''
  `) as { city: unknown }[];
  return rows.map((r) => String(r.city));
}

/** Every branch spelling of the city in the state, upper case, the one asked first. */
export async function branchCitySpellings(city: string, stateCode: string, year?: number): Promise<string[]> {
  return sameCitySpellings(city, await storedBranchCities(stateCode, year));
}

/**
 * The headquarters places ("STATE|CITY", upper case, as stored) that are one of the branch cities
 * in these Summary of Deposits counties once spellings are folded. A report market counts an
 * institution headquartered in a market city even when its record spells the city another way.
 */
export async function hqPlacesInBranchCounties(sodYear: number, countyFips: string[]): Promise<string[]> {
  if (countyFips.length === 0) return [];
  const rows = (await sql`
    WITH branch_places AS (
      SELECT DISTINCT b.state, UPPER(b.city) AS city FROM institution_branch_deposits b
       WHERE b.year = ${sodYear} AND b.county_fips::text = ANY(${countyFips}) AND b.city IS NOT NULL AND b.city <> ''
    )
    SELECT 'branch' AS kind, state, city FROM branch_places
    UNION ALL
    SELECT DISTINCT 'hq', s.state_code, UPPER(s.city) FROM institution_sources s
     WHERE s.state_code IN (SELECT state FROM branch_places) AND s.city IS NOT NULL AND s.city <> ''
  `) as { kind: unknown; state: unknown; city: unknown }[];
  const place = (r: { state: unknown; city: unknown }): StatePlace => ({ state: String(r.state), city: String(r.city) });
  return placesInFold(rows.filter((r) => r.kind === "branch").map(place), rows.filter((r) => r.kind === "hq").map(place));
}
