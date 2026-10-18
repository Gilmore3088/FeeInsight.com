import { sql } from "./connection";
import { STRUCK_SOURCE_URL_PATTERN } from "./struck-sources";

/**
 * Reads over the payment volume series Magellan's fed-payments step loads into area_statistics
 * (the Federal Reserve Board's FedACH commercial table and Payments Study). Server only; nothing
 * here fetches from outside. Values stay in the publisher's units (the `unit` says "count
 * (millions)" or "dollars (billions)"); changes are computed only between periods of the same
 * series and unit, and a blank value yields no change, never a zero.
 *
 * The KC Fed lending survey, Fed Small Business Credit Survey, Nacha and frbservices.org (FedNow,
 * Fed check and the old FedACH page) series were struck on 2026-10-17 (DECISIONS.md "No
 * non-commercial data"). Rows already loaded stay in the table, so this reader names its source,
 * its rails and excludes rows read from frbservices.org.
 */

export const PAYMENT_SOURCES = ["fed-payments"] as const;

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
       AND COALESCE(source_url, '') NOT ILIKE ${STRUCK_SOURCE_URL_PATTERN}
  `;
  return [...rows];
}

export interface PaymentRailTrend extends SeriesChange {
  /** fedach or frps. */
  rail: string;
}

const RAILS = ["fedach", "frps"];

export function railOf(seriesKey: string): string {
  return RAILS.find((r) => seriesKey === r || seriesKey.startsWith(`${r}_`)) ?? "other";
}

/** Payment volumes and values by rail, latest period with changes; `rail` narrows to one (e.g. "fedach"). */
export async function getPaymentVolumeTrends(rail: string | null = null): Promise<PaymentRailTrend[]> {
  if (rail !== null && !RAILS.includes(rail)) return [];
  // Struck rails (fednow_, fed_check_) have no rail here, so their rows are never returned.
  const rows = (await nationalSeries(PAYMENT_SOURCES, rail ? `${rail}_` : null)).filter((r) => railOf(r.series_key) !== "other");
  return seriesChanges(rows).map((c) => ({ ...c, rail: railOf(c.series_key) }));
}
