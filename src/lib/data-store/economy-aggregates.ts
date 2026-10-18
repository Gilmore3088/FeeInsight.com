import { REMITTANCE_PRICES_ATTRIBUTION, REMITTANCE_PRICES_LICENCE, STATE_FROM_FIPS } from "@/lib/regulatory/economy";
import { URBAN_DEBT_ATTRIBUTION } from "@/lib/regulatory/state-lists";
import { groupExpression, MIN_GROUP, type CallItemGroup } from "./call-report-items";
import { sql } from "./connection";
import { STRUCK_AREA_SERIES_KEYS, STRUCK_AREA_SOURCES, areaRowServedSql } from "./struck-sources";

/** area_statistics sources whose licence requires attribution, carried on every row read. */
export const AREA_SOURCE_ATTRIBUTION: Readonly<Record<string, string>> = {
  "urban-debt-in-america": URBAN_DEBT_ATTRIBUTION,
};

/**
 * Reads over the local-economy tables Magellan's economy steps fill: area_statistics (one value
 * per area, period and series), census_tracts (FFIEC tract income levels), branch_census_tracts
 * (which tract each branch sits in) and institution_hq_counties (the county of each
 * institution's main office). Server only. Nothing here fetches from outside.
 *
 * Groupings reuse the call-report groupings (state, Fed district, asset tier, charter, metro),
 * so market reports slice the economy the same way they slice institutions. Every median carries
 * its institution count, and a group under MIN_GROUP institutions gets no median.
 */

export type AreaGeoType = "nation" | "state" | "county" | "metro";

export interface AreaStatistic {
  source: string;
  series_key: string;
  period: string;
  value: number | null;
  unit: string;
  note: string | null;
  geo_name: string | null;
  /** The period before `period` for the same series, when loaded. */
  previous_period: string | null;
  previous_value: number | null;
  /** The credit the source's licence requires (AREA_SOURCE_ATTRIBUTION); absent when none is required. */
  attribution?: string;
}

/** Normalises a caller's area code: state as postal code (FIPS accepted), county as 5-digit FIPS, metro as 5-digit CBSA. */
export function normalizeGeoCode(geoType: AreaGeoType, code: string): string | null {
  const raw = code.trim().toUpperCase();
  switch (geoType) {
    case "nation":
      return "US";
    case "state":
      if (/^[A-Z]{2}$/.test(raw)) return raw;
      return /^\d{1,2}$/.test(raw) ? STATE_FROM_FIPS[raw.padStart(2, "0")] ?? null : null;
    case "county":
      return /^\d{4,5}$/.test(raw) ? raw.padStart(5, "0") : null;
    case "metro":
      return /^\d{5}$/.test(raw) ? raw : null;
  }
}

/** Newest and previous period per (source, series) from rows ordered any way. */
export function latestPerSeries(
  rows: Array<{ source: string; series_key: string; period: string; value: number | null; unit: string; note: string | null; geo_name: string | null }>,
): AreaStatistic[] {
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.source}|${row.series_key}`;
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  const out: AreaStatistic[] = [];
  for (const list of groups.values()) {
    // Periods are "2024", "2026Q2" or "2026-09": each sorts correctly as text within one series.
    const sorted = [...list].sort((a, b) => b.period.localeCompare(a.period));
    const [latest, previous] = sorted;
    out.push({
      source: latest.source,
      series_key: latest.series_key,
      period: latest.period,
      value: latest.value,
      unit: latest.unit,
      note: latest.note,
      geo_name: latest.geo_name,
      previous_period: previous?.period ?? null,
      previous_value: previous?.value ?? null,
      ...(AREA_SOURCE_ATTRIBUTION[latest.source] ? { attribution: AREA_SOURCE_ATTRIBUTION[latest.source] } : {}),
    });
  }
  return out.sort((a, b) => a.source.localeCompare(b.source) || a.series_key.localeCompare(b.series_key));
}

/**
 * Every area statistic loaded for one state, county or metro (or the nation): the newest period
 * of each series with the one before it. A value left blank by the publisher stays null.
 */
export async function getAreaStatistics(geoType: AreaGeoType, code: string): Promise<AreaStatistic[]> {
  const geoCode = normalizeGeoCode(geoType, code);
  if (!geoCode) return [];
  const rows = await sql<Array<{ source: string; series_key: string; period: string; value: number | null; unit: string; note: string | null; geo_name: string | null }>>`
    SELECT source, series_key, period, value::float8 AS value, unit, note, geo_name
      FROM (
        SELECT a.*, ROW_NUMBER() OVER (PARTITION BY source, series_key ORDER BY period DESC) AS rn
          FROM area_statistics a
         WHERE a.geo_type = ${geoType} AND a.geo_code = ${geoCode}
           -- Struck sources (DECISIONS.md "No non-commercial data"): rows already loaded are never returned.
           AND a.source <> ALL(${[...STRUCK_AREA_SOURCES]}::text[])
           AND ${sql.unsafe(areaRowServedSql("a"))}
           AND a.series_key <> ALL(${[...STRUCK_AREA_SERIES_KEYS]}::text[])
      ) ranked
     WHERE rn <= 2
  `;
  return latestPerSeries([...rows]);
}

export interface InstitutionLocalEconomy {
  institution_id: number;
  state_code: string | null;
  cbsa_code: string | null;
  hq_county_fips: string | null;
  /** How the HQ county was found (SOD main office, geocoded NCUA main office, or county name). */
  hq_county_basis: string | null;
  urban_rural: string | null;
  state: AreaStatistic[];
  county: AreaStatistic[];
  metro: AreaStatistic[];
  nation: AreaStatistic[];
}

export interface InstitutionHqLocation {
  state_code: string | null;
  cbsa_code: string | null;
  county_fips: string | null;
  /** How the HQ county was found (SOD main office, geocoded NCUA main office, or county name). */
  basis: string | null;
  urban_rural: string | null;
}

/** Where one institution's main office sits: state, metro (CBSA) and HQ county. Null when the institution is unknown. */
export async function getInstitutionHqLocation(institutionId: number): Promise<InstitutionHqLocation | null> {
  const [row] = await sql<InstitutionHqLocation[]>`
    SELECT s.state_code, s.cbsa_code, s.urban_rural, h.county_fips, h.basis
      FROM institution_sources s
      LEFT JOIN institution_hq_counties h ON h.institution_id = s.id
     WHERE s.id = ${institutionId}
     LIMIT 1
  `;
  return row ?? null;
}

/** The local economy around one institution: its HQ county, metro, state and the nation. */
export async function getInstitutionLocalEconomy(institutionId: number): Promise<InstitutionLocalEconomy | null> {
  const row = await getInstitutionHqLocation(institutionId);
  if (!row) return null;
  const [state, county, metro, nation] = await Promise.all([
    row.state_code ? getAreaStatistics("state", row.state_code) : Promise.resolve([]),
    row.county_fips ? getAreaStatistics("county", row.county_fips) : Promise.resolve([]),
    row.cbsa_code ? getAreaStatistics("metro", row.cbsa_code) : Promise.resolve([]),
    getAreaStatistics("nation", "US"),
  ]);
  return {
    institution_id: institutionId,
    state_code: row.state_code,
    cbsa_code: row.cbsa_code,
    hq_county_fips: row.county_fips,
    hq_county_basis: row.basis,
    urban_rural: row.urban_rural,
    state,
    county,
    metro,
    nation,
  };
}

/** Counties in a state with one series' newest value, for a county table on a state report. */
export async function getCountySeriesForState(stateCode: string, seriesKey: string) {
  const state = normalizeGeoCode("state", stateCode);
  if (!state) return [];
  return sql<Array<{ geo_code: string; geo_name: string | null; period: string; value: number | null; unit: string; note: string | null }>>`
    SELECT DISTINCT ON (geo_code) geo_code, geo_name, period, value::float8 AS value, unit, note
      FROM area_statistics
     WHERE geo_type = 'county' AND state_code = ${state} AND series_key = ${seriesKey}
     ORDER BY geo_code, period DESC
  `;
}

export interface HqCountyMedianRow {
  group_value: string | null;
  institutions: number;
  median: number | null;
  p25: number | null;
  p75: number | null;
}

/**
 * For one county series (say BEA per-capita income or the SAIPE poverty rate): the median, across
 * the institutions in each group, of their HQ county's newest value. "Banks in tier X sit in
 * counties with median per-capita income Y", with the institution count behind it.
 */
export async function getHqCountyMedians(seriesKey: string, groupBy: CallItemGroup): Promise<HqCountyMedianRow[]> {
  const group = sql.unsafe(groupExpression(groupBy));
  const rows = await sql<HqCountyMedianRow[]>`
    WITH latest AS (
      SELECT DISTINCT ON (geo_code) geo_code, value
        FROM area_statistics
       WHERE geo_type = 'county' AND series_key = ${seriesKey} AND value IS NOT NULL
       ORDER BY geo_code, period DESC
    )
    SELECT ${group} AS group_value,
           COUNT(*)::int AS institutions,
           CASE WHEN COUNT(*) >= ${MIN_GROUP} THEN percentile_cont(0.5) WITHIN GROUP (ORDER BY l.value)::float8 END AS median,
           CASE WHEN COUNT(*) >= ${MIN_GROUP} THEN percentile_cont(0.25) WITHIN GROUP (ORDER BY l.value)::float8 END AS p25,
           CASE WHEN COUNT(*) >= ${MIN_GROUP} THEN percentile_cont(0.75) WITHIN GROUP (ORDER BY l.value)::float8 END AS p75
      FROM institution_sources s
      JOIN institution_hq_counties h ON h.institution_id = s.id
      JOIN latest l ON l.geo_code = h.county_fips
     WHERE s.source IN ('fdic', 'ncua') AND COALESCE(s.regulatory_status, 'active') = 'active'
     GROUP BY 1
     ORDER BY 1 NULLS LAST
  `;
  return [...rows];
}

export interface BranchIncomeLevelRow {
  group_value: string | null;
  institutions: number;
  branches: number;
  low: number;
  moderate: number;
  middle: number;
  upper: number;
  /** Placed in a tract FFIEC gives no income level (or a tract missing from the FFIEC year). */
  unknown_level: number;
  /** No tract: no street address, no geocoder match, or a tie. */
  not_placed: number;
  /** Share of placed branches with a known level that sit in low- or moderate-income tracts, as a percent. */
  lmi_share: number | null;
}

/** Shapes one SQL row into a BranchIncomeLevelRow with its LMI share. */
export function withLmiShare(row: Omit<BranchIncomeLevelRow, "lmi_share">): BranchIncomeLevelRow {
  const known = row.low + row.moderate + row.middle + row.upper;
  return { ...row, lmi_share: known > 0 && row.institutions >= MIN_GROUP ? Math.round(((row.low + row.moderate) / known) * 1000) / 10 : null };
}

/**
 * Branches by their tract's CRA income level, grouped by the owning institution's grouping.
 * Uses the newest FFIEC year loaded. Branches never placed in a tract are counted, not dropped.
 */
export async function getBranchIncomeLevels(groupBy: CallItemGroup): Promise<{ year: number | null; rows: BranchIncomeLevelRow[] }> {
  const [y] = await sql<Array<{ year: number | null }>>`SELECT MAX(year)::int AS year FROM census_tracts WHERE income_level IS NOT NULL`;
  const year = y?.year ?? null;
  const group = sql.unsafe(groupExpression(groupBy));
  const rows = await sql<Array<Omit<BranchIncomeLevelRow, "lmi_share">>>`
    SELECT ${group} AS group_value,
           COUNT(DISTINCT b.institution_id)::int AS institutions,
           COUNT(*)::int AS branches,
           COUNT(*) FILTER (WHERE t.income_level = 'low')::int AS low,
           COUNT(*) FILTER (WHERE t.income_level = 'moderate')::int AS moderate,
           COUNT(*) FILTER (WHERE t.income_level = 'middle')::int AS middle,
           COUNT(*) FILTER (WHERE t.income_level = 'upper')::int AS upper,
           COUNT(*) FILTER (WHERE b.tract_id IS NOT NULL AND t.income_level IS NULL)::int AS unknown_level,
           COUNT(*) FILTER (WHERE b.tract_id IS NULL)::int AS not_placed
      FROM branch_census_tracts b
      JOIN institution_sources s ON s.id = b.institution_id
      LEFT JOIN census_tracts t ON t.tract_id = b.tract_id AND t.year = ${year}
     GROUP BY 1
     ORDER BY 1 NULLS LAST
  `;
  return { year, rows: [...rows].map(withLmiShare) };
}

/** Placement coverage: how many current branches have a tract, and why the rest do not. */
export async function getBranchPlacementCoverage() {
  return sql<Array<{ branch_kind: string; status: string; branches: number }>>`
    SELECT branch_kind, status, COUNT(*)::int AS branches
      FROM branch_census_tracts
     GROUP BY 1, 2
     ORDER BY 1, 2
  `;
}

/** Institutions by urban_rural within each group (null = not yet filled or no HQ county). */
export async function getUrbanRuralCounts(groupBy: CallItemGroup) {
  const group = sql.unsafe(groupExpression(groupBy));
  return sql<Array<{ group_value: string | null; urban_rural: string | null; institutions: number }>>`
    SELECT ${group} AS group_value, s.urban_rural, COUNT(*)::int AS institutions
      FROM institution_sources s
     WHERE s.source IN ('fdic', 'ncua') AND COALESCE(s.regulatory_status, 'active') = 'active'
     GROUP BY 1, 2
     ORDER BY 1 NULLS LAST, 2 NULLS LAST
  `;
}

/**
 * US-send remittance quotes for the newest period, by corridor: median fee and total cost with the
 * quote count. World Bank RPW is CC BY 4.0 (released from held 2026-10-18, DECISIONS.md "No
 * non-commercial data"), so every row carries the attribution the licence requires.
 */
export async function getRemittanceCorridors(): Promise<RemittanceCorridorRow[]> {
  const rows = await sql<Array<Omit<RemittanceCorridorRow, "licence" | "attribution">>>`
    WITH latest AS (SELECT MAX(period) AS period FROM remittance_prices)
    SELECT r.destination_country, r.period, COUNT(*)::int AS quotes, COUNT(DISTINCT r.firm)::int AS firms,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY r.fee)::float8 AS median_fee,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY r.total_cost_pct)::float8 AS median_total_cost_pct
      FROM remittance_prices r, latest
     WHERE r.period = latest.period
     GROUP BY 1, 2
     ORDER BY 1
  `;
  return withRemittanceAttribution([...rows]);
}

/** Adds the CC BY 4.0 licence and its required attribution to each corridor row. */
export function withRemittanceAttribution(rows: Array<Omit<RemittanceCorridorRow, "licence" | "attribution">>): RemittanceCorridorRow[] {
  return rows.map((r) => ({ ...r, licence: REMITTANCE_PRICES_LICENCE, attribution: REMITTANCE_PRICES_ATTRIBUTION }));
}

export interface RemittanceCorridorRow {
  destination_country: string;
  period: string;
  quotes: number;
  firms: number;
  median_fee: number | null;
  median_total_cost_pct: number | null;
  /** "CC BY 4.0". */
  licence: string;
  /** "The World Bank: Remittance Prices Worldwide", shown wherever the figures are. */
  attribution: string;
}
