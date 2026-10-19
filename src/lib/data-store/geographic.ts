import { sql } from "./connection";
import { activeInstitutionFilter, statsRowFilter } from "./fee-stats";
import {
  aggregateCityFeeAverages,
  type CityFeeAverage,
  type CityInstitutionFeeRow,
} from "./city-fee-aggregation";
import { VALID_US_CODES } from "../us-states";
import { escapeLikePattern } from "@/lib/api-hardening/query-caps";
import { citySearchPrefixes, foldCitySpellings } from "@/lib/geo/city-names";
import { hqCitySpellings } from "./city-spellings";

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
    FROM institution_sources ct WHERE ct.state_code = ${stateCode} AND ${sql.unsafe(activeInstitutionFilter("ct"))}
  ` as { total: number; banks: number; cus: number }[];

  const [fees] = await sql`
    SELECT COUNT(DISTINCT ef.institution_id) as with_fees,
           COUNT(*) as total_fees,
           COUNT(DISTINCT ef.fee_category) as categories
    FROM published_fee_catalog ef
    JOIN institution_sources ct ON ef.institution_id = ct.id
    WHERE ct.state_code = ${stateCode} AND ef.review_status = 'approved'
      AND ${sql.unsafe(activeInstitutionFilter("ct"))}
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
    FROM institution_sources ct WHERE ct.fed_district = ${districtId} AND ${sql.unsafe(activeInstitutionFilter("ct"))}
  ` as { total: number; banks: number; cus: number }[];

  const [fees] = await sql`
    SELECT COUNT(DISTINCT ef.institution_id) as with_fees,
           COUNT(*) as total_fees,
           COUNT(DISTINCT ef.fee_category) as categories
    FROM published_fee_catalog ef
    JOIN institution_sources ct ON ef.institution_id = ct.id
    WHERE ct.fed_district = ${districtId} AND ef.review_status = 'approved'
      AND ${sql.unsafe(activeInstitutionFilter("ct"))}
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
  /**
   * Approved published dollar fees: the rows the institution profile counts as verified
   * (`isVerifiedFee`). Null when the count can't be read.
   */
  verified_fee_count: number | null;
}

/** Institutions with verified fees, their latest observation date (sitemap lastmod) and verified fee count. */
export async function getInstitutionIdsWithFeeDates(): Promise<InstitutionFeeFreshness[]> {
  const rows = await sql`
    SELECT institution_id as id, MAX(created_at) as last_fee_at, COUNT(*) as verified_fee_count
    FROM published_fee_catalog
    WHERE review_status = 'approved'
    GROUP BY institution_id
    ORDER BY institution_id
  ` as { id: number | string; last_fee_at: string | Date | null; verified_fee_count: number | string | null }[];
  return rows.map((r) => {
    const count = r.verified_fee_count == null ? NaN : Number(r.verified_fee_count);
    return {
      id: Number(r.id),
      last_fee_at: r.last_fee_at instanceof Date ? r.last_fee_at.toISOString() : r.last_fee_at,
      verified_fee_count: Number.isFinite(count) ? count : null,
    };
  });
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

/**
 * The full city a cut 15-character name stands for (#1213): the one longer city in the state that
 * starts with it (case ignored), or null when there is none or more than one. The city page
 * redirects a cut address here once the cut has no institutions left.
 */
export async function fullCityForCut(city: string, stateCode: string): Promise<string | null> {
  const cut = city.trim();
  if (cut.length !== 15) return null;
  const rows = await sql<{ city: string }[]>`
    SELECT DISTINCT ON (lower(btrim(city))) btrim(city) AS city
      FROM institution_sources
     WHERE state_code = ${stateCode.toUpperCase()}
       AND length(btrim(city)) > 15
       AND lower(left(btrim(city), 15)) = lower(${cut})
     LIMIT 2
  `;
  return rows.length === 1 ? rows[0].city : null;
}

/**
 * The institutions headquartered in a city that publish fees, every stored spelling of the city
 * folded in (#2092): "Saint Petersburg" and "St. Petersburg" headquarters list on one page, the
 * same city the state directory counts.
 */
export async function getCityInstitutions(city: string, stateCode: string): Promise<CityInstitution[]> {
  const upperState = stateCode.toUpperCase();
  const spellings = await hqCitySpellings(city, upperState);
  const rows = await sql`
    SELECT ct.id, ct.institution_name, ct.charter_type, ct.asset_size,
           COALESCE(fc.fee_count, 0) as fee_count,
           (SELECT MAX(ef.amount) FROM published_fee_catalog ef
              WHERE ef.institution_id = ct.id AND ef.fee_category = 'overdraft'
                AND ef.review_status = 'approved' AND ef.amount IS NOT NULL AND ef.amount >= 0
                AND ${sql.unsafe(statsRowFilter("ef"))}) as overdraft,
           (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ef.amount) FROM published_fee_catalog ef
              WHERE ef.institution_id = ct.id AND ef.fee_category = 'monthly_maintenance'
                AND ef.review_status = 'approved' AND ef.amount IS NOT NULL AND ef.amount >= 0
                AND ${sql.unsafe(statsRowFilter("ef"))}) as monthly_maintenance,
           (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ef.amount) FROM published_fee_catalog ef
              WHERE ef.institution_id = ct.id AND ef.fee_category = 'nsf'
                AND ef.review_status = 'approved' AND ef.amount IS NOT NULL AND ef.amount >= 0
                AND ${sql.unsafe(statsRowFilter("ef"))}) as nsf,
           (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ef.amount) FROM published_fee_catalog ef
              WHERE ef.institution_id = ct.id AND ef.fee_category = 'atm_non_network'
                AND ef.review_status = 'approved' AND ef.amount IS NOT NULL AND ef.amount >= 0
                AND ${sql.unsafe(statsRowFilter("ef"))}) as atm_non_network
    FROM institution_sources ct
    LEFT JOIN (
      SELECT institution_id, COUNT(*) as fee_count
      FROM published_fee_catalog WHERE review_status = 'approved'
        AND ${sql.unsafe(statsRowFilter("published_fee_catalog"))}
      GROUP BY institution_id
    ) fc ON ct.id = fc.institution_id
    WHERE UPPER(ct.city) = ANY(${spellings}::text[]) AND ct.state_code = ${upperState}
    AND fc.fee_count > 0
    AND ${sql.unsafe(activeInstitutionFilter("ct"))}
    ORDER BY ct.asset_size DESC NULLS LAST
  ` as RawCityInstitutionRow[];

  return rows.map(normalizeCityInstitutionRow);
}

/** Fee averages across the institutions headquartered in a city, its spellings folded as `getCityInstitutions` folds them. */
export async function getCityFeeAverages(city: string, stateCode: string): Promise<CityFeeAverage[]> {
  const upperState = stateCode.toUpperCase();
  const spellings = await hqCitySpellings(city, upperState);
  const rows = await sql`
    SELECT ef.institution_id, ef.fee_category, ef.amount
    FROM published_fee_catalog ef
    JOIN institution_sources ct ON ef.institution_id = ct.id
    WHERE UPPER(ct.city) = ANY(${spellings}::text[]) AND ct.state_code = ${upperState}
      AND ef.review_status = 'approved'
      AND ef.amount IS NOT NULL
      AND ef.amount >= 0
      AND ef.fee_category IS NOT NULL
      AND ${sql.unsafe(statsRowFilter("ef"))}
      AND ${sql.unsafe(activeInstitutionFilter("ct"))}
  ` as CityInstitutionFeeRow[];

  return aggregateCityFeeAverages(rows);
}

/**
 * One row per city once its spellings are folded (#2092): the counts of every spelling in the same
 * state summed (an institution has one headquarters city, so no institution counts twice), named by
 * the spelling most institutions use. Ordered most institutions with fees first, then most
 * institutions. Pure.
 */
export function foldCitySummaries(rows: CitySummary[]): CitySummary[] {
  const byState = new Map<string, CitySummary[]>();
  for (const row of rows) {
    const list = byState.get(row.state_code) ?? [];
    list.push(row);
    byState.set(row.state_code, list);
  }
  const out: CitySummary[] = [];
  for (const [state_code, list] of byState) {
    const folded = foldCitySpellings(list.map((row) => ({ name: row.city, branches: row.institution_count, row })));
    for (const city of folded) {
      out.push({
        city: city.name,
        state_code,
        institution_count: city.spellings.reduce((n, s) => n + s.row.institution_count, 0),
        with_fees: city.spellings.reduce((n, s) => n + s.row.with_fees, 0),
      });
    }
  }
  return out.sort((a, b) => b.with_fees - a.with_fees || b.institution_count - a.institution_count);
}

export async function getCitiesInState(stateCode: string): Promise<CitySummary[]> {
  const upperState = stateCode.toUpperCase();
  const rows = await sql`
    SELECT (array_agg(ct.city ORDER BY (ct.city = UPPER(ct.city)), ct.city))[1] AS city, ct.state_code,
           COUNT(*) as institution_count,
           COUNT(DISTINCT CASE WHEN fc.fee_count > 0 THEN ct.id END) as with_fees
    FROM institution_sources ct
    LEFT JOIN (
      SELECT institution_id, COUNT(*) as fee_count
      FROM published_fee_catalog WHERE review_status = 'approved'
      GROUP BY institution_id
    ) fc ON ct.id = fc.institution_id
    WHERE ct.state_code = ${upperState} AND ct.city IS NOT NULL AND ct.city != ''
      AND ${sql.unsafe(activeInstitutionFilter("ct"))}
    GROUP BY LOWER(ct.city), ct.state_code
  ` as RawCitySummaryRow[];

  return foldCitySummaries(rows.map(normalizeCitySummaryRow)).filter((c) => c.with_fees > 0);
}

/**
 * Top cities per state with at least `minWithFees` institutions carrying approved fees,
 * in one query. Same ranking as getCitiesInState; the sitemap uses it instead of one
 * query per state.
 */
export async function getTopCitiesByState(
  minWithFees: number,
  perState: number,
): Promise<CitySummary[]> {
  // Spellings fold before the threshold and the ranking, so a city split across spellings is
  // counted, and listed, once.
  const rows = await sql`
    WITH fc AS (
      SELECT institution_id, COUNT(*) as fee_count
      FROM published_fee_catalog WHERE review_status = 'approved'
      GROUP BY institution_id
    )
    SELECT (array_agg(ct.city ORDER BY (ct.city = UPPER(ct.city)), ct.city))[1] AS city, ct.state_code,
           COUNT(*) as institution_count,
           COUNT(DISTINCT CASE WHEN fc.fee_count > 0 THEN ct.id END) as with_fees
    FROM institution_sources ct
    LEFT JOIN fc ON ct.id = fc.institution_id
    WHERE ct.state_code IS NOT NULL AND ct.city IS NOT NULL AND ct.city != ''
      AND ${sql.unsafe(activeInstitutionFilter("ct"))}
    GROUP BY LOWER(ct.city), ct.state_code
  ` as RawCitySummaryRow[];

  const ranked = new Map<string, CitySummary[]>();
  for (const city of foldCitySummaries(rows.map(normalizeCitySummaryRow))) {
    if (city.with_fees < minWithFees) continue;
    const list = ranked.get(city.state_code) ?? [];
    if (list.length < perState) list.push(city);
    ranked.set(city.state_code, list);
  }
  return [...ranked.keys()].sort().flatMap((state) => ranked.get(state) ?? []);
}

/**
 * Cities whose name starts with the search, each once with its spellings folded (#2092): "st pete"
 * finds St. Petersburg whether a record spells it "Saint", "St" or "St.". The count is the
 * institutions with approved fees across the spellings found.
 */
export async function getCityAutocomplete(query: string, limit: number = 10): Promise<{ city: string; state_code: string; count: number }[]> {
  const cap = Math.min(Math.max(1, Math.floor(limit) || 1), 25);
  // City-name prefixes, matched literally: an unescaped `%` read every city in the country.
  const patterns = citySearchPrefixes(query).map((prefix) => `${escapeLikePattern(prefix)}%`);
  const rows = await sql`
    SELECT (array_agg(ct.city ORDER BY (ct.city = UPPER(ct.city)), ct.city))[1] AS city, ct.state_code, COUNT(DISTINCT ct.id) as count
    FROM institution_sources ct
    WHERE ct.city ILIKE ANY(${patterns}::text[]) AND ct.city IS NOT NULL
    AND ${sql.unsafe(activeInstitutionFilter("ct"))}
    AND ct.id IN (SELECT DISTINCT institution_id FROM published_fee_catalog WHERE review_status = 'approved')
    GROUP BY LOWER(ct.city), ct.state_code
    ORDER BY count DESC
    LIMIT ${cap * 3}
  ` as { city: string; state_code: string; count: number | string }[];

  return foldCitySummaries(
    rows.map((r) => ({ city: r.city, state_code: r.state_code, institution_count: Number(r.count), with_fees: Number(r.count) })),
  )
    .slice(0, cap)
    .map((c) => ({ city: c.city, state_code: c.state_code, count: c.institution_count }));
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
       AND ${activeInstitutionFilter("ct")}
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
  /**
   * Of those, institutions with at least one fee that passes the statistics contract's row rules
   * (fee-stats.ts statsRowFilter): the population behind the area's medians (#1951). Optional so a
   * coverage entry cached before the field existed still reads.
   */
  counted_institutions?: number;
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
  counted_institutions?: number | string | null;
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
    const countedInstitutions = Number(row.counted_institutions ?? 0);
    const verifiedFees = Number(row.verified_fees);
    if (row.state_code && VALID_US_CODES.has(row.state_code)) {
      const s = states.get(row.state_code) ?? {
        state_code: row.state_code, monitored: 0, verified_institutions: 0, counted_institutions: 0, verified_fees: 0,
      };
      s.monitored += monitored;
      s.verified_institutions += verifiedInstitutions;
      s.counted_institutions = (s.counted_institutions ?? 0) + countedInstitutions;
      s.verified_fees += verifiedFees;
      states.set(row.state_code, s);
    }
    const district = Number(row.fed_district);
    if (row.fed_district !== null && district >= 1 && district <= 12) {
      const d = districts.get(district) ?? {
        district, monitored: 0, verified_institutions: 0, counted_institutions: 0, verified_fees: 0,
      };
      d.monitored += monitored;
      d.verified_institutions += verifiedInstitutions;
      d.counted_institutions = (d.counted_institutions ?? 0) + countedInstitutions;
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
 * Monitored vs verified coverage by state and Fed district, from one grouped scan: the one
 * source for a state's or district's coverage counts on public pages (headline-counts.ts
 * stateCoverageCounts, #1951). Monitored is every active institution headquartered there, by the
 * state hub's rule (fee-stats.ts activeInstitutionFilter, #1955), so a state page's
 * "headquartered" total and its hub figures count one population; verified is at least one approved published fee, as
 * the national "institutions with published fees" headline counts; counted is at least one fee
 * the statistics contract keeps, the population behind the medians.
 */
export async function getResearchCoverage(): Promise<ResearchCoverage> {
  const rows = await sql`
    SELECT ct.state_code,
           ct.fed_district,
           COUNT(DISTINCT ct.id) AS monitored,
           COUNT(DISTINCT ef.institution_id) AS verified_institutions,
           COUNT(DISTINCT ef.institution_id) FILTER (WHERE ef.fee_category IS NOT NULL AND ${sql.unsafe(statsRowFilter("ef"))}) AS counted_institutions,
           COUNT(ef.id) AS verified_fees
    FROM institution_sources ct
    LEFT JOIN published_fee_catalog ef
      ON ef.institution_id = ct.id AND ef.review_status = 'approved'
    WHERE ${sql.unsafe(activeInstitutionFilter("ct"))}
    GROUP BY ct.state_code, ct.fed_district
  ` as CoverageGroupRow[];
  return rollUpCoverage(rows);
}
