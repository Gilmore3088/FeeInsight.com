import { normalizeGeoCode, type AreaGeoType } from "./economy-aggregates";
import { sql } from "./connection";

/**
 * Reads for Hamilton over the risk-and-cost area sources in area_statistics: US Courts
 * bankruptcy filings (`uscourts-bankruptcy`), USDA farm income and cash rents (`usda-farm`) and
 * BLS OEWS bank-occupation wages (`bls-oews`).
 * Server only; nothing here fetches from outside.
 *
 * Each read puts an area's value next to the nation (and, for a metro or county, its state) for
 * the same period, with the change since the previous period or year. Every median carries the
 * number of areas it was taken over. A value the publisher left blank stays null and is never
 * counted.
 */

export const RISK_COST_SOURCES = {
  bankruptcy: "uscourts-bankruptcy",
  farm: "usda-farm",
  oews: "bls-oews",
} as const;

export interface AreaValueRow {
  series_key: string;
  period: string;
  value: number | null;
  unit: string;
  note: string | null;
  geo_name: string | null;
  raw?: Record<string, unknown> | null;
}

export interface Comparison {
  difference: number | null;
  /** value / benchmark, e.g. 1.12 = 12% above. */
  ratio: number | null;
}

export function compareToBenchmark(value: number | null, benchmark: number | null): Comparison {
  if (value === null || benchmark === null) return { difference: null, ratio: null };
  return { difference: round(value - benchmark), ratio: benchmark === 0 ? null : round(value / benchmark, 4) };
}

export function percentChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return round(((current - previous) / Math.abs(previous)) * 100, 2);
}

export function round(value: number, places = 2): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

/** Median of the published (non-null) values, with how many there were. */
export function medianWithCount(values: Array<number | null>): { median: number | null; count: number } {
  const v = values.filter((x): x is number => x !== null && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return { median: null, count: 0 };
  const mid = Math.floor(v.length / 2);
  return { median: v.length % 2 ? v[mid] : round((v[mid - 1] + v[mid]) / 2, 4), count: v.length };
}

/** "2025Q2" -> "2024Q2"; "2025" -> "2024": the same period a year earlier. */
export function yearEarlier(period: string): string | null {
  const q = period.match(/^(\d{4})(Q[1-4])$/);
  if (q) return `${Number(q[1]) - 1}${q[2]}`;
  const m = period.match(/^(\d{4})(-\d{2})$/);
  if (m) return `${Number(m[1]) - 1}${m[2]}`;
  return /^\d{4}$/.test(period) ? String(Number(period) - 1) : null;
}

export interface SeriesVsBenchmarks {
  series_key: string;
  unit: string;
  period: string;
  value: number | null;
  note: string | null;
  /** The period compared with: a year earlier (same quarter for quarterly data), or the previous one loaded (survey waves). */
  prior_period: string | null;
  prior_value: number | null;
  change_pct: number | null;
  state: { value: number | null; vs: Comparison } | null;
  nation: { value: number | null; vs: Comparison };
  raw: Record<string, unknown> | null;
}

type Keyed = Map<string, AreaValueRow>;
const keyOf = (series: string, period: string) => `${series}|${period}`;

/**
 * Pure join: for each series, the area's newest period next to the same period for the nation
 * (and state, when given), plus the change from a year earlier.
 */
export function joinWithBenchmarks(
  area: AreaValueRow[],
  nation: AreaValueRow[],
  state: AreaValueRow[] | null = null,
  compare: "year_earlier" | "previous" = "year_earlier",
): SeriesVsBenchmarks[] {
  const index = (rows: AreaValueRow[]): Keyed => new Map(rows.map((r) => [keyOf(r.series_key, r.period), r]));
  const a = index(area);
  const n = index(nation);
  const s = state ? index(state) : null;
  const latest = new Map<string, AreaValueRow>();
  for (const r of area) {
    const cur = latest.get(r.series_key);
    if (!cur || r.period.localeCompare(cur.period) > 0) latest.set(r.series_key, r);
  }
  return [...latest.values()]
    .sort((x, y) => x.series_key.localeCompare(y.series_key))
    .map((r) => {
      const prior =
        compare === "year_earlier"
          ? yearEarlier(r.period)
          : area
              .filter((x) => x.series_key === r.series_key && x.period.localeCompare(r.period) < 0)
              .map((x) => x.period)
              .sort()
              .at(-1) ?? null;
      const prev = prior ? a.get(keyOf(r.series_key, prior)) ?? null : null;
      const nat = n.get(keyOf(r.series_key, r.period))?.value ?? null;
      const st = s ? s.get(keyOf(r.series_key, r.period))?.value ?? null : null;
      return {
        series_key: r.series_key,
        unit: r.unit,
        period: r.period,
        value: r.value,
        note: r.note,
        prior_period: prev ? prior : null,
        prior_value: prev?.value ?? null,
        change_pct: percentChange(r.value, prev?.value ?? null),
        state: s ? { value: st, vs: compareToBenchmark(r.value, st) } : null,
        nation: { value: nat, vs: compareToBenchmark(r.value, nat) },
        raw: r.raw ?? null,
      };
    });
}

async function areaRows(source: string, geoType: AreaGeoType, geoCode: string, seriesPrefix: string | null, periods: number): Promise<AreaValueRow[]> {
  const prefix = seriesPrefix ? `${seriesPrefix}%` : "%";
  const rows = await sql<AreaValueRow[]>`
    SELECT series_key, period, value::float8 AS value, unit, note, geo_name, raw_json AS raw
      FROM (
        SELECT a.*, DENSE_RANK() OVER (PARTITION BY series_key ORDER BY period DESC) AS rk
          FROM area_statistics a
         WHERE a.source = ${source} AND a.geo_type = ${geoType} AND a.geo_code = ${geoCode}
           AND a.series_key LIKE ${prefix}
      ) ranked
     WHERE rk <= ${periods}
  `;
  return [...rows];
}

/**
 * One area's series from one source against the nation (and its state for a county or metro):
 * newest period, a year earlier, and the gap to each benchmark.
 */
export async function getAreaVsBenchmarks(input: {
  source: string;
  geoType: Exclude<AreaGeoType, "nation">;
  geoCode: string;
  seriesPrefix?: string;
  /** Periods read back per series (5 covers a year earlier for quarterly data). */
  periods?: number;
  /** State to compare a county or metro with; defaults to the row's state_code. */
  stateCode?: string | null;
  compare?: "year_earlier" | "previous";
}): Promise<SeriesVsBenchmarks[]> {
  const code = normalizeGeoCode(input.geoType, input.geoCode);
  if (!code) return [];
  const periods = input.periods ?? 5;
  const area = await areaRows(input.source, input.geoType, code, input.seriesPrefix ?? null, periods);
  if (area.length === 0) return [];
  let stateCode: string | null = null;
  if (input.geoType !== "state") {
    stateCode = input.stateCode ?? null;
    if (!stateCode) {
      const [row] = await sql<Array<{ state_code: string | null }>>`
        SELECT state_code FROM area_statistics
         WHERE source = ${input.source} AND geo_type = ${input.geoType} AND geo_code = ${code}
         LIMIT 1
      `;
      stateCode = row?.state_code ?? null;
    }
  }
  const [nation, state] = await Promise.all([
    areaRows(input.source, "nation", "US", input.seriesPrefix ?? null, periods),
    stateCode ? areaRows(input.source, "state", stateCode, input.seriesPrefix ?? null, periods) : Promise.resolve(null),
  ]);
  return joinWithBenchmarks(area, nation, input.geoType === "state" ? null : state ?? [], input.compare);
}

// ---------------------------------------------------------------------------
// Bankruptcy filings
// ---------------------------------------------------------------------------

export interface BankruptcyTrendPoint {
  period: string;
  state_value: number | null;
  nation_value: number | null;
  /** State filings as a share of the nation's, in percent. */
  state_share_of_nation_pct: number | null;
  state_change_yoy_pct: number | null;
  nation_change_yoy_pct: number | null;
}

/** Pure: one series' state and nation values per period, with year-over-year change. */
export function bankruptcyTrend(state: AreaValueRow[], nation: AreaValueRow[], quarters: number): BankruptcyTrendPoint[] {
  const s = new Map(state.map((r) => [r.period, r.value]));
  const n = new Map(nation.map((r) => [r.period, r.value]));
  const periods = [...new Set([...s.keys(), ...n.keys()])].sort().reverse().slice(0, quarters);
  return periods.map((p) => {
    const prior = yearEarlier(p);
    const sv = s.get(p) ?? null;
    const nv = n.get(p) ?? null;
    return {
      period: p,
      state_value: sv,
      nation_value: nv,
      state_share_of_nation_pct: sv !== null && nv ? round((sv / nv) * 100, 3) : null,
      state_change_yoy_pct: percentChange(sv, prior ? s.get(prior) ?? null : null),
      nation_change_yoy_pct: percentChange(nv, prior ? n.get(prior) ?? null : null),
    };
  });
}

/**
 * A state's quarterly bankruptcy filings against the nation's, newest first, for one group
 * (nonbusiness = consumer, business) and chapter. Uses the 3-month table's series.
 */
export async function getBankruptcyTrend(
  stateCode: string,
  options: { group?: "total" | "business" | "nonbusiness"; chapter?: "all_chapters" | "ch7" | "ch11" | "ch13"; quarters?: number } = {},
): Promise<{ series_key: string; points: BankruptcyTrendPoint[] }> {
  const state = normalizeGeoCode("state", stateCode);
  const seriesKey = `bankruptcy_3mo_${options.group ?? "nonbusiness"}_${options.chapter ?? "all_chapters"}`;
  const quarters = options.quarters ?? 8;
  if (!state) return { series_key: seriesKey, points: [] };
  const rows = await sql<Array<AreaValueRow & { geo_type: string }>>`
    SELECT geo_type, series_key, period, value::float8 AS value, unit, note, geo_name
      FROM area_statistics
     WHERE source = ${RISK_COST_SOURCES.bankruptcy} AND series_key = ${seriesKey}
       AND ((geo_type = 'state' AND geo_code = ${state}) OR (geo_type = 'nation' AND geo_code = 'US'))
     ORDER BY period DESC
     LIMIT ${(quarters + 4) * 2}
  `;
  const list = [...rows];
  return { series_key: seriesKey, points: bankruptcyTrend(list.filter((r) => r.geo_type === "state"), list.filter((r) => r.geo_type === "nation"), quarters) };
}

// ---------------------------------------------------------------------------
// OEWS wages
// ---------------------------------------------------------------------------

export const OEWS_OCCUPATION_SLUGS = ["tellers", "loan_officers", "customer_service_reps", "new_accounts_clerks", "loan_interviewers_clerks", "financial_managers", "credit_analysts"] as const;

export interface OccupationWageComparison {
  occupation: string;
  period: string | null;
  employment: number | null;
  hourly_median: number | null;
  annual_median: number | null;
  /** The metro's primary state as BLS names it (multi-state metros included). */
  state_code: string | null;
  state_hourly_median: number | null;
  nation_hourly_median: number | null;
  vs_state: Comparison;
  vs_nation: Comparison;
  /** BLS marks on the metro's values ("*", "**", "#"), by measure. */
  notes: Record<string, string>;
}

/** Pure: per occupation, the metro's median wage against its state and the nation. */
export function oewsMetroComparison(metro: AreaValueRow[], state: AreaValueRow[], nation: AreaValueRow[], stateCode: string | null): OccupationWageComparison[] {
  const pick = (rows: AreaValueRow[], key: string) => rows.find((r) => r.series_key === key) ?? null;
  return OEWS_OCCUPATION_SLUGS.map((occ) => {
    const k = (m: string) => `oews_${occ}_${m}`;
    const hourly = pick(metro, k("hourly_median"));
    const notes: Record<string, string> = {};
    for (const m of ["employment", "hourly_median", "annual_median"]) {
      const r = pick(metro, k(m));
      if (r?.note) notes[m] = r.note;
    }
    const st = pick(state, k("hourly_median"))?.value ?? null;
    const nt = pick(nation, k("hourly_median"))?.value ?? null;
    return {
      occupation: occ,
      period: hourly?.period ?? null,
      employment: pick(metro, k("employment"))?.value ?? null,
      hourly_median: hourly?.value ?? null,
      annual_median: pick(metro, k("annual_median"))?.value ?? null,
      state_code: stateCode,
      state_hourly_median: st,
      nation_hourly_median: nt,
      vs_state: compareToBenchmark(hourly?.value ?? null, st),
      vs_nation: compareToBenchmark(hourly?.value ?? null, nt),
      notes,
    };
  }).filter((r) => r.period !== null);
}

/** A metro's bank-occupation wages for its newest OEWS year against its state and the nation. */
export async function getOewsMetroWages(cbsaCode: string): Promise<{ cbsa_code: string; period: string | null; occupations: OccupationWageComparison[] }> {
  const code = normalizeGeoCode("metro", cbsaCode);
  if (!code) return { cbsa_code: cbsaCode, period: null, occupations: [] };
  const metro = [
    ...(await sql<AreaValueRow[]>`
      SELECT series_key, period, value::float8 AS value, unit, note, geo_name, raw_json AS raw
        FROM area_statistics
       WHERE source = ${RISK_COST_SOURCES.oews} AND geo_type = 'metro' AND geo_code = ${code}
         AND period = (SELECT MAX(period) FROM area_statistics WHERE source = ${RISK_COST_SOURCES.oews} AND geo_type = 'metro' AND geo_code = ${code})
    `),
  ];
  if (metro.length === 0) return { cbsa_code: code, period: null, occupations: [] };
  const period = metro[0].period;
  const primState = (metro.find((r) => r.raw && typeof r.raw.prim_state === "string")?.raw?.prim_state as string | undefined) ?? null;
  const benchmarks = [
    ...(await sql<Array<AreaValueRow & { geo_type: string }>>`
      SELECT geo_type, series_key, period, value::float8 AS value, unit, note, geo_name
        FROM area_statistics
       WHERE source = ${RISK_COST_SOURCES.oews} AND period = ${period}
         AND ((geo_type = 'nation' AND geo_code = 'US') OR (geo_type = 'state' AND geo_code = ${primState ?? ""}))
    `),
  ];
  return {
    cbsa_code: code,
    period,
    occupations: oewsMetroComparison(
      metro,
      benchmarks.filter((r) => r.geo_type === "state"),
      benchmarks.filter((r) => r.geo_type === "nation"),
      primState,
    ),
  };
}

/** Every state's value of one OEWS series for the newest year, with the median across states (and its count) and the nation. */
export async function getOewsStateSpread(occupation: (typeof OEWS_OCCUPATION_SLUGS)[number], measure: "hourly_median" | "annual_median" | "employment" = "hourly_median") {
  const seriesKey = `oews_${occupation}_${measure}`;
  const rows = [
    ...(await sql<Array<{ geo_type: string; geo_code: string; geo_name: string | null; period: string; value: number | null; note: string | null }>>`
      SELECT geo_type, geo_code, geo_name, period, value::float8 AS value, note
        FROM area_statistics
       WHERE source = ${RISK_COST_SOURCES.oews} AND series_key = ${seriesKey} AND geo_type IN ('state', 'nation')
         AND period = (SELECT MAX(period) FROM area_statistics WHERE source = ${RISK_COST_SOURCES.oews} AND series_key = ${seriesKey})
       ORDER BY value DESC NULLS LAST
    `),
  ];
  const states = rows.filter((r) => r.geo_type === "state");
  return {
    series_key: seriesKey,
    period: rows[0]?.period ?? null,
    nation: rows.find((r) => r.geo_type === "nation")?.value ?? null,
    states_median: medianWithCount(states.map((r) => r.value)),
    states,
  };
}

// ---------------------------------------------------------------------------
// USDA farm
// ---------------------------------------------------------------------------

/** A state's farm income and wealth, newest year, against the nation and a year earlier. */
export function getStateFarmEconomy(stateCode: string) {
  return getAreaVsBenchmarks({ source: RISK_COST_SOURCES.farm, geoType: "state", geoCode: stateCode, seriesPrefix: "usda_farm_", periods: 3 });
}

/** County cash rents in a state for one series, newest year: each county, the county median (with count), the state and the nation. */
export async function getCountyCashRents(stateCode: string, seriesKey = "usda_farm_cash_rent_cropland_non_irrigated") {
  const state = normalizeGeoCode("state", stateCode);
  if (!state) return null;
  const rows = [
    ...(await sql<Array<{ geo_type: string; geo_code: string; geo_name: string | null; period: string; value: number | null; note: string | null }>>`
      SELECT geo_type, geo_code, geo_name, period, value::float8 AS value, note
        FROM area_statistics
       WHERE source = ${RISK_COST_SOURCES.farm} AND series_key = ${seriesKey}
         AND ((geo_type IN ('county', 'state') AND state_code = ${state}) OR geo_type = 'nation')
         AND period = (SELECT MAX(period) FROM area_statistics WHERE source = ${RISK_COST_SOURCES.farm} AND series_key = ${seriesKey} AND state_code = ${state})
    `),
  ];
  const counties = rows.filter((r) => r.geo_type === "county").sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
  return {
    series_key: seriesKey,
    period: rows[0]?.period ?? null,
    state_value: rows.find((r) => r.geo_type === "state")?.value ?? null,
    nation_value: rows.find((r) => r.geo_type === "nation")?.value ?? null,
    county_median: medianWithCount(counties.map((r) => r.value)),
    counties,
  };
}
