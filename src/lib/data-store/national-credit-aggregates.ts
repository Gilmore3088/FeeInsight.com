import { sql } from "./connection";

/**
 * Reads over the national and state credit context Magellan's national-credit steps load into
 * area_statistics (sources national-series, nyfed-household-debt, nyfed-sce-credit,
 * cfpb-credit-trends). Server only; nothing here fetches from outside.
 *
 * "Change over 4 and 12 periods" counts the series' own observations, newest first: 4 weeks back
 * for a weekly H.8 series, 4 quarters back for SLOOS, 4 survey waves back for the SCE. A value the
 * publisher left blank stays null and no change is computed across it. Every median carries the
 * count of areas behind it.
 */

export const NATIONAL_CREDIT_AREA_SOURCES = ["national-series", "nyfed-household-debt", "nyfed-sce-credit", "cfpb-credit-trends"] as const;
export const HOUSEHOLD_DEBT_SOURCE = "nyfed-household-debt";
/** Observations read per series: the latest plus 12 back. */
const DEPTH = 13;

export interface SeriesPoint {
  period: string;
  value: number | null;
}

export interface PeriodChange {
  periods_back: number;
  period: string | null;
  value: number | null;
  change: number | null;
  /** Percent change; null when the earlier value is null or zero. */
  pct_change: number | null;
}

export interface SeriesSummary {
  source: string;
  series_key: string;
  unit: string;
  period: string;
  value: number | null;
  note: string | null;
  change_4: PeriodChange;
  change_12: PeriodChange;
}

function round(value: number, places = 6): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

/** Change from `periodsBack` observations ago to the latest; points newest first. */
export function changeOver(points: SeriesPoint[], periodsBack: number): PeriodChange {
  const latest = points[0];
  const earlier = points[periodsBack];
  if (!latest || !earlier) return { periods_back: periodsBack, period: earlier?.period ?? null, value: earlier?.value ?? null, change: null, pct_change: null };
  const change = latest.value !== null && earlier.value !== null ? round(latest.value - earlier.value) : null;
  const pct = change !== null && earlier.value !== null && earlier.value !== 0 ? round((change / Math.abs(earlier.value)) * 100, 4) : null;
  return { periods_back: periodsBack, period: earlier.period, value: earlier.value, change, pct_change: pct };
}

type Row = { source: string; series_key: string; period: string; value: number | null; unit: string; note: string | null };

/** Latest value with its 4- and 12-period changes, per (source, series). Rows in any order. */
export function summarizeSeries(rows: Row[]): SeriesSummary[] {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = `${row.source}|${row.series_key}`;
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  const out: SeriesSummary[] = [];
  for (const list of groups.values()) {
    // "2026-10-08", "2026-09", "2026Q3": each sorts correctly as text within one series.
    const sorted = [...list].sort((a, b) => b.period.localeCompare(a.period));
    const latest = sorted[0];
    out.push({
      source: latest.source,
      series_key: latest.series_key,
      unit: latest.unit,
      period: latest.period,
      value: latest.value,
      note: latest.note,
      change_4: changeOver(sorted, 4),
      change_12: changeOver(sorted, 12),
    });
  }
  return out.sort((a, b) => a.source.localeCompare(b.source) || a.series_key.localeCompare(b.series_key));
}

/**
 * National credit context: every national series from the four sources (or the ones named), latest
 * value with its change over 4 and 12 periods.
 */
export async function getNationalCreditSummary(options: { sources?: string[]; seriesKeys?: string[] } = {}): Promise<SeriesSummary[]> {
  const sources = options.sources?.length ? options.sources : [...NATIONAL_CREDIT_AREA_SOURCES];
  const keys = options.seriesKeys?.length ? options.seriesKeys : null;
  const rows = await sql<Row[]>`
    SELECT source, series_key, period, value, unit, note
      FROM (
        SELECT source, series_key, period, value::float8 AS value, unit, note,
               ROW_NUMBER() OVER (PARTITION BY source, series_key ORDER BY period DESC) AS rn
          FROM area_statistics
         WHERE geo_type = 'nation' AND geo_code = 'US'
           AND source = ANY(${sources})
           AND (${keys}::text[] IS NULL OR series_key = ANY(${keys}::text[]))
      ) ranked
     WHERE rn <= ${DEPTH}
  `;
  return summarizeSeries([...rows]);
}

export interface StateVsNation {
  series_key: string;
  unit: string;
  state: SeriesSummary;
  /** The nation's value for the state's latest period, when the workbook carries a national row. */
  national_value: number | null;
  /** State minus nation, and state over nation; null without both values. */
  difference: number | null;
  ratio: number | null;
  /** Median of every state's value for the same period, with how many states are behind it. */
  states_median: number | null;
  states_count: number;
  /** 1 = highest value among the states with a value that period. */
  rank: number | null;
}

/** Pure: compare one state's series summaries with national values and the across-state distribution. */
export function compareStateToNation(
  state: SeriesSummary[],
  national: Array<{ series_key: string; period: string; value: number | null }>,
  distribution: Array<{ series_key: string; period: string; states: number; median: number | null; rank: number | null }>,
): StateVsNation[] {
  return state.map((s) => {
    const nation = national.find((r) => r.series_key === s.series_key && r.period === s.period);
    const dist = distribution.find((d) => d.series_key === s.series_key && d.period === s.period);
    const nv = nation?.value ?? null;
    return {
      series_key: s.series_key,
      unit: s.unit,
      state: s,
      national_value: nv,
      difference: s.value !== null && nv !== null ? round(s.value - nv) : null,
      ratio: s.value !== null && nv !== null && nv !== 0 ? round(s.value / nv, 4) : null,
      states_median: dist?.median ?? null,
      states_count: dist?.states ?? 0,
      rank: dist?.rank ?? null,
    };
  });
}

/**
 * One state's household debt (balance per capita and 90+ day delinquency by loan type): latest
 * value, change over 4 and 12 periods, the nation's value for that period, and where the state
 * sits among all states (median with its count, rank).
 */
export async function getHouseholdDebtStateVsNation(stateCode: string): Promise<StateVsNation[]> {
  const state = stateCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) return [];
  const stateRows = await sql<Row[]>`
    SELECT source, series_key, period, value, unit, note
      FROM (
        SELECT source, series_key, period, value::float8 AS value, unit, note,
               ROW_NUMBER() OVER (PARTITION BY series_key ORDER BY period DESC) AS rn
          FROM area_statistics
         WHERE source = ${HOUSEHOLD_DEBT_SOURCE} AND geo_type = 'state' AND geo_code = ${state}
      ) ranked
     WHERE rn <= ${DEPTH}
  `;
  const summaries = summarizeSeries([...stateRows]);
  if (summaries.length === 0) return [];
  const keys = summaries.map((s) => s.series_key);
  const periods = summaries.map((s) => s.period);
  const [national, distribution] = await Promise.all([
    sql<Array<{ series_key: string; period: string; value: number | null }>>`
      SELECT series_key, period, value::float8 AS value
        FROM area_statistics
       WHERE source = ${HOUSEHOLD_DEBT_SOURCE} AND geo_type = 'nation' AND geo_code = 'US'
         AND (series_key, period) IN (SELECT * FROM unnest(${keys}::text[], ${periods}::text[]))
    `,
    sql<Array<{ series_key: string; period: string; states: number; median: number | null; rank: number | null }>>`
      WITH wanted AS (SELECT * FROM unnest(${keys}::text[], ${periods}::text[]) AS w(series_key, period)),
      ranked AS (
        SELECT a.series_key, a.period, a.geo_code, a.value,
               RANK() OVER (PARTITION BY a.series_key, a.period ORDER BY a.value DESC) AS rank
          FROM area_statistics a
          JOIN wanted w ON w.series_key = a.series_key AND w.period = a.period
         WHERE a.source = ${HOUSEHOLD_DEBT_SOURCE} AND a.geo_type = 'state' AND a.value IS NOT NULL
      )
      SELECT series_key, period, COUNT(*)::int AS states,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY value)::float8 AS median,
             MAX(CASE WHEN geo_code = ${state} THEN rank END)::int AS rank
        FROM ranked
       GROUP BY series_key, period
    `,
  ]);
  return compareStateToNation(summaries, [...national], [...distribution]);
}

export interface HouseholdDebtStateRow {
  state_code: string;
  period: string;
  value: number | null;
  note: string | null;
}

/** Every state's newest value for one household-debt series, for a state table, with the nation and the states' median and count. */
export async function getHouseholdDebtStateTable(seriesKey: string): Promise<{
  series_key: string;
  period: string | null;
  states: HouseholdDebtStateRow[];
  national_value: number | null;
  states_median: number | null;
  states_count: number;
}> {
  const rows = await sql<HouseholdDebtStateRow[]>`
    SELECT geo_code AS state_code, period, value::float8 AS value, note
      FROM area_statistics
     WHERE source = ${HOUSEHOLD_DEBT_SOURCE} AND geo_type = 'state' AND series_key = ${seriesKey}
       AND period = (SELECT MAX(period) FROM area_statistics WHERE source = ${HOUSEHOLD_DEBT_SOURCE} AND geo_type = 'state' AND series_key = ${seriesKey})
     ORDER BY geo_code
  `;
  const list = [...rows];
  const period = list[0]?.period ?? null;
  const [nation] = period
    ? await sql<Array<{ value: number | null }>>`
        SELECT value::float8 AS value FROM area_statistics
         WHERE source = ${HOUSEHOLD_DEBT_SOURCE} AND geo_type = 'nation' AND geo_code = 'US'
           AND series_key = ${seriesKey} AND period = ${period}
      `
    : [];
  const { median, count } = medianWithCount(list.map((r) => r.value));
  return { series_key: seriesKey, period, states: list, national_value: nation?.value ?? null, states_median: median, states_count: count };
}

/** Median of the non-null values (interpolated, as percentile_cont), with how many there were. */
export function medianWithCount(values: Array<number | null>): { median: number | null; count: number } {
  const sorted = values.filter((v): v is number => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return { median: null, count: 0 };
  const mid = (sorted.length - 1) / 2;
  const lo = sorted[Math.floor(mid)];
  const hi = sorted[Math.ceil(mid)];
  return { median: round((lo + hi) / 2), count: sorted.length };
}
