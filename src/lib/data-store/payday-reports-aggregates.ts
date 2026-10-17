import { PAYDAY_METRICS } from "@/lib/regulatory/payday-reports";
import { sql } from "./connection";
import { medianWithCount, type MedianWithCount } from "./state-lists-aggregates";

/**
 * Reads over state payday / small-dollar annual report figures (area_statistics, source
 * state-payday-reports): the price of the alternative to overdraft. Server only. Only states
 * with a loaded report are compared, and every median says how many states it is over.
 */

export const PAYDAY_REPORTS_SOURCE = "state-payday-reports";
export const PAYDAY_SERIES = PAYDAY_METRICS.map((m) => m.key);

export interface PaydayFigureRow {
  geo_code: string;
  series_key: string;
  period: string;
  value: number | null;
  unit: string;
}

export interface PaydayFigure {
  series_key: string;
  unit: string;
  period: string;
  value: number | null;
  previous_period: string | null;
  previous_value: number | null;
  /** Latest value minus the value `years` report years earlier, when both are loaded. */
  change: number | null;
  change_from_period: string | null;
}

/** Pure: per series, the newest year, the one before it, and the change over `years` years. */
export function paydayFigures(rows: PaydayFigureRow[], years = 1): PaydayFigure[] {
  const bySeries = new Map<string, PaydayFigureRow[]>();
  for (const r of rows) bySeries.set(r.series_key, [...(bySeries.get(r.series_key) ?? []), r]);
  return [...bySeries.entries()]
    .map(([series, list]) => {
      const sorted = [...list].sort((a, b) => b.period.localeCompare(a.period));
      const [latest, previous] = sorted;
      const target = String(Number(latest.period) - years);
      const then = sorted.find((r) => r.period === target);
      return {
        series_key: series,
        unit: latest.unit,
        period: latest.period,
        value: latest.value,
        previous_period: previous?.period ?? null,
        previous_value: previous?.value ?? null,
        change: then && latest.value !== null && then.value !== null ? latest.value - then.value : null,
        change_from_period: then?.period ?? null,
      };
    })
    .sort((a, b) => PAYDAY_SERIES.indexOf(a.series_key) - PAYDAY_SERIES.indexOf(b.series_key));
}

/** One state's payday figures: newest report year, the one before, and the change over `years` years. */
export async function getStatePaydayFigures(stateCode: string, years = 1): Promise<PaydayFigure[]> {
  const state = stateCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) return [];
  const rows = await sql<PaydayFigureRow[]>`
    SELECT geo_code, series_key, period, value::float8 AS value, unit
      FROM area_statistics
     WHERE source = ${PAYDAY_REPORTS_SOURCE} AND geo_type = 'state' AND geo_code = ${state}
  `;
  return paydayFigures([...rows], years);
}

/** Pure: each state's newest value of one series, with the median across those states. */
export function paydayAcrossStates(rows: PaydayFigureRow[]): { states: PaydayFigureRow[]; median: MedianWithCount } {
  const latest = new Map<string, PaydayFigureRow>();
  for (const r of rows) {
    const cur = latest.get(r.geo_code);
    if (!cur || r.period > cur.period) latest.set(r.geo_code, r);
  }
  const states = [...latest.values()].sort((a, b) => a.geo_code.localeCompare(b.geo_code));
  return { states, median: medianWithCount(states.map((s) => s.value)) };
}

/** One figure (say payday_avg_fee_per_loan) for every loaded state, with the median and its state count. */
export async function getPaydayAcrossStates(seriesKey: string) {
  if (!PAYDAY_SERIES.includes(seriesKey)) return { states: [], median: { median: null, count: 0 } };
  const rows = await sql<PaydayFigureRow[]>`
    SELECT geo_code, series_key, period, value::float8 AS value, unit
      FROM area_statistics
     WHERE source = ${PAYDAY_REPORTS_SOURCE} AND geo_type = 'state' AND series_key = ${seriesKey}
  `;
  return paydayAcrossStates([...rows]);
}
