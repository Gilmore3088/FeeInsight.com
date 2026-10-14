import { sql } from "./connection";
import { STATS_ROW_FILTER } from "./fee-stats";

/**
 * Data behind Hamilton's new market study: a bank looking at a county where it may not have
 * branches yet. Branch deposits come from the FDIC Summary of Deposits
 * (institution_branch_deposits, stored in thousands of dollars), fees from
 * published_fee_catalog (dollar fees only), households from the Census ACS (demographics).
 * Nothing is estimated: a value that is not on file is null and the study says so.
 */

/** Fees the study compares, in display order. */
export const MARKET_STUDY_FEES = [
  "overdraft",
  "nsf",
  "stop_payment",
  "wire_domestic_outgoing",
  "wire_domestic_incoming",
  "cashiers_check",
  "atm_non_network",
  "monthly_maintenance",
] as const;

/** Years between the latest deposit year and the comparison year for share changes. */
export const SHARE_LOOKBACK_YEARS = 5;

export interface MarketStudyBranch {
  /** null when the FDIC certificate is not matched to an institution on file. */
  institution_id: number | null;
  cert: number;
  branch_name: string | null;
  city: string | null;
  county_fips: string;
  latitude: number | null;
  longitude: number | null;
  /** Deposits in dollars; 0 when the branch reports none. */
  deposits: number;
}

export interface MarketStudyMember {
  /** Institution id, or the negative FDIC certificate when the bank is not matched. */
  key: number;
  institution_id: number | null;
  name: string;
  deposits: number;
  /** Deposits in the county SHARE_LOOKBACK_YEARS earlier; null when it had no branch then. */
  deposits_earlier: number | null;
  branches: number;
}

export interface MarketStudyFee {
  category: string;
  subject: number | null;
  competitors: { institution_id: number; amount: number }[];
}

export interface MarketStudyHousehold {
  role: "target" | "subject" | "state";
  /** Five-digit county FIPS, or the two-digit state FIPS. */
  fips: string;
  name: string;
  income: number | null;
  population: number | null;
  poverty: number | null;
  year: number;
}

export interface MarketStudyData {
  subject: { institution_id: number; name: string; state_code: string | null };
  county_fips: string;
  sod_year: number;
  earlier_year: number;
  totals: { year: number; deposits: number }[];
  branches: MarketStudyBranch[];
  subject_branches: MarketStudyBranch[];
  members: MarketStudyMember[];
  fees: MarketStudyFee[];
  households: MarketStudyHousehold[];
}

const THOUSANDS = 1000;
const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const fips5 = (v: unknown): string => String(v).padStart(5, "0");

/** A county FIPS ("42001") as the integer the SOD table stores. */
export function countyFipsInt(fips: string): number | null {
  return /^\d{4,5}$/.test(fips) ? Number(fips) : null;
}

/** Raw rows the loader reads, kept separate so the assembly below is a pure, tested function. */
export interface MarketStudyRows {
  countyFips: string;
  subject: { id: number; name: string; state_code: string | null };
  totals: { year: number; deposits: unknown }[];
  branches: { institution_id: number | null; cert: number; name: string | null; branch_name: string | null; city: string | null; latitude: unknown; longitude: unknown; deposits: unknown }[];
  /** Deposits per institution (or negative certificate) SHARE_LOOKBACK_YEARS before, in thousands. */
  earlier: { key: unknown; deposits: unknown }[];
  subjectBranches: { cert: number; branch_name: string | null; city: string | null; county_fips: unknown; latitude: unknown; longitude: unknown; deposits: unknown }[];
  fees: { institution_id: number; fee_category: string; amount: unknown }[];
  demographics: { geo_id: string; geo_name: string; median_household_income: unknown; total_population: unknown; poverty_count: unknown; year: number }[];
}

export async function getMarketStudyData(institutionId: number, countyFips: string): Promise<MarketStudyData | null> {
  const county = countyFipsInt(countyFips);
  if (county === null) return null;
  const target = fips5(countyFips);

  const [subjectRows, totalRows] = await Promise.all([
    sql<{ id: number; name: string; state_code: string | null }[]>`
      SELECT id, institution_name AS name, state_code FROM institution_sources WHERE id = ${institutionId}`,
    sql<{ year: number; deposits: unknown }[]>`
      SELECT year, SUM(COALESCE(deposits, 0)) AS deposits
        FROM institution_branch_deposits WHERE county_fips = ${county}
       GROUP BY year ORDER BY year`,
  ]);
  const subject = subjectRows[0];
  if (!subject || totalRows.length === 0) return null;
  const sodYear = Math.max(...totalRows.map((r) => Number(r.year)));
  const earlierYear = sodYear - SHARE_LOOKBACK_YEARS;

  const [branchRows, earlierRows, subjectBranchRows] = await Promise.all([
    sql<MarketStudyRows["branches"]>`
      SELECT d.institution_id, d.cert, s.institution_name AS name, d.branch_name, d.city, d.latitude, d.longitude, d.deposits
        FROM institution_branch_deposits d
        LEFT JOIN institution_sources s ON s.id = d.institution_id
       WHERE d.county_fips = ${county} AND d.year = ${sodYear}`,
    sql<MarketStudyRows["earlier"]>`
      SELECT COALESCE(institution_id, -cert) AS key, SUM(COALESCE(deposits, 0)) AS deposits
        FROM institution_branch_deposits
       WHERE county_fips = ${county} AND year = ${earlierYear}
       GROUP BY 1`,
    sql<MarketStudyRows["subjectBranches"]>`
      SELECT cert, branch_name, city, county_fips, latitude, longitude, deposits
        FROM institution_branch_deposits
       WHERE institution_id = ${institutionId}
         AND year = (SELECT MAX(year) FROM institution_branch_deposits WHERE institution_id = ${institutionId})
         AND county_fips IS NOT NULL`,
  ]);

  const feeIds = [institutionId, ...new Set(branchRows.flatMap((r) => (r.institution_id !== null ? [Number(r.institution_id)] : [])))];
  const subjectCounties = topCountiesFromRows(subjectBranchRows, 3).filter((f) => f !== target);
  const geoIds = [`county:${target}`, ...subjectCounties.map((f) => `county:${f}`), `state:${target.slice(0, 2)}`];
  const categories = [...MARKET_STUDY_FEES];

  const [feeRows, demoRows] = await Promise.all([
    sql<MarketStudyRows["fees"]>`
      SELECT ef.institution_id, ef.fee_category,
             CASE WHEN ef.fee_category = 'overdraft' THEN MAX(ef.amount)
                  ELSE percentile_cont(0.5) WITHIN GROUP (ORDER BY ef.amount) END AS amount
        FROM published_fee_catalog ef
       WHERE ef.institution_id = ANY(${feeIds}::bigint[]) AND ef.fee_category = ANY(${categories}::text[])
         AND ef.amount IS NOT NULL AND ef.amount >= 0
         AND ${sql.unsafe(STATS_ROW_FILTER)}
       GROUP BY ef.institution_id, ef.fee_category`,
    sql<MarketStudyRows["demographics"]>`
      SELECT DISTINCT ON (geo_id) geo_id, geo_name, median_household_income, total_population, poverty_count, year
        FROM demographics WHERE geo_id = ANY(${geoIds}::text[])
       ORDER BY geo_id, year DESC`,
  ]);

  return assembleMarketStudy({
    countyFips: target,
    subject,
    totals: totalRows,
    branches: branchRows,
    earlier: earlierRows,
    subjectBranches: subjectBranchRows,
    fees: feeRows,
    demographics: demoRows,
  });
}

function topCountiesFromRows(rows: MarketStudyRows["subjectBranches"], n: number): string[] {
  const by = new Map<string, number>();
  for (const r of rows) by.set(fips5(r.county_fips), (by.get(fips5(r.county_fips)) ?? 0) + (num(r.deposits) ?? 0));
  return [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([f]) => f);
}

/** Shape the loader's rows into the study's data. Pure: deposits arrive in thousands. */
export function assembleMarketStudy(rows: MarketStudyRows): MarketStudyData | null {
  const target = fips5(rows.countyFips);
  if (rows.totals.length === 0) return null;
  const institutionId = Number(rows.subject.id);
  const sodYear = Math.max(...rows.totals.map((r) => Number(r.year)));
  const earlierYear = sodYear - SHARE_LOOKBACK_YEARS;

  const branches: MarketStudyBranch[] = rows.branches.map((r) => ({
    institution_id: r.institution_id === null ? null : Number(r.institution_id),
    cert: Number(r.cert),
    branch_name: r.branch_name,
    city: r.city,
    county_fips: target,
    latitude: num(r.latitude),
    longitude: num(r.longitude),
    deposits: (num(r.deposits) ?? 0) * THOUSANDS,
  }));
  const subjectBranches: MarketStudyBranch[] = rows.subjectBranches.map((r) => ({
    institution_id: institutionId,
    cert: Number(r.cert),
    branch_name: r.branch_name,
    city: r.city,
    county_fips: fips5(r.county_fips),
    latitude: num(r.latitude),
    longitude: num(r.longitude),
    deposits: (num(r.deposits) ?? 0) * THOUSANDS,
  }));

  const earlier = new Map(rows.earlier.map((r) => [Number(r.key), (num(r.deposits) ?? 0) * THOUSANDS]));
  const byKey = new Map<number, MarketStudyMember>();
  for (const r of rows.branches) {
    const id = r.institution_id === null ? null : Number(r.institution_id);
    const key = id ?? -Number(r.cert);
    const m = byKey.get(key) ?? {
      key,
      institution_id: id,
      name: r.name ?? `FDIC certificate ${r.cert}`,
      deposits: 0,
      deposits_earlier: earlier.get(key) ?? null,
      branches: 0,
    };
    m.deposits += (num(r.deposits) ?? 0) * THOUSANDS;
    m.branches += 1;
    byKey.set(key, m);
  }
  const members = [...byKey.values()].sort((a, b) => b.deposits - a.deposits);

  const fees: MarketStudyFee[] = MARKET_STUDY_FEES.map((category) => {
    const feeRows = rows.fees.filter((r) => r.fee_category === category);
    const own = feeRows.find((r) => Number(r.institution_id) === institutionId);
    return {
      category,
      subject: own ? num(own.amount) : null,
      competitors: feeRows
        .filter((r) => Number(r.institution_id) !== institutionId)
        .flatMap((r) => {
          const amount = num(r.amount);
          return amount === null ? [] : [{ institution_id: Number(r.institution_id), amount }];
        }),
    };
  });

  const order = (geoId: string) => (geoId.startsWith("state:") ? 2 : geoId === `county:${target}` ? 0 : 1);
  const households: MarketStudyHousehold[] = [...rows.demographics]
    .sort((a, b) => order(a.geo_id) - order(b.geo_id))
    .map((r) => {
      const [kind, code] = r.geo_id.split(":");
      return {
        role: kind === "state" ? "state" : code === target ? "target" : "subject",
        fips: code,
        name: r.geo_name.replace(/,\s*[^,]+$/, "").replace(/ County$/, ""),
        income: num(r.median_household_income),
        population: num(r.total_population),
        poverty: num(r.poverty_count),
        year: Number(r.year),
      } satisfies MarketStudyHousehold;
    });

  return {
    subject: { institution_id: institutionId, name: rows.subject.name, state_code: rows.subject.state_code },
    county_fips: target,
    sod_year: sodYear,
    earlier_year: earlierYear,
    totals: rows.totals.map((r) => ({ year: Number(r.year), deposits: (num(r.deposits) ?? 0) * THOUSANDS })),
    branches,
    subject_branches: subjectBranches,
    members,
    fees,
    households,
  };
}

/** The counties holding most of a bank's branch deposits, largest first. */
export function topCounties(branches: MarketStudyBranch[], n: number): string[] {
  const by = new Map<string, number>();
  for (const b of branches) by.set(b.county_fips, (by.get(b.county_fips) ?? 0) + b.deposits);
  return [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([f]) => f);
}

export interface MarketCandidate {
  fips: string;
  deposits: number;
  branches: number;
  institutions: number;
}

/** Deposit size of the given counties in the latest year, for ranking the study's county picker. */
export async function getCountyDepositTotals(countyFips: string[]): Promise<MarketCandidate[]> {
  const ints = countyFips.map(countyFipsInt).filter((v): v is number => v !== null);
  if (ints.length === 0) return [];
  const rows = await sql<{ fips: unknown; deposits: unknown; branches: unknown; institutions: unknown }[]>`
    SELECT county_fips AS fips, SUM(COALESCE(deposits, 0)) AS deposits, COUNT(*) AS branches,
           COUNT(DISTINCT COALESCE(institution_id, -cert)) AS institutions
      FROM institution_branch_deposits
     WHERE county_fips = ANY(${ints}::int[])
       AND year = (SELECT MAX(year) FROM institution_branch_deposits)
     GROUP BY county_fips`;
  return rows
    .map((r) => ({ fips: fips5(r.fips), deposits: (num(r.deposits) ?? 0) * THOUSANDS, branches: num(r.branches) ?? 0, institutions: num(r.institutions) ?? 0 }))
    .sort((a, b) => b.deposits - a.deposits);
}

/** The counties where a bank has branches in its latest Summary of Deposits year. */
export async function getInstitutionCounties(institutionId: number): Promise<string[]> {
  const rows = await sql<{ fips: unknown }[]>`
    SELECT DISTINCT county_fips AS fips FROM institution_branch_deposits
     WHERE institution_id = ${institutionId} AND county_fips IS NOT NULL
       AND year = (SELECT MAX(year) FROM institution_branch_deposits WHERE institution_id = ${institutionId})`;
  return rows.map((r) => fips5(r.fips));
}
