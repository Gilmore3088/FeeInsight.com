import { sql } from "./connection";
import { statsRowFilter } from "./fee-stats";
import { CITY_FEES, getStateMarketCities, type CityFeeKey } from "./city-market";

/**
 * The state page's market comparison: for a state's largest local markets, one value per
 * institution with a branch there, for each fee a city page lets a reader pick. A market is
 * defined the way the city page defines it (branches in the city, wherever the institution is
 * headquartered), and each institution's value follows the same rule: its highest overdraft,
 * the middle row of its schedule for every other fee. The page takes the medians from here.
 */

/** Markets the state page compares, largest first by institutions with a branch there. */
export const STATE_MARKETS_COMPARED = 8;

const PICK_HIGHEST = ["overdraft"];

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export interface StateMarketFees {
  /** The city as branch records spell it, upper case. */
  city: string;
  /** Banks and credit unions with a branch in the city, wherever headquartered. */
  institutions: number;
  /** Of those, the ones with published fees. */
  with_fees: number;
  branches: number;
  /** The middle of the city's branches (from the city directory read), for the state map; null without coordinates. */
  lat: number | null;
  lon: number | null;
  /** One value per institution with a branch here that publishes the fee. */
  fees: Partial<Record<CityFeeKey, number[]>>;
}

export async function getStateMarketFees(stateCode: string): Promise<StateMarketFees[]> {
  const state = stateCode.toUpperCase();
  const cities = (await getStateMarketCities(state)).slice(0, STATE_MARKETS_COMPARED);
  if (cities.length === 0) return [];
  // Every spelling of each market, read back to the city it was folded into.
  const names = cities.flatMap((c) => c.spellings);
  const cityOf = new Map(cities.flatMap((c) => c.spellings.map((s) => [s, c.city] as const)));

  const branchRows = (await sql`
    SELECT UPPER(city) AS city, institution_id
      FROM institution_branch_deposits
     WHERE year = (SELECT MAX(year) FROM institution_branch_deposits)
       AND state = ${state} AND UPPER(city) = ANY(${names}::text[])
    UNION ALL
    SELECT UPPER(city), institution_id
      FROM credit_union_branches
     WHERE state = ${state} AND UPPER(city) = ANY(${names}::text[])
  `) as Record<string, unknown>[];

  const byCity = new Map<string, { ids: Set<number> }>();
  for (const r of branchRows) {
    const city = cityOf.get(String(r.city)) ?? String(r.city);
    const entry = byCity.get(city) ?? { ids: new Set<number>() };
    if (r.institution_id != null) entry.ids.add(num(r.institution_id));
    byCity.set(city, entry);
  }
  const ids = [...new Set([...byCity.values()].flatMap((c) => [...c.ids]))];

  const feeRows = ids.length
    ? ((await sql.unsafe(
        `WITH rows AS (
           SELECT ef.institution_id, ef.fee_category, ef.amount,
                  ROW_NUMBER() OVER (PARTITION BY ef.institution_id, ef.fee_category ORDER BY ef.amount, ef.id) AS rn,
                  COUNT(*) OVER (PARTITION BY ef.institution_id, ef.fee_category) AS n
             FROM published_fee_catalog ef
            WHERE ef.institution_id = ANY($1::bigint[])
              AND ef.fee_category = ANY($2::text[])
              AND ef.review_status = 'approved' AND ef.amount IS NOT NULL AND ef.amount >= 0
              AND ${statsRowFilter("ef")}
         )
         SELECT institution_id, fee_category, amount
           FROM rows
          WHERE (fee_category = ANY($3::text[]) AND rn = n)
             OR (NOT fee_category = ANY($3::text[]) AND rn = (n + 1) / 2)`,
        [ids, CITY_FEES.map((f) => f.key), PICK_HIGHEST],
      )) as unknown as Record<string, unknown>[])
    : [];
  const valueOf = new Map<string, number>();
  for (const r of feeRows) valueOf.set(`${num(r.institution_id)}|${r.fee_category}`, num(r.amount));

  return cities.map((c) => {
    const local = byCity.get(c.city);
    const fees: Partial<Record<CityFeeKey, number[]>> = {};
    for (const { key } of CITY_FEES) {
      const values = local ? [...local.ids].flatMap((id) => (valueOf.has(`${id}|${key}`) ? [valueOf.get(`${id}|${key}`)!] : [])) : [];
      if (values.length > 0) fees[key] = values;
    }
    return {
      city: c.city,
      institutions: c.institutions,
      with_fees: c.with_fees,
      branches: c.branches,
      lat: c.lat,
      lon: c.lon,
      fees,
    };
  });
}
