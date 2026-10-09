import { sql } from "./connection";
import { institutionDisplayName } from "@/lib/institution-display-name";

/**
 * Branch locations: banks from the FDIC Summary of Deposits (institution_branch_deposits,
 * latest survey year, with deposits) and credit unions from NCUA's branch file
 * (credit_union_branches, no deposits; coordinates once the Census geocoder has run).
 */

const SOD_THOUSANDS = 1_000;

export interface BranchRow {
  /** fdic_sod for banks, ncua for credit unions. */
  source: "fdic_sod" | "ncua";
  institution_id: number | null;
  institution_name: string | null;
  branch_name: string | null;
  is_main_office: boolean;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  county_fips: number | null;
  county_name: string | null;
  msa_name: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Deposits at the branch, whole dollars; null for credit unions (NCUA reports none by branch). */
  deposits: number | null;
}

export interface BranchPage {
  sod_year: number | null;
  total: number;
  rows: BranchRow[];
}

interface RawBranch {
  source: "fdic_sod" | "ncua";
  institution_id: string | number | null;
  institution_name: string | null;
  branch_name: string | null;
  is_main_office: boolean | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  county_fips: number | null;
  county_name: string | null;
  msa_name: string | null;
  latitude: number | null;
  longitude: number | null;
  deposits: string | number | null;
  year: number | null;
  total: string | number;
}

function toRow(r: RawBranch): BranchRow {
  const deposits = r.deposits === null ? null : Number(r.deposits);
  return {
    source: r.source,
    institution_id: r.institution_id === null ? null : Number(r.institution_id),
    institution_name: institutionDisplayName(r.institution_name),
    branch_name: r.branch_name,
    is_main_office: r.is_main_office === true,
    address: r.address,
    city: r.city,
    state: r.state,
    zip: r.zip,
    county_fips: r.county_fips,
    county_name: r.county_name,
    msa_name: r.msa_name,
    latitude: r.latitude === null ? null : Number(r.latitude),
    longitude: r.longitude === null ? null : Number(r.longitude),
    deposits: deposits === null || !Number.isFinite(deposits) ? null : deposits * SOD_THOUSANDS,
  };
}

function toPage(rows: RawBranch[]): BranchPage {
  return {
    sod_year: rows.find((r) => r.year !== null)?.year ?? null,
    total: rows.length ? Number(rows[0].total) : 0,
    rows: rows.map(toRow),
  };
}

/** Both branch sources as one row shape; banks from the latest SOD year, credit unions as last reported. */
function allBranches() {
  return sql`
  SELECT 'fdic_sod'::text AS source, b.institution_id, s.institution_name, b.branch_name, b.is_main_office,
         b.address, b.city, b.state, b.zip, b.county_fips, NULL::text AS county_name, b.msa_name,
         b.latitude, b.longitude, b.deposits, b.year, b.branch_number::text AS sort_key
    FROM institution_branch_deposits b
    LEFT JOIN institution_sources s ON s.id = b.institution_id
   WHERE b.year = (SELECT MAX(year) FROM institution_branch_deposits)
  UNION ALL
  SELECT 'ncua', c.institution_id, COALESCE(s.institution_name, c.cu_name), c.site_name, c.is_main_office,
         c.address, c.city, c.state, c.zip, NULL::integer, c.county_name, NULL::text,
         c.latitude, c.longitude, NULL::bigint, NULL::integer, c.site_id
    FROM credit_union_branches c
    LEFT JOIN institution_sources s ON s.id = c.institution_id`;
}

/** Every branch of one institution, largest deposits first (credit unions: main office first). */
export async function getBranchesForInstitution(
  institutionId: number,
  opts: { limit: number; offset: number },
): Promise<BranchPage> {
  const rows = await sql<RawBranch[]>`
    SELECT a.*, COUNT(*) OVER () AS total
      FROM (${allBranches()}) a
     WHERE a.institution_id = ${institutionId}
     ORDER BY a.deposits DESC NULLS LAST, a.is_main_office DESC, a.sort_key
     LIMIT ${opts.limit} OFFSET ${opts.offset}`;
  return toPage(rows);
}

/** Every bank and credit union branch in a state, optionally narrowed to a city or ZIP code. */
export async function getBranchesInArea(
  area: { state: string; city?: string | null; zip?: string | null },
  opts: { limit: number; offset: number },
): Promise<BranchPage> {
  const city = area.city ?? null;
  const zip = area.zip ?? null;
  const rows = await sql<RawBranch[]>`
    SELECT a.*, COUNT(*) OVER () AS total
      FROM (${allBranches()}) a
     WHERE a.state = ${area.state}
       AND (${city}::text IS NULL OR UPPER(a.city) = UPPER(${city}::text))
       AND (${zip}::text IS NULL OR LEFT(a.zip, 5) = ${zip}::text)
     ORDER BY a.deposits DESC NULLS LAST, a.source, a.institution_id, a.sort_key
     LIMIT ${opts.limit} OFFSET ${opts.offset}`;
  return toPage(rows);
}

export interface MarketBranchFootprint {
  sod_year: number;
  /** Bank branches in the market counties. */
  totalBranches: number;
  /** Deposits held in those branches, whole dollars. */
  totalDeposits: number;
  /**
   * Per institution: its branches in the market and, for banks, its deposits there. Credit
   * unions carry deposits null: NCUA reports no deposits by branch, so no share is shown.
   */
  byInstitution: Record<number, { branches: number; deposits: number | null }>;
}

/**
 * Branch counts and deposit totals for a report's market counties, so the report can show each
 * named competitor's footprint. Banks come from the FDIC Summary of Deposits, with deposits.
 * Credit unions come from NCUA's branch file, which has no county code, so a credit union
 * branch counts when it sits in a city where the market counties hold a bank branch, the same
 * city test the report uses to bring credit unions into the market. Null when the counties
 * hold no bank branches.
 */
export async function getMarketBranchFootprint(countyFips: string[], sodYear: number): Promise<MarketBranchFootprint | null> {
  // Compared as integers so the (county_fips, year) index is used; a text cast scanned the whole year.
  const counties = countyFips.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (counties.length === 0) return null;
  const rows = await sql<{ institution_id: string | number | null; branches: string | number; deposits: string | number | null }[]>`
    SELECT b.institution_id, COUNT(*) AS branches, SUM(COALESCE(b.deposits, 0)) AS deposits
    FROM institution_branch_deposits b
    WHERE b.year = ${sodYear} AND b.county_fips = ANY(${counties}::int[])
    GROUP BY b.institution_id`;
  if (rows.length === 0) return null;
  const creditUnions = await sql<{ institution_id: string | number; branches: string | number }[]>`
    WITH places AS (
      SELECT DISTINCT b.state, UPPER(b.city) AS city
      FROM institution_branch_deposits b
      WHERE b.year = ${sodYear} AND b.county_fips = ANY(${counties}::int[]) AND b.city IS NOT NULL
    )
    SELECT c.institution_id, COUNT(*) AS branches
    FROM credit_union_branches c
    JOIN places p ON p.state = c.state AND p.city = UPPER(c.city)
    WHERE c.institution_id IS NOT NULL
    GROUP BY c.institution_id`;
  return buildMarketBranchFootprint(sodYear, rows, creditUnions);
}

export function buildMarketBranchFootprint(
  sodYear: number,
  banks: { institution_id: string | number | null; branches: string | number; deposits: string | number | null }[],
  creditUnions: { institution_id: string | number; branches: string | number }[],
): MarketBranchFootprint {
  const byInstitution: MarketBranchFootprint["byInstitution"] = {};
  let totalBranches = 0;
  let totalDeposits = 0;
  for (const row of banks) {
    const branches = Number(row.branches);
    const deposits = Number(row.deposits ?? 0) * SOD_THOUSANDS;
    totalBranches += branches;
    totalDeposits += deposits;
    if (row.institution_id !== null) byInstitution[Number(row.institution_id)] = { branches, deposits };
  }
  for (const row of creditUnions) {
    const id = Number(row.institution_id);
    // A bank's SOD row wins if an institution ever appears in both files.
    if (!byInstitution[id]) byInstitution[id] = { branches: Number(row.branches), deposits: null };
  }
  return { sod_year: sodYear, totalBranches, totalDeposits, byInstitution };
}
