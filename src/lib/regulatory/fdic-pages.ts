import { extractText, getDocumentProxy } from "unpdf";
import { STATE_NAMES } from "@/lib/us-states";
import type { AreaFetch, AreaStat } from "./economy";
import { registryFetch, RegistryHttpError, type RegistryFetchOptions } from "./http";
import { extractLinks, extractTables } from "./payment-networks";

/**
 * Two FDIC sources read from www.fdic.gov pages, because neither has a CSV or API (#1867).
 * Pure: fetches and parses, never writes. Both are US government works; cite the FDIC.
 *
 * - National Rates and Rate Caps: the current page and every monthly page it links from
 *   "Previous Rates" hold one HTML table (deposit product x national rate, rate-cap-adjusted rate,
 *   Treasury yield, rate-cap-adjusted yield, national rate cap) under "Monthly Rate Cap Information
 *   as of <date>". Checked live on 2026-11-02: the current page (October 19, 2026) and 31 monthly
 *   pages back to 2024. Older months are only in archive workbooks and are not read yet.
 * - National Survey of Unbanked and Underbanked Households: the state and national rates are
 *   published in the survey's appendix tables PDF (table G.2, "Fully Banked, Underbanked, and
 *   Unbanked Rates by State"), not in a data file; the downloads page offers household-level
 *   microdata only. Checked live on 2026-11-02 for 2023 (pages 73-74). Earlier years' appendix
 *   tables are not at the same address (2019 and 2021 answer 404). The MSA table (G.3) names metros
 *   but gives no CBSA code, so it is not read; nothing is matched by name.
 *
 * A value the FDIC suppressed ("–") is stored as null with that flag, never as zero.
 */

export const FDIC_WWW = "https://www.fdic.gov";
export const FDIC_NATIONAL_RATES_URL = `${FDIC_WWW}/national-rates-and-rate-caps`;
export const FDIC_NATIONAL_RATES_PREVIOUS_URL = `${FDIC_NATIONAL_RATES_URL}/national-rates-and-rate-caps-previous-rates`;
/** Stop after this many monthly pages even if the index links more (31 on 2026-11-02). */
export const FDIC_NATIONAL_RATES_MAX_PAGES = 120;

export function fdicSurveyAppendixUrl(year: number): string {
  return `${FDIC_WWW}/household-survey/${year}-fdic-national-survey-unbanked-and-underbanked-households-appendix-tables`;
}

function emptyFetch(url: string | null, reason: string, missingFields: string[] = []): AreaFetch {
  return { url, rows: [], missingFields, skipped: {}, emptyReason: reason };
}

function bump(counts: Record<string, number>, key: string) {
  counts[key] = (counts[key] ?? 0) + 1;
}

/** "4.63", "5.00." (a footnote mark after the number) -> number; "–", "" -> null. */
export function fdicNumber(value: string | null | undefined): number | null {
  const raw = (value ?? "").trim().replace(/,/g, "").replace(/\.$/, "");
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function suppressedFlag(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  return raw !== "" && fdicNumber(raw) === null ? raw.slice(0, 40) : "blank";
}

// ---------------------------------------------------------------------------------------------
// National Rates and Rate Caps
// ---------------------------------------------------------------------------------------------

const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** "Monthly Rate Cap Information as of October 19, 2026" -> "2026-10-19"; null when absent. */
export function rateCapAsOf(html: string): string | null {
  const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  const m = /Rate Cap Information as of ([A-Za-z]+) (\d{1,2}), (\d{4})/i.exec(text);
  if (!m) return null;
  const month = MONTH_NAMES.indexOf(m[1].toLowerCase());
  if (month < 0) return null;
  return `${m[3]}-${String(month + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

/** The table's columns, matched on the header text (footnote marks removed). */
const RATE_COLUMNS = [
  { match: /^national deposit rates$/i, series: "national_rate" },
  { match: /^national deposit rates\s*rate cap adjusted$/i, series: "national_rate_cap_adjusted" },
  { match: /^treasury yield$/i, series: "treasury_yield" },
  { match: /^treasury yield\s*rate cap adjusted$/i, series: "treasury_yield_cap_adjusted" },
  { match: /^national rate cap$/i, series: "national_rate_cap" },
] as const;

export function productSlug(product: string): string {
  return product
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

/** Footnote links sit inside header and value cells ("5.00.<sup>4</sup>"); drop them before reading. */
function withoutFootnotes(html: string): string {
  return html.replace(/<span class="footnote__citations-wrapper">[\s\S]*?<\/span>/gi, "").replace(/<sup\b[\s\S]*?<\/sup>/gi, "");
}

/**
 * One monthly rate cap page: series `fdic_national_rate_<column>_<product>` (e.g.
 * `fdic_national_rate_national_rate_cap_12_month_cd`), period YYYY-MM of the as-of date.
 */
export function parseFdicRatePage(html: string, url: string): AreaFetch {
  const asOf = rateCapAsOf(html);
  if (!asOf) return emptyFetch(url, "Page has no \"Rate Cap Information as of <date>\" line", ["as-of date"]);
  const table = extractTables(withoutFootnotes(html)).find((t) => /deposit products/i.test(t.headers[0] ?? ""));
  if (!table) return emptyFetch(url, "Page has no table headed \"Deposit Products\"", ["rate table"]);
  const columns = RATE_COLUMNS.map((c) => ({ ...c, index: table.headers.findIndex((h) => c.match.test(h.trim())) }));
  const missing = columns.filter((c) => c.index < 0).map((c) => c.series);
  const skipped: Record<string, number> = {};
  const rows: AreaStat[] = [];
  const period = asOf.slice(0, 7);
  for (const cells of table.rows) {
    const product = (cells[0] ?? "").trim();
    if (!product) {
      bump(skipped, "no_product");
      continue;
    }
    for (const col of columns) {
      if (col.index < 0) continue;
      const cell = cells[col.index] ?? null;
      const value = fdicNumber(cell);
      rows.push({
        source_url: url,
        geo_type: "nation",
        geo_code: "US",
        geo_name: "United States",
        state_code: null,
        period,
        series_key: `fdic_national_rate_${col.series}_${productSlug(product)}`,
        value,
        unit: "percent",
        note: value === null ? suppressedFlag(cell) : null,
        raw: { as_of: asOf, product, column: table.headers[col.index], cell },
      });
    }
  }
  return { url, rows, missingFields: missing, skipped, emptyReason: rows.length === 0 ? "Rate table held no products" : null };
}

/** Monthly rate cap pages linked from the Previous Rates page, de-duplicated, as absolute URLs. */
export function fdicRatePageLinks(previousHtml: string): string[] {
  const out = new Set<string>();
  for (const link of extractLinks(previousHtml, FDIC_NATIONAL_RATES_PREVIOUS_URL)) {
    const url = link.href.replace(/[?#].*$/, "");
    if (/\/national-rates-and-rate-caps-[a-z]+-\d{4}$/.test(url) && url.startsWith(FDIC_WWW)) out.add(url);
  }
  return [...out];
}

/** The current page plus every monthly page Previous Rates links; a month read twice keeps the first. */
export async function fetchFdicNationalRates(options: RegistryFetchOptions = {}): Promise<AreaFetch> {
  const current = await (await registryFetch(FDIC_NATIONAL_RATES_URL, options)).text();
  const previous = await (await registryFetch(FDIC_NATIONAL_RATES_PREVIOUS_URL, options)).text();
  const links = fdicRatePageLinks(previous);
  const pages: Array<{ url: string; html: string }> = [{ url: FDIC_NATIONAL_RATES_URL, html: current }];
  const unavailable: Array<{ key: string; reason: string }> = [];
  for (const url of links.slice(0, FDIC_NATIONAL_RATES_MAX_PAGES)) {
    try {
      pages.push({ url, html: await (await registryFetch(url, options)).text() });
    } catch (error) {
      if (!(error instanceof RegistryHttpError) || error.status !== 404) throw error;
      unavailable.push({ key: url, reason: "404" });
    }
  }
  const seenPeriods = new Set<string>();
  const rows: AreaStat[] = [];
  const skipped: Record<string, number> = {};
  const missing = new Set<string>();
  for (const page of pages) {
    const parsed = parseFdicRatePage(page.html, page.url);
    parsed.missingFields.forEach((m) => missing.add(m));
    for (const [k, n] of Object.entries(parsed.skipped)) skipped[k] = (skipped[k] ?? 0) + n;
    if (parsed.emptyReason) {
      unavailable.push({ key: page.url, reason: parsed.emptyReason });
      continue;
    }
    const period = parsed.rows[0].period;
    if (seenPeriods.has(period)) {
      bump(skipped, "month_already_read");
      continue;
    }
    seenPeriods.add(period);
    rows.push(...parsed.rows);
  }
  return {
    url: FDIC_NATIONAL_RATES_URL,
    rows,
    missingFields: [...missing],
    skipped,
    unavailableParts: unavailable,
    emptyReason: rows.length === 0 ? "No rate cap page could be read" : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Household survey appendix table G.2 (state rates)
// ---------------------------------------------------------------------------------------------

const STATE_CODES = new Set([...Object.keys(STATE_NAMES), "DC"]);

/**
 * Table G.2 from the appendix text, page by page. A data line is "<geography> <households (1000s)>
 * <percent of households> <fully banked> <underbanked> <unbanked>"; geography is "All" (the
 * nation) or a state postal code.
 */
export function parseFdicSurveyStateTable(pages: string[], year: number, url: string): AreaFetch {
  const tablePages = pages.filter((p) => /(^|\n)G\.2 Fully Banked, Underbanked, and Unbanked Rates by State/.test(p) && !/\.{5,}/.test(p));
  if (tablePages.length === 0) return emptyFetch(url, "Appendix tables have no table G.2 (rates by state)", ["table G.2"]);
  const skipped: Record<string, number> = {};
  const rows: AreaStat[] = [];
  const seen = new Set<string>();
  const cell = String.raw`(\d[\d,]*(?:\.\d+)?|–|-)`;
  const line = new RegExp(String.raw`^(All|[A-Z]{2})\s+${cell}\s+${cell}\s+${cell}\s+${cell}\s+${cell}\s*$`);
  for (const page of tablePages) {
    for (const textLine of page.split("\n")) {
      const m = line.exec(textLine.trim());
      if (!m) continue;
      const code = m[1] === "All" ? "US" : m[1];
      if (code !== "US" && !STATE_CODES.has(code)) {
        bump(skipped, "unknown_state_code");
        continue;
      }
      if (seen.has(code)) {
        bump(skipped, "duplicate_geography");
        continue;
      }
      seen.add(code);
      const geo = code === "US" ? { geo_type: "nation" as const, geo_code: "US", geo_name: "United States", state_code: null } : { geo_type: "state" as const, geo_code: code, geo_name: code, state_code: code };
      const series = [
        { key: "fdic_fully_banked_share", cell: m[4] },
        { key: "fdic_underbanked_share", cell: m[5] },
        { key: "fdic_unbanked_share", cell: m[6] },
      ];
      for (const s of series) {
        const value = fdicNumber(s.cell);
        rows.push({
          source_url: url,
          ...geo,
          period: String(year),
          series_key: s.key,
          value,
          unit: "percent of households",
          note: value === null ? suppressedFlag(s.cell) : null,
          raw: { table: "G.2", households_thousands: m[2], line: textLine.trim() },
        });
      }
      const households = fdicNumber(m[2]);
      rows.push({ source_url: url, ...geo, period: String(year), series_key: "fdic_survey_households_thousands", value: households, unit: "households (1000s)", note: households === null ? suppressedFlag(m[2]) : null, raw: { table: "G.2", line: textLine.trim() } });
    }
  }
  const states = [...seen].filter((c) => c !== "US").length;
  const missing = [...(seen.has("US") ? [] : ["All (national) row"]), ...(states < 51 ? [`${51 - states} of 51 state rows`] : [])];
  return { url, rows, missingFields: missing, skipped, emptyReason: rows.length === 0 ? "Table G.2 held no readable rows" : null };
}

export async function pdfPages(bytes: ArrayBuffer): Promise<string[]> {
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: false });
  return text;
}

export async function fetchFdicSurveyAppendix(year: number, options: RegistryFetchOptions = {}): Promise<AreaFetch> {
  const url = fdicSurveyAppendixUrl(year);
  let response: Response;
  try {
    response = await registryFetch(url, options);
  } catch (error) {
    if (error instanceof RegistryHttpError && error.status === 404) return emptyFetch(url, `No ${year} appendix tables at ${url}`);
    throw error;
  }
  const bytes = await response.arrayBuffer();
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") return emptyFetch(url, `${url} did not return a PDF`, ["appendix PDF"]);
  return parseFdicSurveyStateTable(await pdfPages(bytes), year, url);
}
