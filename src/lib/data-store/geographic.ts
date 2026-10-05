import { sql } from "./connection";
import {
  aggregateCityFeeAverages,
  type CityFeeAverage,
  type CityInstitutionFeeRow,
} from "./city-fee-aggregation";
import { VALID_US_CODES } from "../us-states";

export interface GeoStats {
  institution_count: number;
  bank_count: number;
  cu_count: number;
  with_fees: number;
  total_fees: number;
  fee_categories: number;
}

export async function getStateStats(stateCode: string): Promise<GeoStats> {
  const [inst] = await sql`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN charter_type = 'bank' THEN 1 ELSE 0 END) as banks,
      SUM(CASE WHEN charter_type = 'credit_union' THEN 1 ELSE 0 END) as cus
    FROM institution_sources WHERE state_code = ${stateCode}
  ` as { total: number; banks: number; cus: number }[];

  const [fees] = await sql`
    SELECT COUNT(DISTINCT ef.institution_id) as with_fees,
           COUNT(*) as total_fees,
           COUNT(DISTINCT ef.fee_category) as categories
    FROM published_fee_catalog ef
    JOIN institution_sources ct ON ef.institution_id = ct.id
    WHERE ct.state_code = ${stateCode} AND ef.review_status = 'approved'
  ` as { with_fees: number; total_fees: number; categories: number }[];

  return {
    institution_count: Number(inst.total),
    bank_count: Number(inst.banks),
    cu_count: Number(inst.cus),
    with_fees: Number(fees.with_fees),
    total_fees: Number(fees.total_fees),
    fee_categories: Number(fees.categories),
  };
}

export async function getDistrictStats(districtId: number): Promise<GeoStats> {
  const [inst] = await sql`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN charter_type = 'bank' THEN 1 ELSE 0 END) as banks,
      SUM(CASE WHEN charter_type = 'credit_union' THEN 1 ELSE 0 END) as cus
    FROM institution_sources WHERE fed_district = ${districtId}
  ` as { total: number; banks: number; cus: number }[];

  const [fees] = await sql`
    SELECT COUNT(DISTINCT ef.institution_id) as with_fees,
           COUNT(*) as total_fees,
           COUNT(DISTINCT ef.fee_category) as categories
    FROM published_fee_catalog ef
    JOIN institution_sources ct ON ef.institution_id = ct.id
    WHERE ct.fed_district = ${districtId} AND ef.review_status = 'approved'
  ` as { with_fees: number; total_fees: number; categories: number }[];

  return {
    institution_count: Number(inst.total),
    bank_count: Number(inst.banks),
    cu_count: Number(inst.cus),
    with_fees: Number(fees.with_fees),
    total_fees: Number(fees.total_fees),
    fee_categories: Number(fees.categories),
  };
}

export async function getInstitutionIdsWithFees(): Promise<number[]> {
  const rows = await sql`
    SELECT DISTINCT institution_id as id
    FROM published_fee_catalog
    WHERE review_status = 'approved'
    ORDER BY institution_id
  ` as { id: number }[];
  return rows.map((r) => Number(r.id));
}

export interface InstitutionFeeFreshness {
  id: number;
  /** Most recent approved fee observation for the institution (ISO string). */
  last_fee_at: string | null;
}

/** Institutions with verified fees plus their latest observation date (sitemap lastmod). */
export async function getInstitutionIdsWithFeeDates(): Promise<InstitutionFeeFreshness[]> {
  const rows = await sql`
    SELECT institution_id as id, MAX(created_at) as last_fee_at
    FROM published_fee_catalog
    WHERE review_status = 'approved'
    GROUP BY institution_id
    ORDER BY institution_id
  ` as { id: number | string; last_fee_at: string | Date | null }[];
  return rows.map((r) => ({
    id: Number(r.id),
    last_fee_at: r.last_fee_at instanceof Date ? r.last_fee_at.toISOString() : r.last_fee_at,
  }));
}

// --- City-level queries ---

export interface CityInstitution {
  id: number;
  institution_name: string;
  charter_type: string;
  asset_size: number | null;
  fee_count: number;
  overdraft: number | null;
  monthly_maintenance: number | null;
  nsf: number | null;
  atm_non_network: number | null;
}

export type { CityFeeAverage } from "./city-fee-aggregation";

export interface CitySummary {
  city: string;
  state_code: string;
  institution_count: number;
  with_fees: number;
}

interface RawCityInstitutionRow {
  id: number | string;
  institution_name: string;
  charter_type: string;
  asset_size: number | string | null;
  fee_count: number | string | null;
  overdraft: number | string | null;
  monthly_maintenance: number | string | null;
  nsf: number | string | null;
  atm_non_network: number | string | null;
}

interface RawCitySummaryRow {
  city: string;
  state_code: string;
  institution_count: number | string | null;
  with_fees: number | string | null;
}

function numberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function normalizeCityInstitutionRow(
  row: RawCityInstitutionRow,
): CityInstitution {
  return {
    ...row,
    id: Number(row.id),
    asset_size: numberOrNull(row.asset_size),
    fee_count: Number(row.fee_count ?? 0),
    overdraft: numberOrNull(row.overdraft),
    monthly_maintenance: numberOrNull(row.monthly_maintenance),
    nsf: numberOrNull(row.nsf),
    atm_non_network: numberOrNull(row.atm_non_network),
  };
}

export function normalizeCitySummaryRow(
  row: RawCitySummaryRow,
): CitySummary {
  return {
    ...row,
    institution_count: Number(row.institution_count ?? 0),
    with_fees: Number(row.with_fees ?? 0),
  };
}

export async function getCityInstitutions(city: string, stateCode: string): Promise<CityInstitution[]> {
  const upperState = stateCode.toUpperCase();
  const rows = await sql`
    SELECT ct.id, ct.institution_name, ct.charter_type, ct.asset_size,
           COALESCE(fc.fee_count, 0) as fee_count,
           (SELECT MIN(ef.amount) FROM published_fee_catalog ef WHERE ef.institution_id = ct.id AND ef.fee_category = 'overdraft' AND ef.review_status = 'approved') as overdraft,
           (SELECT MIN(ef.amount) FROM published_fee_catalog ef WHERE ef.institution_id = ct.id AND ef.fee_category = 'monthly_maintenance' AND ef.review_status = 'approved') as monthly_maintenance,
           (SELECT MIN(ef.amount) FROM published_fee_catalog ef WHERE ef.institution_id = ct.id AND ef.fee_category = 'nsf' AND ef.review_status = 'approved') as nsf,
           (SELECT MIN(ef.amount) FROM published_fee_catalog ef WHERE ef.institution_id = ct.id AND ef.fee_category = 'atm_non_network' AND ef.review_status = 'approved') as atm_non_network
    FROM institution_sources ct
    LEFT JOIN (
      SELECT institution_id, COUNT(*) as fee_count
      FROM published_fee_catalog WHERE review_status = 'approved'
      GROUP BY institution_id
    ) fc ON ct.id = fc.institution_id
    WHERE LOWER(ct.city) = LOWER(${city}) AND ct.state_code = ${upperState}
    AND fc.fee_count > 0
    ORDER BY ct.asset_size DESC NULLS LAST
  ` as RawCityInstitutionRow[];

  return rows.map(normalizeCityInstitutionRow);
}

export async function getCityFeeAverages(city: string, stateCode: string): Promise<CityFeeAverage[]> {
  const upperState = stateCode.toUpperCase();
  const rows = await sql`
    SELECT ef.institution_id, ef.fee_category, ef.amount
    FROM published_fee_catalog ef
    JOIN institution_sources ct ON ef.institution_id = ct.id
    WHERE LOWER(ct.city) = LOWER(${city}) AND ct.state_code = ${upperState}
      AND ef.review_status = 'approved'
      AND ef.source_document_id IS NOT NULL
      AND ef.amount IS NOT NULL
      AND ef.fee_category IS NOT NULL
  ` as CityInstitutionFeeRow[];

  return aggregateCityFeeAverages(rows);
}

export async function getCitiesInState(stateCode: string): Promise<CitySummary[]> {
  const upperState = stateCode.toUpperCase();
  const rows = await sql`
    SELECT ct.city, ct.state_code,
           COUNT(*) as institution_count,
           COUNT(DISTINCT CASE WHEN fc.fee_count > 0 THEN ct.id END) as with_fees
    FROM institution_sources ct
    LEFT JOIN (
      SELECT institution_id, COUNT(*) as fee_count
      FROM published_fee_catalog WHERE review_status = 'approved'
      GROUP BY institution_id
    ) fc ON ct.id = fc.institution_id
    WHERE ct.state_code = ${upperState} AND ct.city IS NOT NULL AND ct.city != ''
    GROUP BY LOWER(ct.city), ct.city, ct.state_code
    HAVING COUNT(DISTINCT CASE WHEN fc.fee_count > 0 THEN ct.id END) > 0
    ORDER BY COUNT(DISTINCT CASE WHEN fc.fee_count > 0 THEN ct.id END) DESC, COUNT(*) DESC
  ` as RawCitySummaryRow[];

  return rows.map(normalizeCitySummaryRow);
}

export async function getCityAutocomplete(query: string, limit: number = 10): Promise<{ city: string; state_code: string; count: number }[]> {
  const pattern = `${query}%`;
  return await sql`
    SELECT ct.city, ct.state_code, COUNT(DISTINCT ct.id) as count
    FROM institution_sources ct
    WHERE ct.city ILIKE ${pattern} AND ct.city IS NOT NULL
    AND ct.id IN (SELECT DISTINCT institution_id FROM published_fee_catalog WHERE review_status = 'approved')
    GROUP BY LOWER(ct.city), ct.city, ct.state_code
    ORDER BY count DESC
    LIMIT ${limit}
  ` as { city: string; state_code: string; count: number }[];
}

export async function getStatesWithFeeData(): Promise<{ state_code: string; institution_count: number; fee_count: number }[]> {
  const codes = [...VALID_US_CODES];
  const params: string[] = codes;
  const placeholders = codes.map((_, i) => `$${i + 1}`).join(",");
  const rows = await sql.unsafe(
    `SELECT ct.state_code,
            COUNT(DISTINCT ct.id) as institution_count,
            COUNT(ef.id) as fee_count
     FROM institution_sources ct
     JOIN published_fee_catalog ef ON ct.id = ef.institution_id
     WHERE ct.state_code IN (${placeholders})
       AND ef.review_status = 'approved'
     GROUP BY ct.state_code
     ORDER BY COUNT(DISTINCT ct.id) DESC`,
    params
  ) as { state_code: string; institution_count: string | number; fee_count: string | number }[];
  return rows.map((r) => ({
    state_code: r.state_code,
    institution_count: Number(r.institution_count),
    fee_count: Number(r.fee_count),
  }));
}

export interface CoverageArea {
  /** Institutions the index monitors in the area. */
  monitored: number;
  /** Monitored institutions with at least one verified (approved) fee. */
  verified_institutions: number;
  /** Verified (approved) fee rows in the area. */
  verified_fees: number;
}

export interface StateCoverage extends CoverageArea {
  state_code: string;
}

export interface DistrictCoverage extends CoverageArea {
  district: number;
}

export interface ResearchCoverage {
  states: StateCoverage[];
  districts: DistrictCoverage[];
}

export interface CoverageGroupRow {
  state_code: string | null;
  fed_district: number | string | null;
  monitored: number | string;
  verified_institutions: number | string;
  verified_fees: number | string;
}

/**
 * Roll (state, district) groups up to states and districts. Every institution sits in
 * exactly one group, so summing the per-group distinct counts is exact.
 */
export function rollUpCoverage(rows: CoverageGroupRow[]): ResearchCoverage {
  const states = new Map<string, StateCoverage>();
  const districts = new Map<number, DistrictCoverage>();
  for (const row of rows) {
    const monitored = Number(row.monitored);
    const verifiedInstitutions = Number(row.verified_institutions);
    const verifiedFees = Number(row.verified_fees);
    if (row.state_code && VALID_US_CODES.has(row.state_code)) {
      const s = states.get(row.state_code) ?? {
        state_code: row.state_code, monitored: 0, verified_institutions: 0, verified_fees: 0,
      };
      s.monitored += monitored;
      s.verified_institutions += verifiedInstitutions;
      s.verified_fees += verifiedFees;
      states.set(row.state_code, s);
    }
    const district = Number(row.fed_district);
    if (row.fed_district !== null && district >= 1 && district <= 12) {
      const d = districts.get(district) ?? {
        district, monitored: 0, verified_institutions: 0, verified_fees: 0,
      };
      d.monitored += monitored;
      d.verified_institutions += verifiedInstitutions;
      d.verified_fees += verifiedFees;
      districts.set(district, d);
    }
  }
  return {
    states: [...states.values()].sort((a, b) => b.verified_institutions - a.verified_institutions),
    districts: [...districts.values()].sort((a, b) => a.district - b.district),
  };
}

/**
 * Monitored vs verified coverage by state and Fed district, from one grouped scan.
 * Only approved published fees count as verified, matching the public headline numbers.
 */
export async function getResearchCoverage(): Promise<ResearchCoverage> {
  const rows = await sql`
    SELECT ct.state_code,
           ct.fed_district,
           COUNT(DISTINCT ct.id) AS monitored,
           COUNT(DISTINCT ef.institution_id) AS verified_institutions,
           COUNT(ef.id) AS verified_fees
    FROM institution_sources ct
    LEFT JOIN published_fee_catalog ef
      ON ef.institution_id = ct.id AND ef.review_status = 'approved'
    GROUP BY ct.state_code, ct.fed_district
  ` as CoverageGroupRow[];
  return rollUpCoverage(rows);
}
