import { FHLB_BANKS } from "@/lib/regulatory/fhlb-advance-rates";
import { sql } from "@/lib/data-store/connection";

/**
 * Reads over FHLBank posted advance rates (area_statistics, source 'fhlb-advance-rates', nation
 * rows, series fhlb_<bank>_<product>_<term>, period = posted date). Server only.
 *
 * Shaped for funding questions a pricing committee asks: "what does a 1-year advance cost from
 * my FHLBank today, and how has it moved?" and "how do the eleven banks compare at one term?".
 * A bank's product names are its own (Classic, Fixed Rate, Amortizing...), so products are never
 * pooled across banks by name; the cross-bank view takes each bank's lowest posted percent rate at
 * the term and says which product it came from. Every median carries its bank count.
 */

export const FHLB_RATES_SOURCE = "fhlb-advance-rates";
/** Fewer banks than this posting a term gives no cross-bank median. */
export const MIN_BANKS_FOR_MEDIAN = 3;

const BANK_KEYS = FHLB_BANKS.map((b) => b.key.replace(/-/g, "_")).sort((a, b) => b.length - a.length);

export interface FhlbSeriesParts {
  bank: string;
  product: string;
  term: string;
}

/** Splits fhlb_<bank>_<product>_<term>; bank keys with underscores (des_moines) are matched whole. */
export function parseFhlbSeriesKey(seriesKey: string): FhlbSeriesParts | null {
  if (!seriesKey.startsWith("fhlb_")) return null;
  const rest = seriesKey.slice(5);
  const bank = BANK_KEYS.find((b) => rest.startsWith(`${b}_`));
  if (!bank) return null;
  const tail = rest.slice(bank.length + 1);
  const m = /^(.+?)_(overnight|\d+(?:_\d+)?[dwmy])$/.exec(tail);
  if (!m) return null;
  return { bank: bank.replace(/_/g, "-"), product: m[1], term: m[2] };
}

/** Term length in days for sorting a curve (1m = 30, 1y = 365); null for an unreadable term. */
export function termDays(term: string): number | null {
  if (term === "overnight") return 1;
  const m = /^(\d+)(?:_(\d+))?([dwmy])$/.exec(term);
  if (!m) return null;
  const n = Number(`${m[1]}${m[2] ? `.${m[2]}` : ""}`);
  return Math.round(n * { d: 1, w: 7, m: 30, y: 365 }[m[3] as "d" | "w" | "m" | "y"]);
}

export function medianWithCount(values: number[]): { median: number | null; count: number } {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length < MIN_BANKS_FOR_MEDIAN) return { median: null, count: sorted.length };
  const mid = Math.floor(sorted.length / 2);
  return { median: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2, count: sorted.length };
}

export interface FhlbRate {
  bank: string;
  bank_name: string | null;
  product: string;
  product_label: string | null;
  term: string;
  term_label: string | null;
  posted_date: string;
  value: number | null;
  unit: string;
  note: string | null;
  source_url: string | null;
}

interface RateRow {
  series_key: string;
  geo_name: string | null;
  period: string;
  value: number | null;
  unit: string;
  note: string | null;
  source_url: string | null;
  product_label: string | null;
  term_label: string | null;
}

function toRate(row: RateRow): FhlbRate | null {
  const parts = parseFhlbSeriesKey(row.series_key);
  if (!parts) return null;
  return {
    ...parts,
    bank_name: row.geo_name,
    product_label: row.product_label,
    term_label: row.term_label,
    posted_date: row.period,
    value: row.value === null ? null : Number(row.value),
    unit: row.unit,
    note: row.note,
    source_url: row.source_url,
  };
}

/** One bank's latest posted sheet (every product and term on its newest posted date), shortest term first. */
export async function getLatestFhlbRateSheet(bankKey: string): Promise<{ posted_date: string | null; rates: FhlbRate[] }> {
  const prefix = `fhlb_${bankKey.replace(/-/g, "_")}_`;
  const rows = await sql<RateRow[]>`
    WITH latest AS (
      SELECT MAX(period) AS period FROM area_statistics
       WHERE source = ${FHLB_RATES_SOURCE} AND geo_type = 'nation' AND series_key LIKE ${`${prefix}%`}
    )
    SELECT a.series_key, a.geo_name, a.period, a.value, a.unit, a.note, a.source_url,
           a.raw_json->>'product_label' AS product_label, a.raw_json->>'term_label' AS term_label
      FROM area_statistics a JOIN latest l ON a.period = l.period
     WHERE a.source = ${FHLB_RATES_SOURCE} AND a.geo_type = 'nation' AND a.series_key LIKE ${`${prefix}%`}
  `;
  const rates = [...rows].map(toRate).filter((r): r is FhlbRate => r !== null && r.bank === bankKey);
  rates.sort((a, b) => (termDays(a.term) ?? 1e9) - (termDays(b.term) ?? 1e9) || a.product.localeCompare(b.product));
  return { posted_date: rates[0]?.posted_date ?? null, rates };
}

export interface FhlbRateMove {
  series_key: string;
  latest_date: string;
  latest_value: number;
  prior_date: string | null;
  prior_value: number | null;
  change: number | null;
}

/**
 * One series now vs its last posting on or before `days` days earlier. No prior posting in the
 * table means no change figure, never a zero.
 */
export async function getFhlbRateMove(seriesKey: string, days: number): Promise<FhlbRateMove | null> {
  const rows = await sql<Array<{ period: string; value: number | null }>>`
    SELECT period, value FROM area_statistics
     WHERE source = ${FHLB_RATES_SOURCE} AND geo_type = 'nation' AND series_key = ${seriesKey} AND value IS NOT NULL
     ORDER BY period DESC
  `;
  return rateMove(seriesKey, [...rows].map((r) => ({ period: r.period, value: Number(r.value) })), days);
}

/** Pure: newest posting vs the newest one at least `days` older. */
export function rateMove(seriesKey: string, newestFirst: Array<{ period: string; value: number }>, days: number): FhlbRateMove | null {
  const latest = newestFirst[0];
  if (!latest) return null;
  const cutoff = new Date(Date.parse(`${latest.period}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
  const prior = newestFirst.find((r) => r.period <= cutoff) ?? null;
  return {
    series_key: seriesKey,
    latest_date: latest.period,
    latest_value: latest.value,
    prior_date: prior?.period ?? null,
    prior_value: prior?.value ?? null,
    change: prior ? Number((latest.value - prior.value).toFixed(4)) : null,
  };
}

export interface FhlbTermComparison {
  term: string;
  banks: Array<{ bank: string; bank_name: string | null; posted_date: string; lowest_rate: number; product: string; product_label: string | null }>;
  median: number | null;
  /** Banks behind the median. */
  bank_count: number;
}

/**
 * Every bank's lowest posted percent rate at one term on its own latest posted date, with the
 * cross-bank median. Basis-point spreads are left out (they are not rates).
 */
export async function compareFhlbBanksAtTerm(term: string): Promise<FhlbTermComparison> {
  const rows = await sql<RateRow[]>`
    WITH per_bank AS (
      SELECT a.*, MAX(a.period) OVER (PARTITION BY a.raw_json->>'fhlbank') AS latest
        FROM area_statistics a
       WHERE a.source = ${FHLB_RATES_SOURCE} AND a.geo_type = 'nation' AND a.unit = 'percent'
         AND a.value IS NOT NULL AND a.series_key LIKE ${`%\\_${term}`}
    )
    SELECT series_key, geo_name, period, value, unit, note, source_url,
           raw_json->>'product_label' AS product_label, raw_json->>'term_label' AS term_label
      FROM per_bank WHERE period = latest
  `;
  return lowestPerBank(term, [...rows].map(toRate).filter((r): r is FhlbRate => r !== null && r.term === term));
}

/** Pure: lowest rate per bank and the median across banks. */
export function lowestPerBank(term: string, rates: FhlbRate[]): FhlbTermComparison {
  const best = new Map<string, FhlbRate>();
  for (const r of rates) {
    if (r.value === null || r.unit !== "percent") continue;
    const cur = best.get(r.bank);
    if (!cur || r.value < (cur.value ?? Infinity)) best.set(r.bank, r);
  }
  const banks = [...best.values()]
    .map((r) => ({ bank: r.bank, bank_name: r.bank_name, posted_date: r.posted_date, lowest_rate: r.value as number, product: r.product, product_label: r.product_label }))
    .sort((a, b) => a.lowest_rate - b.lowest_rate);
  const { median, count } = medianWithCount(banks.map((b) => b.lowest_rate));
  return { term, banks, median, bank_count: count };
}

/** Which banks have posted rates, and when last; banks never loaded are listed with null. */
export async function getFhlbRateCoverage(): Promise<Array<{ bank: string; bank_name: string; latest_posted: string | null; series: number }>> {
  const rows = await sql<Array<{ bank: string; latest_posted: string; series: number }>>`
    SELECT raw_json->>'fhlbank' AS bank, MAX(period) AS latest_posted, COUNT(DISTINCT series_key)::int AS series
      FROM area_statistics
     WHERE source = ${FHLB_RATES_SOURCE} AND geo_type = 'nation'
     GROUP BY 1
  `;
  const byBank = new Map([...rows].map((r) => [r.bank, r]));
  return FHLB_BANKS.map((b) => ({ bank: b.key, bank_name: b.name, latest_posted: byBank.get(b.key)?.latest_posted ?? null, series: byBank.get(b.key)?.series ?? 0 }));
}
