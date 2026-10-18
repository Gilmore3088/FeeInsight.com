import { STATE_FROM_FIPS } from "@/lib/regulatory/economy";
import { sql } from "./connection";

/**
 * Where markets are growing, read from area_statistics rows the market-growth registry steps
 * load (census-permits, census-popest, irs-migration, census-bfs, bls-laus, census-lehd). Server
 * only; nothing here fetches from outside.
 *
 * Shaped for Hamilton's strategy questions: is this county growing faster than its state and the
 * nation (latest value with 1- and 5-year change), which counties in a state grow fastest, and
 * who is moving in or out and with how much income. Every median carries the count behind it.
 * A blank value stays null and is never counted as zero.
 */

export type GrowthGeoType = "nation" | "state" | "county";
/** Annual periods ("2025"), monthly ("2026-08"), or both. Permits, BFS and LAUS carry both under one series. */
export type GrowthFrequency = "annual" | "monthly";

export interface SeriesPoint {
  geo_type: GrowthGeoType;
  geo_code: string;
  geo_name: string | null;
  period: string;
  value: number | null;
  unit: string;
  note: string | null;
}

export interface ChangeOver {
  base_period: string;
  base_value: number | null;
  change: number | null;
  /** Percent change; null when the base is blank or zero. */
  pct_change: number | null;
}

export interface GrowthPoint {
  geo_type: GrowthGeoType;
  geo_code: string;
  geo_name: string | null;
  period: string | null;
  value: number | null;
  unit: string | null;
  note: string | null;
  one_year: ChangeOver | null;
  five_year: ChangeOver | null;
}

const PERIOD_PATTERN: Record<GrowthFrequency, RegExp> = { annual: /^\d{4}$/, monthly: /^\d{4}-\d{2}$/ };

export function periodMatches(period: string, frequency: GrowthFrequency): boolean {
  return PERIOD_PATTERN[frequency].test(period);
}

/** The same period `years` earlier: "2025" -> "2020", "2026-08" -> "2025-08", "2026Q2" -> "2025Q2". */
export function periodBack(period: string, years: number): string | null {
  if (/^\d{4}$/.test(period)) return String(Number(period) - years);
  const m = /^(\d{4})(-\d{2}|Q[1-4])$/.exec(period);
  return m ? `${Number(m[1]) - years}${m[2]}` : null;
}

export function changeBetween(value: number | null, base: number | null, basePeriod: string): ChangeOver {
  const change = value !== null && base !== null ? value - base : null;
  const pct = change !== null && base !== null && base !== 0 ? Math.round((change / Math.abs(base)) * 10_000) / 100 : null;
  return { base_period: basePeriod, base_value: base, change, pct_change: pct };
}

/** Median with the count behind it; fewer than `min` values gives no median. */
export function medianWithCount(values: Array<number | null>, min = 1): { median: number | null; count: number } {
  const list = values.filter((v): v is number => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
  if (list.length < min || list.length === 0) return { median: null, count: list.length };
  const mid = Math.floor(list.length / 2);
  const median = list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
  return { median: Math.round(median * 1000) / 1000, count: list.length };
}

/**
 * Latest value and 1- and 5-year change for one area from its rows of one series. With `atPeriod`
 * the value is read at that period (so a state lines up with its county); otherwise the newest.
 */
export function growthPoint(rows: SeriesPoint[], frequency: GrowthFrequency, atPeriod: string | null = null): GrowthPoint | null {
  const list = rows.filter((r) => periodMatches(r.period, frequency));
  if (list.length === 0) return null;
  const byPeriod = new Map(list.map((r) => [r.period, r]));
  const newest = [...byPeriod.keys()].sort().reverse()[0];
  const latest = byPeriod.get(atPeriod && byPeriod.has(atPeriod) ? atPeriod : newest)!;
  const over = (years: number): ChangeOver | null => {
    const back = periodBack(latest.period, years);
    if (!back || !byPeriod.has(back)) return null;
    return changeBetween(latest.value, byPeriod.get(back)!.value, back);
  };
  return {
    geo_type: latest.geo_type,
    geo_code: latest.geo_code,
    geo_name: latest.geo_name,
    period: latest.period,
    value: latest.value,
    unit: latest.unit,
    note: latest.note,
    one_year: over(1),
    five_year: over(5),
  };
}

export interface CountyVsPeers {
  series_key: string;
  frequency: GrowthFrequency;
  county: GrowthPoint | null;
  state: GrowthPoint | null;
  nation: GrowthPoint | null;
}

/** Groups rows by series and area, then lines the state and nation up with the county's latest period. */
export function countyVsPeers(rows: Array<SeriesPoint & { series_key: string }>, seriesKey: string, frequency: GrowthFrequency): CountyVsPeers {
  const pick = (geo: GrowthGeoType) => rows.filter((r) => r.series_key === seriesKey && r.geo_type === geo);
  const county = growthPoint(pick("county"), frequency);
  const at = county?.period ?? null;
  return { series_key: seriesKey, frequency, county, state: growthPoint(pick("state"), frequency, at), nation: growthPoint(pick("nation"), frequency, at) };
}

export function countyFips(code: string): string | null {
  const raw = code.trim();
  if (!/^\d{4,5}$/.test(raw)) return null;
  const fips = raw.padStart(5, "0");
  return STATE_FROM_FIPS[fips.slice(0, 2)] ? fips : null;
}

type SeriesRow = SeriesPoint & { series_key: string };

async function seriesRowsForCounty(fips: string, seriesKeys: string[]): Promise<SeriesRow[]> {
  const state = STATE_FROM_FIPS[fips.slice(0, 2)];
  const rows = await sql<SeriesRow[]>`
    SELECT geo_type, geo_code, geo_name, period, series_key, value::float8 AS value, unit, note
      FROM area_statistics
     WHERE series_key = ANY(${seriesKeys})
       AND ((geo_type = 'county' AND geo_code = ${fips})
         OR (geo_type = 'state' AND geo_code = ${state})
         OR (geo_type = 'nation' AND geo_code = 'US'))
  `;
  return [...rows];
}

/** One county series against its state and the nation: latest value, 1- and 5-year change. */
export async function getCountyGrowthVsPeers(code: string, seriesKey: string, frequency: GrowthFrequency = "annual"): Promise<CountyVsPeers | null> {
  const fips = countyFips(code);
  if (!fips) return null;
  return countyVsPeers(await seriesRowsForCounty(fips, [seriesKey]), seriesKey, frequency);
}

/** The headline growth series for a market profile, with the frequency each is read at. */
export const MARKET_GROWTH_HEADLINES: ReadonlyArray<{ series_key: string; frequency: GrowthFrequency; label: string }> = [
  { series_key: "popest_population", frequency: "annual", label: "Population" },
  { series_key: "popest_net_migration", frequency: "annual", label: "Net migration (people)" },
  { series_key: "permits_units_total", frequency: "annual", label: "Housing units permitted" },
  { series_key: "bfs_applications", frequency: "annual", label: "Business applications" },
  { series_key: "laus_labor_force", frequency: "monthly", label: "Labor force" },
  { series_key: "laus_unemployment_rate", frequency: "monthly", label: "Unemployment rate" },
  { series_key: "lodes_jobs_workplace", frequency: "annual", label: "Jobs located in the county" },
  { series_key: "lodes_daytime_ratio", frequency: "annual", label: "Jobs per resident worker" },
  { series_key: "irs_mig_net_returns", frequency: "annual", label: "Net households moving in (tax returns)" },
  { series_key: "irs_mig_net_agi", frequency: "annual", label: "Net income moving in ($ thousands AGI)" },
];

/** Every headline series for one county against its state and the nation, in one read. */
export async function getMarketGrowthProfile(code: string): Promise<Array<CountyVsPeers & { label: string }> | null> {
  const fips = countyFips(code);
  if (!fips) return null;
  const rows = await seriesRowsForCounty(fips, MARKET_GROWTH_HEADLINES.map((h) => h.series_key));
  return MARKET_GROWTH_HEADLINES.map((h) => ({ label: h.label, ...countyVsPeers(rows, h.series_key, h.frequency) }));
}

export interface CountyGrowthRank {
  rank: number;
  geo_code: string;
  geo_name: string | null;
  value: number | null;
  base_value: number | null;
  change: number | null;
  pct_change: number | null;
}

export interface StateGrowthRanking {
  state_code: string;
  series_key: string;
  period: string | null;
  base_period: string | null;
  /** Counties with both values, ranked by percent change (then by change where the base is zero). */
  counties: CountyGrowthRank[];
  /** Counties in the state with a row for the period but no change (blank value or base). */
  unranked: number;
  median_pct_change: number | null;
  median_count: number;
}

/** Ranks counties by change between the latest period loaded for the state and `years` before it. */
export function rankCountyGrowth(rows: SeriesRow[], stateCode: string, seriesKey: string, years: number, frequency: GrowthFrequency): StateGrowthRanking {
  const list = rows.filter((r) => r.geo_type === "county" && r.series_key === seriesKey && periodMatches(r.period, frequency));
  const period = [...new Set(list.map((r) => r.period))].sort().reverse()[0] ?? null;
  const basePeriod = period ? periodBack(period, years) : null;
  const empty: StateGrowthRanking = { state_code: stateCode, series_key: seriesKey, period, base_period: basePeriod, counties: [], unranked: 0, median_pct_change: null, median_count: 0 };
  if (!period || !basePeriod) return empty;
  const latest = new Map(list.filter((r) => r.period === period).map((r) => [r.geo_code, r]));
  const base = new Map(list.filter((r) => r.period === basePeriod).map((r) => [r.geo_code, r]));
  const ranked: Omit<CountyGrowthRank, "rank">[] = [];
  let unranked = 0;
  for (const [code, row] of latest) {
    const c = changeBetween(row.value, base.get(code)?.value ?? null, basePeriod);
    if (c.change === null) {
      unranked += 1;
      continue;
    }
    ranked.push({ geo_code: code, geo_name: row.geo_name, value: row.value, base_value: c.base_value, change: c.change, pct_change: c.pct_change });
  }
  ranked.sort((a, b) => (b.pct_change ?? -Infinity) - (a.pct_change ?? -Infinity) || (b.change ?? 0) - (a.change ?? 0) || a.geo_code.localeCompare(b.geo_code));
  const med = medianWithCount(ranked.map((r) => r.pct_change));
  return { ...empty, counties: ranked.map((r, i) => ({ rank: i + 1, ...r })), unranked, median_pct_change: med.median, median_count: med.count };
}

/** Counties in a state ranked by growth in one series over 1 or 5 years. */
export async function getStateCountyGrowthRanking(stateCode: string, seriesKey: string, years: 1 | 5 = 1, frequency: GrowthFrequency = "annual"): Promise<StateGrowthRanking | null> {
  const state = stateCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) return null;
  const rows = await sql<SeriesRow[]>`
    SELECT geo_type, geo_code, geo_name, period, series_key, value::float8 AS value, unit, note
      FROM area_statistics
     WHERE geo_type = 'county' AND state_code = ${state} AND series_key = ${seriesKey}
  `;
  return rankCountyGrowth([...rows], state, seriesKey, years, frequency);
}

export interface MigrationFlow {
  returns: number | null;
  individuals: number | null;
  agi_thousands: number | null;
  agi_per_return: number | null;
}

export interface MigrationTopFlow {
  fips: string;
  state: string | null;
  name: string | null;
  returns: number;
  individuals: number | null;
  agi: number | null;
}

export interface NetMigrationWithIncome {
  geo_type: "county" | "state";
  geo_code: string;
  geo_name: string | null;
  period: string;
  inflow: MigrationFlow;
  outflow: MigrationFlow;
  net: Omit<MigrationFlow, "agi_per_return">;
  nonmigrant_returns: number | null;
  /** Average AGI of households moving in minus those moving out, in dollars. */
  income_gap_per_return: number | null;
  top_origins: MigrationTopFlow[];
  top_destinations: MigrationTopFlow[];
}

type MigrationRow = { geo_type: "county" | "state"; geo_code: string; geo_name: string | null; period: string; series_key: string; value: number | null; raw_json: Record<string, unknown> | null };

/** Builds the migration summary for one area and period from its irs_mig_* rows. */
export function migrationSummary(rows: MigrationRow[], period: string): NetMigrationWithIncome | null {
  const at = rows.filter((r) => r.period === period);
  if (at.length === 0) return null;
  const get = (key: string) => at.find((r) => r.series_key === key) ?? null;
  const v = (key: string) => get(key)?.value ?? null;
  const flow = (side: "inflow" | "outflow"): MigrationFlow => ({
    returns: v(`irs_mig_${side}_returns`),
    individuals: v(`irs_mig_${side}_individuals`),
    agi_thousands: v(`irs_mig_${side}_agi`),
    agi_per_return: v(`irs_mig_${side}_agi_per_return`),
  });
  const inflow = flow("inflow");
  const outflow = flow("outflow");
  const tops = (key: string, field: string) => {
    const list = get(key)?.raw_json?.[field];
    return Array.isArray(list) ? (list as MigrationTopFlow[]) : [];
  };
  return {
    geo_type: at[0].geo_type,
    geo_code: at[0].geo_code,
    geo_name: at.find((r) => r.geo_name)?.geo_name ?? null,
    period,
    inflow,
    outflow,
    net: { returns: v("irs_mig_net_returns"), individuals: v("irs_mig_net_individuals"), agi_thousands: v("irs_mig_net_agi") },
    nonmigrant_returns: v("irs_mig_nonmigrant_returns"),
    income_gap_per_return: inflow.agi_per_return !== null && outflow.agi_per_return !== null ? inflow.agi_per_return - outflow.agi_per_return : null,
    top_origins: tops("irs_mig_inflow_returns", "top_origins"),
    top_destinations: tops("irs_mig_outflow_returns", "top_destinations"),
  };
}

/** Who moved in and out of a county or state (IRS returns), with income, for the latest year or `year`. */
export async function getNetMigrationWithIncome(geoType: "county" | "state", code: string, year?: number): Promise<NetMigrationWithIncome | null> {
  const geoCode = geoType === "county" ? countyFips(code) : /^[A-Za-z]{2}$/.test(code.trim()) ? code.trim().toUpperCase() : null;
  if (!geoCode) return null;
  const rows = await sql<MigrationRow[]>`
    SELECT geo_type, geo_code, geo_name, period, series_key, value::float8 AS value, raw_json
      FROM area_statistics
     WHERE source = 'irs-migration' AND geo_type = ${geoType} AND geo_code = ${geoCode}
  `;
  const list = [...rows];
  const period = year ? String(year) : [...new Set(list.map((r) => r.period))].sort().reverse()[0];
  return period ? migrationSummary(list, period) : null;
}

export interface CountyMigrationRow {
  geo_code: string;
  geo_name: string | null;
  net_returns: number | null;
  net_agi_thousands: number | null;
  inflow_agi_per_return: number | null;
  outflow_agi_per_return: number | null;
}

export interface StateMigrationTable {
  state_code: string;
  period: string | null;
  counties: CountyMigrationRow[];
  median_net_returns: number | null;
  median_net_returns_count: number;
  median_net_agi_thousands: number | null;
  median_net_agi_count: number;
}

/** Pivots irs_mig_* county rows for one period, sorted by net AGI moving in (largest gain first). */
export function migrationTable(rows: Array<{ geo_code: string; geo_name: string | null; series_key: string; value: number | null; period: string }>, stateCode: string, period: string | null): StateMigrationTable {
  const byCounty = new Map<string, CountyMigrationRow>();
  for (const r of rows) {
    if (r.period !== period) continue;
    const row = byCounty.get(r.geo_code) ?? { geo_code: r.geo_code, geo_name: r.geo_name, net_returns: null, net_agi_thousands: null, inflow_agi_per_return: null, outflow_agi_per_return: null };
    if (r.series_key === "irs_mig_net_returns") row.net_returns = r.value;
    if (r.series_key === "irs_mig_net_agi") row.net_agi_thousands = r.value;
    if (r.series_key === "irs_mig_inflow_agi_per_return") row.inflow_agi_per_return = r.value;
    if (r.series_key === "irs_mig_outflow_agi_per_return") row.outflow_agi_per_return = r.value;
    row.geo_name ??= r.geo_name;
    byCounty.set(r.geo_code, row);
  }
  const counties = [...byCounty.values()].sort((a, b) => (b.net_agi_thousands ?? -Infinity) - (a.net_agi_thousands ?? -Infinity) || a.geo_code.localeCompare(b.geo_code));
  const r = medianWithCount(counties.map((c) => c.net_returns));
  const a = medianWithCount(counties.map((c) => c.net_agi_thousands));
  return { state_code: stateCode, period, counties, median_net_returns: r.median, median_net_returns_count: r.count, median_net_agi_thousands: a.median, median_net_agi_count: a.count };
}

/** Every county in a state: net households and net income moving in, latest IRS year (or `year`). */
export async function getStateCountyMigration(stateCode: string, year?: number): Promise<StateMigrationTable | null> {
  const state = stateCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) return null;
  const rows = await sql<Array<{ geo_code: string; geo_name: string | null; series_key: string; value: number | null; period: string }>>`
    SELECT geo_code, geo_name, series_key, value::float8 AS value, period
      FROM area_statistics
     WHERE source = 'irs-migration' AND geo_type = 'county' AND state_code = ${state}
       AND series_key IN ('irs_mig_net_returns', 'irs_mig_net_agi', 'irs_mig_inflow_agi_per_return', 'irs_mig_outflow_agi_per_return')
  `;
  const list = [...rows];
  const period = year ? String(year) : [...new Set(list.map((r) => r.period))].sort().reverse()[0] ?? null;
  return migrationTable(list, state, period);
}
