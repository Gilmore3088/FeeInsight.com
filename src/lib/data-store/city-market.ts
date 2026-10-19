import { sql } from "./connection";
import { activeInstitutionFilter, statsRowFilter } from "./fee-stats";
import { STATE_TO_FIPS } from "@/lib/geo/state-fips";
import { cityKey, foldCitySpellings } from "@/lib/geo/city-names";
import { readerFeeConditions } from "@/lib/fee-conditions";
import { feeEvidence, storedLineOf } from "@/lib/fee-evidence";
import { productNameFromFeeName, readableProductName, waiverForDisplay } from "@/lib/agents/knox/lineup";

/**
 * A city's banking market, defined by where institutions have branches, not where they are
 * headquartered (James, Oct 16: "who actually serves this market?").
 *
 * - City: FDIC Summary of Deposits branches whose city is this city, plus NCUA credit union
 *   branches in the same city.
 * - Metro: every Summary of Deposits branch in the city's metro area (its MSA), plus credit
 *   union branches in any city those bank branches sit in.
 *
 * Fees come from the published catalog under the public statistics filter. Market context is
 * the Summary of Deposits by year (bank deposits and branches) and Census ACS 5-year county
 * estimates, each read for the area, its state and the U.S. Nothing here fetches from outside.
 */

export type CityArea = "city" | "metro";

/** The fees a city page lets a reader pick, in the order a checking customer meets them. */
export const CITY_FEES = [
  { key: "overdraft", label: "Overdraft" },
  { key: "nsf", label: "NSF / returned item" },
  { key: "monthly_maintenance", label: "Monthly maintenance" },
  { key: "atm_non_network", label: "Out-of-network ATM" },
  { key: "stop_payment", label: "Stop payment" },
  { key: "wire_domestic_outgoing", label: "Outgoing domestic wire" },
  { key: "paper_statement", label: "Paper statement" },
  { key: "card_replacement", label: "Debit card replacement" },
] as const;

export type CityFeeKey = (typeof CITY_FEES)[number]["key"];

/** One institution's published amount for a fee, with the line it came from. */
export interface CityFeeValue {
  amount: number;
  fee_name: string;
  /** The account the fee belongs to, when the schedule names one; null when it does not say. */
  account: string | null;
  /**
   * Condition and waiver text from the schedule, the pipeline's own notes removed. Unfiltered:
   * the page decides which of these read as conditions (`account-details.ts`).
   */
  conditions: string[];
  /** The schedule's own line for the fee, verbatim, when one was stored. */
  source_line: string | null;
  source_url: string | null;
  read_on: string | null;
}

/** Whether we hold the institution's schedule: decides how a missing fee is explained. */
export type ScheduleStatus = "published" | "found" | "none";

export interface CityMarketInstitution {
  id: number;
  name: string;
  charter: "bank" | "credit_union";
  hq_city: string | null;
  hq_state: string | null;
  branches: number;
  /** Bank deposits held at its branches in this area; null for credit unions (NCUA has no branch deposits). */
  deposits: number | null;
  schedule: ScheduleStatus;
  fees: Partial<Record<CityFeeKey, CityFeeValue>>;
}

export interface BranchPoint {
  lat: number;
  lon: number;
  charter: "bank" | "credit_union";
  /** The institution the branch belongs to, so the map can name it and link to its page. */
  institution_id: number;
  name: string;
  /** Street address from the FDIC or NCUA branch record, when it has one. */
  address: string | null;
}

/** One year of Summary of Deposits totals for the area, its state and the U.S. */
export interface DepositYear {
  year: number;
  area_deposits: number;
  area_branches: number;
  state_deposits: number;
  state_branches: number;
  us_deposits: number;
  us_branches: number;
}

/** Census ACS 5-year figures for one geography in two releases. */
export interface CommunityFigures {
  name: string;
  population: number | null;
  population_before: number | null;
  /** Median household income; null for the U.S., which the county and state rows can't give. */
  median_household_income: number | null;
  poverty_rate: number | null;
  year: number | null;
  year_before: number | null;
}

export interface CityMarket {
  city: string;
  state: string;
  area: CityArea;
  /** The metro (MSA) the city's branches sit in, when the Summary of Deposits names one. */
  metro: { code: number; name: string } | null;
  sod_year: number;
  institutions: CityMarketInstitution[];
  bank_branches: number;
  cu_branches: number;
  points: BranchPoint[];
  /** Branches with no map coordinates: listed, never plotted. Address when the record has one. */
  unplaced: Omit<BranchPoint, "lat" | "lon">[];
  deposit_years: DepositYear[];
  /** County (city view) or metro counties summed, the state and the U.S. */
  community: { area: CommunityFigures | null; state: CommunityFigures | null; us: CommunityFigures | null };
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

/** Which rows of a schedule stand for a fee: the highest overdraft, the middle row for the rest. */
const PICK_HIGHEST = new Set<string>(["overdraft"]);

async function latestSodYear(): Promise<number> {
  const rows = (await sql`SELECT MAX(year) AS year FROM institution_branch_deposits`) as { year: unknown }[];
  return num(rows[0]?.year) || new Date().getUTCFullYear();
}

/**
 * Every spelling the branch records use for this city in the state ("ST. PETERSBURG",
 * "SAINT PETERSBURG", "ST PETERSBURG"), folded by `cityKey`, upper case. Always includes the
 * spelling asked for, so a city the fold does not know still reads as before.
 */
async function citySpellings(upperCity: string, state: string, year: number): Promise<string[]> {
  const rows = (await sql`
    SELECT DISTINCT UPPER(city) AS city FROM institution_branch_deposits
     WHERE year = ${year} AND state = ${state} AND city IS NOT NULL AND city <> ''
    UNION
    SELECT DISTINCT UPPER(city) FROM credit_union_branches
     WHERE state = ${state} AND city IS NOT NULL AND city <> ''
  `) as { city: unknown }[];
  const key = cityKey(upperCity);
  return [...new Set([upperCity, ...rows.map((r) => String(r.city)).filter((c) => cityKey(c) === key)])];
}

/**
 * The market for one city. Null when no bank or credit union branch sits in the city, so the
 * page can answer 404 or fall back.
 */
export async function getCityMarket(city: string, stateCode: string, area: CityArea): Promise<CityMarket | null> {
  const state = stateCode.toUpperCase();
  const upperCity = city.toUpperCase();
  const year = await latestSodYear();
  // One market under every spelling of the city's name, as the state directory counts it.
  const spellings = await citySpellings(upperCity, state, year);

  const metroRows = (await sql`
    SELECT msa_code, MAX(msa_name) AS msa_name, COUNT(*) AS n
      FROM institution_branch_deposits
     WHERE year = ${year} AND state = ${state} AND UPPER(city) = ANY(${spellings}::text[]) AND msa_code IS NOT NULL AND msa_code > 0
     GROUP BY msa_code ORDER BY n DESC LIMIT 1
  `) as { msa_code: unknown; msa_name: string | null }[];
  const metro = metroRows[0] ? { code: num(metroRows[0].msa_code), name: String(metroRows[0].msa_name ?? "") } : null;
  const useMetro = area === "metro" && metro != null;

  const bankBranches = (useMetro
    ? await sql`
        SELECT institution_id, deposits, latitude, longitude, state, UPPER(city) AS city, county_fips, address
          FROM institution_branch_deposits
         WHERE year = ${year} AND msa_code = ${metro!.code}`
    : await sql`
        SELECT institution_id, deposits, latitude, longitude, state, UPPER(city) AS city, county_fips, address
          FROM institution_branch_deposits
         WHERE year = ${year} AND state = ${state} AND UPPER(city) = ANY(${spellings}::text[])`) as Record<string, unknown>[];

  const places = useMetro
    ? [...new Set(bankBranches.map((b) => `${b.state}|${b.city}`))]
    : spellings.map((c) => `${state}|${c}`);
  const cuBranches = (await sql`
    SELECT c.institution_id, c.latitude, c.longitude, c.address
      FROM credit_union_branches c
     WHERE c.institution_id IS NOT NULL
       AND (c.state || '|' || UPPER(c.city)) = ANY(${places}::text[])
  `) as Record<string, unknown>[];

  if (bankBranches.length === 0 && cuBranches.length === 0) return null;

  const byInst = new Map<number, { branches: number; deposits: number | null; charter: "bank" | "credit_union" }>();
  for (const b of bankBranches) {
    if (b.institution_id == null) continue;
    const id = num(b.institution_id);
    const cur = byInst.get(id) ?? { branches: 0, deposits: 0, charter: "bank" as const };
    cur.branches += 1;
    cur.deposits = (cur.deposits ?? 0) + num(b.deposits);
    byInst.set(id, cur);
  }
  for (const c of cuBranches) {
    const id = num(c.institution_id);
    if (byInst.get(id)?.charter === "bank") continue;
    const cur = byInst.get(id) ?? { branches: 0, deposits: null, charter: "credit_union" as const };
    cur.branches += 1;
    byInst.set(id, cur);
  }
  const ids = [...byInst.keys()];

  const counties = [...new Set(bankBranches.map((b) => num(b.county_fips)).filter((f) => f > 0))];
  // The city view's county: the one holding most of the city's branches.
  const countyCounts = new Map<number, number>();
  for (const b of bankBranches) countyCounts.set(num(b.county_fips), (countyCounts.get(num(b.county_fips)) ?? 0) + 1);
  const mainCounty = [...countyCounts.entries()].filter(([f]) => f > 0).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const communityCounties = useMetro ? counties : mainCounty ? [mainCounty] : [];

  const [instRows, feeRows, depositRows, community] = await Promise.all([
    ids.length
      ? (sql`
          SELECT s.id, s.institution_name, s.charter_type, s.city, s.state_code, s.fee_schedule_url,
                 EXISTS (SELECT 1 FROM published_fee_catalog p WHERE p.institution_id = s.id AND p.review_status = 'approved') AS has_fees
            FROM institution_sources s
           WHERE s.id = ANY(${ids}::bigint[])
             AND ${sql.unsafe(activeInstitutionFilter("s"))}` as unknown as Promise<Record<string, unknown>[]>)
      : Promise.resolve([] as Record<string, unknown>[]),
    ids.length
      ? (sql.unsafe(
          `WITH rows AS (
             SELECT ef.institution_id, ef.fee_category, ef.amount, ef.fee_name, ef.conditions,
                    ef.account_product_type, ef.waiver_text, ef.extraction_note,
                    COALESCE(ef.document_url, ef.source_url) AS source_url, ef.created_at::date::text AS read_on,
                    ROW_NUMBER() OVER (PARTITION BY ef.institution_id, ef.fee_category ORDER BY ef.amount, ef.id) AS rn,
                    COUNT(*) OVER (PARTITION BY ef.institution_id, ef.fee_category) AS n
               FROM published_fee_catalog ef
               JOIN institution_sources ct ON ct.id = ef.institution_id
              WHERE ef.institution_id = ANY($1::bigint[])
                AND ${activeInstitutionFilter("ct")}
                AND ef.fee_category = ANY($2::text[])
                AND ef.review_status = 'approved' AND ef.amount IS NOT NULL AND ef.amount >= 0
                AND ${statsRowFilter("ef")}
           )
           SELECT institution_id, fee_category, amount, fee_name, conditions,
                  account_product_type, waiver_text, extraction_note, source_url, read_on
             FROM rows
            WHERE (fee_category = ANY($3::text[]) AND rn = n)
               OR (NOT fee_category = ANY($3::text[]) AND rn = (n + 1) / 2)`,
          [ids, CITY_FEES.map((f) => f.key), [...PICK_HIGHEST]],
        ) as unknown as Promise<Record<string, unknown>[]>)
      : Promise.resolve([] as Record<string, unknown>[]),
    loadDepositYears(year, state, useMetro ? { metro: metro!.code } : { cities: spellings }),
    loadCommunity(state, communityCounties, useMetro ? metro!.name : null),
  ]);

  const fees = new Map<number, Partial<Record<CityFeeKey, CityFeeValue>>>();
  for (const r of feeRows) {
    const id = num(r.institution_id);
    const entry = fees.get(id) ?? {};
    entry[r.fee_category as CityFeeKey] = cityFeeValue(r);
    fees.set(id, entry);
  }

  const institutions: CityMarketInstitution[] = instRows.map((r) => {
    const id = num(r.id);
    const local = byInst.get(id)!;
    return {
      id,
      name: String(r.institution_name ?? ""),
      charter: r.charter_type === "credit_union" ? "credit_union" : local.charter,
      hq_city: r.city ? String(r.city) : null,
      hq_state: r.state_code ? String(r.state_code) : null,
      branches: local.branches,
      deposits: local.deposits,
      schedule: r.has_fees ? "published" : r.fee_schedule_url ? "found" : "none",
      fees: fees.get(id) ?? {},
    };
  });
  institutions.sort((a, b) => b.branches - a.branches || (b.deposits ?? 0) - (a.deposits ?? 0) || a.name.localeCompare(b.name));

  const names = new Map(institutions.map((i) => [i.id, i.name]));
  const points: BranchPoint[] = [];
  const unplaced: Omit<BranchPoint, "lat" | "lon">[] = [];
  const addPoint = (row: Record<string, unknown>, charter: BranchPoint["charter"]) => {
    const lat = numOrNull(row.latitude);
    const lon = numOrNull(row.longitude);
    const id = row.institution_id == null ? null : num(row.institution_id);
    if (id == null || !names.has(id)) return;
    const address = row.address ? String(row.address).trim() : "";
    if (lat == null || lon == null || lat === 0) {
      unplaced.push({ charter, institution_id: id, name: names.get(id)!, address: address || null });
      return;
    }
    points.push({ lat, lon, charter, institution_id: id, name: names.get(id)!, address: address || null });
  };
  for (const b of bankBranches) addPoint(b, "bank");
  for (const c of cuBranches) addPoint(c, "credit_union");

  return {
    city,
    state,
    area: useMetro ? "metro" : "city",
    metro,
    sod_year: year,
    institutions,
    bank_branches: bankBranches.length,
    cu_branches: cuBranches.length,
    points,
    unplaced,
    deposit_years: depositRows,
    community,
  };
}

/**
 * One catalog row as the city page shows it: the account it belongs to when the schedule names
 * one, the condition and waiver text without the pipeline's notes, and the schedule's own line.
 * The line is the shared evidence read (`feeEvidence`) when it prints the price, else the line
 * stored with the fee.
 */
export function cityFeeValue(r: Record<string, unknown>): CityFeeValue {
  const feeName = String(r.fee_name ?? "");
  const extractionNote = r.extraction_note ? String(r.extraction_note) : null;
  const rawConditions = r.conditions ? String(r.conditions) : null;
  const evidence = feeEvidence(
    { fee_name: feeName, amount: num(r.amount), fee_category: r.fee_category ? String(r.fee_category) : null, extraction_note: extractionNote, conditions: rawConditions },
    null,
  );
  const stored = storedLineOf({ extraction_note: extractionNote, conditions: rawConditions });
  const conditions = [readerFeeConditions(rawConditions), waiverForDisplay(r.waiver_text ? String(r.waiver_text) : null), evidence?.condition ?? null]
    .filter((c): c is string => Boolean(c && c.trim()))
    .map((c) => c.trim());
  return {
    amount: num(r.amount),
    fee_name: feeName,
    account: readableProductName(r.account_product_type ? String(r.account_product_type) : null) ?? productNameFromFeeName(feeName) ?? evidence?.heading ?? null,
    conditions: [...new Set(conditions)],
    source_line: evidence?.line ?? (stored ? stored.replace(/\\"/g, '"').replace(/\s+/g, " ").trim() || null : null),
    source_url: r.source_url ? String(r.source_url) : null,
    read_on: r.read_on ? String(r.read_on) : null,
  };
}

/** First year in the deposit and branch trend. */
const TREND_FROM_YEARS_BACK = 10;

async function loadDepositYears(year: number, state: string, where: { metro: number } | { cities: string[] }): Promise<DepositYear[]> {
  const from = year - TREND_FROM_YEARS_BACK;
  const inArea = "metro" in where ? `msa_code = ${Number(where.metro)}` : `state = $2 AND UPPER(city) = ANY($3::text[])`;
  const params = "metro" in where ? [from, state] : [from, state, where.cities];
  const rows = (await sql.unsafe(
    `SELECT year,
            SUM(deposits) FILTER (WHERE ${inArea}) AS area_deposits,
            COUNT(*) FILTER (WHERE ${inArea}) AS area_branches,
            SUM(deposits) FILTER (WHERE state = $2) AS state_deposits,
            COUNT(*) FILTER (WHERE state = $2) AS state_branches,
            SUM(deposits) AS us_deposits,
            COUNT(*) AS us_branches
       FROM institution_branch_deposits
      WHERE year >= $1
      GROUP BY year ORDER BY year`,
    params,
  )) as unknown as Record<string, unknown>[];
  return rows.map((r) => ({
    year: num(r.year),
    area_deposits: num(r.area_deposits),
    area_branches: num(r.area_branches),
    state_deposits: num(r.state_deposits),
    state_branches: num(r.state_branches),
    us_deposits: num(r.us_deposits),
    us_branches: num(r.us_branches),
  }));
}

async function loadCommunity(
  state: string,
  countyFips: number[],
  metroName: string | null,
): Promise<CityMarket["community"]> {
  const stateFips = STATE_TO_FIPS[state];
  if (!stateFips) return { area: null, state: null, us: null };
  const countyIds = countyFips.map((f) => `county:${String(f).padStart(5, "0")}`);
  const rows = (await sql.unsafe(
    `SELECT geo_type, geo_id, geo_name, year, total_population, median_household_income, poverty_count
       FROM demographics
      WHERE (geo_type = 'county' AND geo_id = ANY($1::text[]))
         OR geo_type = 'state'
      ORDER BY year`,
    [countyIds],
  )) as unknown as Record<string, unknown>[];

  const years = [...new Set(rows.map((r) => num(r.year)))].sort((a, b) => a - b);
  const latest = years[years.length - 1] ?? null;
  const before = years.length > 1 ? years[years.length - 2] : null;
  const sumFor = (filter: (r: Record<string, unknown>) => boolean, y: number | null) => {
    const list = rows.filter((r) => num(r.year) === y && filter(r));
    if (list.length === 0) return null;
    return {
      population: list.reduce((s, r) => s + num(r.total_population), 0),
      poverty: list.reduce((s, r) => s + num(r.poverty_count), 0),
      income: list.length === 1 ? numOrNull(list[0].median_household_income) : null,
      name: String(list[0].geo_name ?? ""),
    };
  };
  const figures = (name: string, filter: (r: Record<string, unknown>) => boolean): CommunityFigures | null => {
    const now = sumFor(filter, latest);
    if (!now || now.population === 0) return null;
    const then = sumFor(filter, before);
    return {
      name,
      population: now.population,
      population_before: then?.population ?? null,
      median_household_income: now.income,
      poverty_rate: now.poverty / now.population,
      year: latest,
      year_before: before,
    };
  };

  const isArea = (r: Record<string, unknown>) => r.geo_type === "county" && countyIds.includes(String(r.geo_id));
  const areaName = metroName ?? String(rows.find(isArea)?.geo_name ?? "").replace(/,.*$/, "");
  return {
    area: countyIds.length ? figures(areaName, isArea) : null,
    state: figures(state, (r) => r.geo_type === "state" && r.geo_id === `state:${stateFips}`),
    // Puerto Rico and DC rows aside, the states sum to the country; a median can't be summed.
    us: (() => {
      const f = figures("U.S.", (r) => r.geo_type === "state" && r.geo_id !== "state:72");
      return f ? { ...f, median_household_income: null } : null;
    })(),
  };
}

/** One city in a state's market directory. */
export interface StateMarketCity {
  /** The spelling the city is named and linked under, upper case, as a branch record writes it. */
  city: string;
  /** Every spelling folded into this city (`cityKey`), upper case, the named one first. */
  spellings: string[];
  /** Banks and credit unions with a branch in the city, each counted once across its spellings. */
  institutions: number;
  /** Of those, the ones whose fees we publish. */
  with_fees: number;
  branches: number;
  metro: string | null;
  /** The middle of the city's branch coordinates, for placing it on a state map; null when no branch has them. */
  lat: number | null;
  lon: number | null;
}

/** One spelling of a city as the state directory read returns it, before spellings are folded. */
export interface CitySpellingRow {
  city: string;
  institution_ids: number[];
  /** The ones among `institution_ids` with approved published fees. */
  published_ids: number[];
  branches: number;
  metro: string | null;
  lat: number | null;
  lon: number | null;
}

/**
 * The state's cities with the spellings of one city folded together (`foldCitySpellings`): its
 * institutions are the union over its spellings, so one with branches under two spellings counts
 * once; branches add up; the map point is the most-used spelling's that has one. Cities none of
 * whose institutions publish fees are left out. Largest first by institutions, then by name. Pure.
 */
export function foldStateMarketCities(rows: CitySpellingRow[]): StateMarketCity[] {
  const folded = foldCitySpellings(rows.map((row) => ({ name: row.city, branches: row.branches, row })));
  const cities: StateMarketCity[] = folded.map(({ name, spellings }) => {
    const ids = new Set(spellings.flatMap((s) => s.row.institution_ids));
    const published = new Set(spellings.flatMap((s) => s.row.published_ids));
    const placed = [...spellings].sort((a, b) => b.branches - a.branches).find((s) => s.row.lat != null && s.row.lon != null);
    return {
      city: name,
      spellings: spellings.map((s) => s.name),
      institutions: ids.size,
      with_fees: published.size,
      branches: spellings.reduce((sum, s) => sum + s.row.branches, 0),
      metro: spellings.find((s) => s.row.metro)?.row.metro ?? null,
      lat: placed?.row.lat ?? null,
      lon: placed?.row.lon ?? null,
    };
  });
  return cities.filter((c) => c.with_fees > 0).sort((a, b) => b.institutions - a.institutions || a.city.localeCompare(b.city));
}

const idList = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x) => x != null).map(num) : []);

/**
 * Every city in a state with a bank or credit union branch and at least one institution with
 * published fees, by how many institutions serve it, with the spellings of one city folded.
 */
export async function getStateMarketCities(stateCode: string): Promise<StateMarketCity[]> {
  const state = stateCode.toUpperCase();
  const year = await latestSodYear();
  // One row per spelling; the fold counts institutions once per city in foldStateMarketCities.
  const rows = (await sql`
    WITH all_branches AS (
      SELECT UPPER(city) AS city, institution_id, msa_name, latitude, longitude
        FROM institution_branch_deposits
       WHERE year = ${year} AND state = ${state} AND city IS NOT NULL AND city <> ''
      UNION ALL
      SELECT UPPER(city), institution_id, NULL, latitude, longitude
        FROM credit_union_branches
       WHERE state = ${state} AND city IS NOT NULL AND city <> ''
    ),
    -- The regulator's inactive institutions are left out, as every public count does (#2190);
    -- a branch with no institution on file still counts as a branch.
    branches AS (
      SELECT a.* FROM all_branches a
        LEFT JOIN institution_sources ct ON ct.id = a.institution_id
       WHERE ${sql.unsafe(activeInstitutionFilter("ct"))}
    ),
    published AS (
      SELECT DISTINCT ef.institution_id
        FROM published_fee_catalog ef
        JOIN institution_sources ct ON ct.id = ef.institution_id
       WHERE ef.review_status = 'approved' AND ${sql.unsafe(activeInstitutionFilter("ct"))}
    )
    SELECT b.city,
           ARRAY_AGG(DISTINCT b.institution_id) FILTER (WHERE b.institution_id IS NOT NULL) AS institution_ids,
           ARRAY_AGG(DISTINCT p.institution_id) FILTER (WHERE p.institution_id IS NOT NULL) AS published_ids,
           COUNT(*) AS branches,
           MAX(b.msa_name) AS metro,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY b.latitude) FILTER (WHERE b.latitude IS NOT NULL AND b.longitude IS NOT NULL AND b.latitude <> 0 AND b.longitude <> 0) AS lat,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY b.longitude) FILTER (WHERE b.latitude IS NOT NULL AND b.longitude IS NOT NULL AND b.latitude <> 0 AND b.longitude <> 0) AS lon
      FROM branches b
      LEFT JOIN published p ON p.institution_id = b.institution_id
     GROUP BY b.city
  `) as Record<string, unknown>[];
  return foldStateMarketCities(
    rows.map((r) => ({
      city: String(r.city),
      institution_ids: idList(r.institution_ids),
      published_ids: idList(r.published_ids),
      branches: num(r.branches),
      metro: r.metro ? String(r.metro) : null,
      lat: numOrNull(r.lat),
      lon: numOrNull(r.lon),
    })),
  );
}

/** True when any bank or credit union branch sits in the city: the city page has a market to show. */
export async function cityHasBranches(city: string, stateCode: string): Promise<boolean> {
  const state = stateCode.toUpperCase();
  const upperCity = city.toUpperCase();
  const rows = (await sql`
    SELECT EXISTS (
             SELECT 1 FROM institution_branch_deposits
              WHERE state = ${state} AND UPPER(city) = ${upperCity}
                AND year = (SELECT MAX(year) FROM institution_branch_deposits)
           ) OR EXISTS (
             SELECT 1 FROM credit_union_branches WHERE state = ${state} AND UPPER(city) = ${upperCity}
           ) AS found
  `) as { found: unknown }[];
  return rows[0]?.found === true;
}
