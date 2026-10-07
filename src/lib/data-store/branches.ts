import { sql } from "./connection";

/**
 * Bank branch locations from the FDIC Summary of Deposits (institution_branch_deposits),
 * latest survey year. Banks only: credit unions are not in the SOD.
 */

const SOD_THOUSANDS = 1_000;

export interface BranchRow {
  institution_id: number | null;
  institution_name: string | null;
  branch_name: string | null;
  is_main_office: boolean;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  county_fips: number | null;
  msa_name: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Deposits at the branch, whole dollars. */
  deposits: number | null;
}

export interface BranchPage {
  sod_year: number | null;
  total: number;
  rows: BranchRow[];
}

interface RawBranch {
  institution_id: string | number | null;
  institution_name: string | null;
  branch_name: string | null;
  is_main_office: boolean | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  county_fips: number | null;
  msa_name: string | null;
  latitude: number | null;
  longitude: number | null;
  deposits: string | number | null;
  year: number;
  total: string | number;
}

function toRow(r: RawBranch): BranchRow {
  const deposits = r.deposits === null ? null : Number(r.deposits);
  return {
    institution_id: r.institution_id === null ? null : Number(r.institution_id),
    institution_name: r.institution_name,
    branch_name: r.branch_name,
    is_main_office: r.is_main_office === true,
    address: r.address,
    city: r.city,
    state: r.state,
    zip: r.zip,
    county_fips: r.county_fips,
    msa_name: r.msa_name,
    latitude: r.latitude === null ? null : Number(r.latitude),
    longitude: r.longitude === null ? null : Number(r.longitude),
    deposits: deposits === null || !Number.isFinite(deposits) ? null : deposits * SOD_THOUSANDS,
  };
}

function toPage(rows: RawBranch[]): BranchPage {
  return {
    sod_year: rows[0]?.year ?? null,
    total: rows.length ? Number(rows[0].total) : 0,
    rows: rows.map(toRow),
  };
}

/** Every branch of one institution in the latest survey year, largest deposits first. */
export async function getBranchesForInstitution(
  institutionId: number,
  opts: { limit: number; offset: number },
): Promise<BranchPage> {
  const rows = await sql<RawBranch[]>`
    WITH latest AS (SELECT MAX(year) AS y FROM institution_branch_deposits)
    SELECT b.institution_id, s.institution_name, b.branch_name, b.is_main_office, b.address, b.city,
           b.state, b.zip, b.county_fips, b.msa_name, b.latitude, b.longitude, b.deposits, b.year,
           COUNT(*) OVER () AS total
    FROM institution_branch_deposits b
    JOIN latest ON b.year = latest.y
    LEFT JOIN institution_sources s ON s.id = b.institution_id
    WHERE b.institution_id = ${institutionId}
    ORDER BY b.deposits DESC NULLS LAST, b.branch_number
    LIMIT ${opts.limit} OFFSET ${opts.offset}`;
  return toPage(rows);
}

/** Every bank branch in a state, optionally narrowed to a city or ZIP code, in the latest survey year. */
export async function getBranchesInArea(
  area: { state: string; city?: string | null; zip?: string | null },
  opts: { limit: number; offset: number },
): Promise<BranchPage> {
  const city = area.city ?? null;
  const zip = area.zip ?? null;
  const rows = await sql<RawBranch[]>`
    WITH latest AS (SELECT MAX(year) AS y FROM institution_branch_deposits)
    SELECT b.institution_id, s.institution_name, b.branch_name, b.is_main_office, b.address, b.city,
           b.state, b.zip, b.county_fips, b.msa_name, b.latitude, b.longitude, b.deposits, b.year,
           COUNT(*) OVER () AS total
    FROM institution_branch_deposits b
    JOIN latest ON b.year = latest.y
    LEFT JOIN institution_sources s ON s.id = b.institution_id
    WHERE b.state = ${area.state}
      AND (${city}::text IS NULL OR UPPER(b.city) = UPPER(${city}::text))
      AND (${zip}::text IS NULL OR LEFT(b.zip, 5) = ${zip}::text)
    ORDER BY b.deposits DESC NULLS LAST, b.institution_id, b.branch_number
    LIMIT ${opts.limit} OFFSET ${opts.offset}`;
  return toPage(rows);
}

export interface MarketBranchFootprint {
  sod_year: number;
  /** Bank branches in the market counties. */
  totalBranches: number;
  /** Deposits held in those branches, whole dollars. */
  totalDeposits: number;
  /** Per institution: its branches and deposits in the market counties. */
  byInstitution: Record<number, { branches: number; deposits: number }>;
}

/**
 * Branch counts and deposit totals for a report's market counties (FDIC Summary of Deposits),
 * so the report can show each named competitor's footprint and local deposit share. Banks only:
 * credit unions are not in the SOD. Null when the counties hold no branches.
 */
export async function getMarketBranchFootprint(countyFips: string[], sodYear: number): Promise<MarketBranchFootprint | null> {
  if (countyFips.length === 0) return null;
  const rows = await sql<{ institution_id: string | number | null; branches: string | number; deposits: string | number | null }[]>`
    SELECT b.institution_id, COUNT(*) AS branches, SUM(COALESCE(b.deposits, 0)) AS deposits
    FROM institution_branch_deposits b
    WHERE b.year = ${sodYear} AND b.county_fips::text = ANY(${countyFips})
    GROUP BY b.institution_id`;
  if (rows.length === 0) return null;
  const byInstitution: MarketBranchFootprint["byInstitution"] = {};
  let totalBranches = 0;
  let totalDeposits = 0;
  for (const row of rows) {
    const branches = Number(row.branches);
    const deposits = Number(row.deposits ?? 0) * SOD_THOUSANDS;
    totalBranches += branches;
    totalDeposits += deposits;
    if (row.institution_id !== null) byInstitution[Number(row.institution_id)] = { branches, deposits };
  }
  return { sod_year: sodYear, totalBranches, totalDeposits, byInstitution };
}
