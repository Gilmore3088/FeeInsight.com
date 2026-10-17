import { sql } from "./connection";

/**
 * Reads over the small business lending and payment volume series Magellan's
 * kcfed-sb-lending, fed-sbcs, fed-payments and nacha-volume steps load into area_statistics.
 * Server only; nothing here fetches from outside. Values stay in the publisher's units (the
 * `unit` says "count (millions)" or "dollars (billions)"); changes are computed only between
 * periods of the same series and unit, and a blank value yields no change, never a zero.
 *
 * Shaped for Hamilton questions: "how are community bank small business loan rates moving",
 * "how fast is FedNow / Same Day ACH growing", and "do small businesses rate credit unions and
 * small banks better than large banks".
 */

export const SMALLBIZ_SOURCES = ["kcfed-sb-lending", "fed-sbcs"] as const;
export const PAYMENT_SOURCES = ["fed-payments", "nacha-volume"] as const;

export interface SeriesRow {
  source: string;
  series_key: string;
  period: string;
  value: number | null;
  unit: string;
  note: string | null;
}

export interface SeriesChange {
  source: string;
  series_key: string;
  unit: string;
  period: string;
  value: number | null;
  note: string | null;
  prior_period: string | null;
  prior_value: number | null;
  change: number | null;
  change_pct: number | null;
  year_ago_period: string | null;
  year_ago_value: number | null;
  change_vs_year_ago: number | null;
  change_vs_year_ago_pct: number | null;
  /** Periods loaded for the series. */
  periods: number;
}

/** The period before: "2026Q1" -> "2025Q4", "2026-01" -> "2025-12", "2026" -> "2025". */
export function priorPeriod(period: string): string | null {
  let m = /^(\d{4})Q([1-4])$/.exec(period);
  if (m) return Number(m[2]) === 1 ? `${Number(m[1]) - 1}Q4` : `${m[1]}Q${Number(m[2]) - 1}`;
  m = /^(\d{4})-(\d{2})$/.exec(period);
  if (m) return Number(m[2]) === 1 ? `${Number(m[1]) - 1}-12` : `${m[1]}-${String(Number(m[2]) - 1).padStart(2, "0")}`;
  m = /^(\d{4})$/.exec(period);
  return m ? String(Number(m[1]) - 1) : null;
}

/** The same period a year earlier. */
export function yearAgoPeriod(period: string): string | null {
  const m = /^(\d{4})(.*)$/.exec(period);
  return m ? `${Number(m[1]) - 1}${m[2]}` : null;
}

const round = (v: number, places = 4) => Math.round(v * 10 ** places) / 10 ** places;

function diff(latest: number | null, earlier: number | null): { change: number | null; pct: number | null } {
  if (latest === null || earlier === null) return { change: null, pct: null };
  return { change: round(latest - earlier), pct: earlier === 0 ? null : round(((latest - earlier) / Math.abs(earlier)) * 100, 2) };
}

/**
 * Latest period per series with the change from the period just before and from a year earlier.
 * The prior period is the calendar one before (a gap in the file gives no change, not a change
 * across the gap); for an annual or triennial series with no row for the year before, the most
 * recent earlier period is used and named.
 */
export function seriesChanges(rows: SeriesRow[]): SeriesChange[] {
  const groups = new Map<string, SeriesRow[]>();
  for (const row of rows) {
    const key = `${row.source}|${row.series_key}|${row.unit}`;
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  const out: SeriesChange[] = [];
  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => b.period.localeCompare(a.period));
    const latest = sorted[0];
    const byPeriod = new Map(sorted.map((r) => [r.period, r]));
    const annual = /^\d{4}$/.test(latest.period);
    const priorKey = priorPeriod(latest.period);
    const prior = (priorKey ? byPeriod.get(priorKey) : undefined) ?? (annual ? sorted[1] : undefined) ?? null;
    const yearKey = yearAgoPeriod(latest.period);
    const yearAgo = (yearKey ? byPeriod.get(yearKey) : undefined) ?? null;
    const p = diff(latest.value, prior?.value ?? null);
    const y = diff(latest.value, yearAgo?.value ?? null);
    out.push({
      source: latest.source,
      series_key: latest.series_key,
      unit: latest.unit,
      period: latest.period,
      value: latest.value,
      note: latest.note,
      prior_period: prior?.period ?? null,
      prior_value: prior?.value ?? null,
      change: p.change,
      change_pct: p.pct,
      year_ago_period: yearAgo?.period ?? null,
      year_ago_value: yearAgo?.value ?? null,
      change_vs_year_ago: y.change,
      change_vs_year_ago_pct: y.pct,
      periods: list.length,
    });
  }
  return out.sort((a, b) => a.source.localeCompare(b.source) || a.series_key.localeCompare(b.series_key));
}

async function nationalSeries(sources: readonly string[], prefix: string | null): Promise<SeriesRow[]> {
  const rows = await sql<SeriesRow[]>`
    SELECT source, series_key, period, value::float8 AS value, unit, note
      FROM area_statistics
     WHERE source = ANY(${[...sources]}::text[])
       AND geo_type = 'nation' AND geo_code = 'US'
       AND (${prefix}::text IS NULL OR series_key LIKE ${`${prefix ?? ""}%`})
  `;
  return [...rows];
}

/** Kansas City Fed survey: each loan-rate and index series, latest quarter with quarter and year changes. */
export async function getSmallBusinessLendingConditions(): Promise<SeriesChange[]> {
  return seriesChanges(await nationalSeries(["kcfed-sb-lending"], null));
}

export interface PaymentRailTrend extends SeriesChange {
  /** fedach, fednow, fed_check, frps, nacha_ach_network, nacha_same_day_ach. */
  rail: string;
}

const RAILS = ["nacha_same_day_ach", "nacha_ach_network", "fed_check", "fedach", "fednow", "frps"];

export function railOf(seriesKey: string): string {
  return RAILS.find((r) => seriesKey === r || seriesKey.startsWith(`${r}_`)) ?? "other";
}

/** Payment volumes and values by rail, latest period with changes; `rail` narrows to one (e.g. "fednow"). */
export async function getPaymentVolumeTrends(rail: string | null = null): Promise<PaymentRailTrend[]> {
  const rows = await nationalSeries(PAYMENT_SOURCES, rail ? `${rail}_` : null);
  return seriesChanges(rows).map((c) => ({ ...c, rail: railOf(c.series_key) }));
}

// ---------------------------------------------------------------------------
// SBCS: lenders compared
// ---------------------------------------------------------------------------

export interface SbcsRow {
  geo_type: string;
  geo_code: string;
  period: string;
  value: number | null;
  unit: string;
  note: string | null;
  topic: string | null;
  metric_key: string | null;
  metric: string | null;
  lender_type: string | null;
}

export interface LenderComparison {
  geo_type: string;
  geo_code: string;
  /** SBCS report year. */
  period: string;
  topic: string | null;
  metric_key: string;
  metric: string | null;
  unit: string;
  by_lender: Record<string, number | null>;
  /** Lender types with a value, out of those listed. */
  lenders_with_value: number;
  /** Credit union minus large bank, in the metric's unit (percentage points when the unit is percent). */
  credit_union_vs_large_bank: number | null;
  small_bank_vs_large_bank: number | null;
  /** The publisher's flags on blank values, by lender. */
  notes: Record<string, string>;
}

/** One row per (area, year, topic, metric, unit) with every lender type side by side and the gaps to large banks. */
export function compareLenders(rows: SbcsRow[]): LenderComparison[] {
  const groups = new Map<string, SbcsRow[]>();
  for (const row of rows) {
    if (!row.metric_key || !row.lender_type) continue;
    const key = [row.geo_type, row.geo_code, row.period, row.topic, row.metric_key, row.unit].join("|");
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  const out: LenderComparison[] = [];
  for (const list of groups.values()) {
    const first = list[0];
    const byLender: Record<string, number | null> = {};
    const notes: Record<string, string> = {};
    for (const r of list) {
      byLender[r.lender_type!] = r.value;
      if (r.value === null && r.note) notes[r.lender_type!] = r.note;
    }
    const gap = (a: string) => {
      const x = byLender[a];
      const large = byLender.large_bank;
      return x === undefined || x === null || large === undefined || large === null ? null : round(x - large);
    };
    out.push({
      geo_type: first.geo_type,
      geo_code: first.geo_code,
      period: first.period,
      topic: first.topic,
      metric_key: first.metric_key!,
      metric: first.metric,
      unit: first.unit,
      by_lender: byLender,
      lenders_with_value: Object.values(byLender).filter((v) => v !== null).length,
      credit_union_vs_large_bank: gap("credit_union"),
      small_bank_vs_large_bank: gap("small_bank"),
      notes,
    });
  }
  return out.sort((a, b) => b.period.localeCompare(a.period) || String(a.topic).localeCompare(String(b.topic)) || a.metric_key.localeCompare(b.metric_key));
}

/**
 * SBCS lender comparison for one report year (default: the newest loaded for the area), the
 * nation by default or one state by postal code.
 */
export async function getSbcsLenderComparison(options: { year?: number | null; state?: string | null } = {}): Promise<LenderComparison[]> {
  const state = options.state?.trim().toUpperCase() || null;
  if (state && !/^[A-Z]{2}$/.test(state)) return [];
  const geoType = state ? "state" : "nation";
  const geoCode = state ?? "US";
  const year = options.year ? String(options.year) : null;
  const rows = await sql<SbcsRow[]>`
    WITH latest AS (
      SELECT COALESCE(${year}::text, MAX(period)) AS period
        FROM area_statistics
       WHERE source = 'fed-sbcs' AND geo_type = ${geoType} AND geo_code = ${geoCode}
    )
    SELECT a.geo_type, a.geo_code, a.period, a.value::float8 AS value, a.unit, a.note,
           a.raw_json->>'topic' AS topic, a.raw_json->>'metric_key' AS metric_key,
           a.raw_json->>'metric' AS metric, a.raw_json->>'lender_type' AS lender_type
      FROM area_statistics a, latest
     WHERE a.source = 'fed-sbcs' AND a.geo_type = ${geoType} AND a.geo_code = ${geoCode}
       AND a.period = latest.period
  `;
  return compareLenders([...rows]);
}
