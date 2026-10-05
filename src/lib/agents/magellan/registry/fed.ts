import { sql } from "@/lib/data-store/connection";
import type { RegistryFetchOptions } from "@/lib/regulatory/http";
import {
  BEIGE_BOOK_DISTRICTS,
  beigeBookPageUrl,
  blsSeriesUrl,
  fetchText,
  fredCsvUrl,
  isBlsSeries,
  isFredNativeSeries,
  parseBlsSeries,
  parseBeigeBookPage,
  parseFredCsv,
  REQUIRED_FRED_SERIES,
  type FredObservation,
} from "@/lib/regulatory/fed";
import { registryFetchJson } from "@/lib/regulatory/http";
import { chunk, mapWithConcurrency, recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry steps for Federal Reserve published data.
 *
 * registry-beige-book (partition = release code YYYYMM): the national summary
 * and 12 district reports, one row per section, into fed_beige_book.
 * registry-fred (partition "current"): refreshes every FRED-native series
 * already tracked in fed_economic_indicators (plus REQUIRED_FRED_SERIES) from the
 * keyless graph CSV, and the BLS CPI series (FRED lacks the detailed ones, such as
 * "checking account and other bank services") from the BLS public API.
 */

export const BEIGE_BOOK_SOURCE = "beige-book";
export const FRED_SOURCE = "fred";
export const FRED_PARTITION = "current";
export const BEIGE_BOOK_FIRST_YEAR = 2015;
const FED_CONCURRENCY = 3;
/** The Beige Book publishes 8 times a year, so some months have no release. */
const BEIGE_EMPTY_RETRY_HOURS = 24 * 3;
const BEIGE_PAST_EMPTY_RETRY_HOURS = 24 * 365;
const BEIGE_REFRESH_HOURS = 24 * 365;
const FRED_REFRESH_HOURS = 24;

interface FedOptions {
  now?: Date;
  runId?: number | null;
  dryRun?: boolean;
  db?: RegistryDb;
  fetchOptions?: RegistryFetchOptions;
}

export interface RegistryBeigeBookResult {
  source: string;
  partitionKey: string;
  releaseDate: string | null;
  pages: number;
  sections: number;
  dryRun: boolean;
  empty: boolean;
}

export async function runRegistryBeigeBook(options: FedOptions & { partitionKey: string }): Promise<RegistryBeigeBookResult> {
  const db = options.db ?? sql;
  const code = options.partitionKey;
  if (!/^\d{6}$/.test(code)) throw new Error(`Invalid Beige Book release partition: ${code}`);

  // The summary page decides whether this month had a release at all (one request when it did not).
  const summaryUrl = beigeBookPageUrl(code, "summary");
  const summaryHtml = await fetchText(summaryUrl, options.fetchOptions);
  const parts = summaryHtml ? BEIGE_BOOK_DISTRICTS : [];
  const districtPages = await mapWithConcurrency(parts, FED_CONCURRENCY, async (part) => {
    const url = beigeBookPageUrl(code, part.slug);
    const html = await fetchText(url, options.fetchOptions);
    return { ...part, district: part.district as number | null, url, page: html ? parseBeigeBookPage(html) : null };
  });
  const pages = summaryHtml
    ? [{ slug: "summary", district: null as number | null, url: summaryUrl, page: parseBeigeBookPage(summaryHtml) }, ...districtPages]
    : [];
  const found = pages.filter((p) => p.page && p.page.sections.length > 0);
  const releaseDate = found.find((p) => p.page?.releaseDate)?.page?.releaseDate ?? null;
  const rows = found.flatMap((p) =>
    (p.page?.sections ?? []).map((section) => ({
      fed_district: p.district,
      section_name: section.section_name,
      content_text: section.content_text,
      source_url: p.url,
    })),
  );
  const result: RegistryBeigeBookResult = {
    source: BEIGE_BOOK_SOURCE,
    partitionKey: code,
    releaseDate,
    pages: found.length,
    sections: rows.length,
    dryRun: Boolean(options.dryRun),
    empty: rows.length === 0,
  };
  if (options.dryRun) return result;

  if (rows.length > 0) {
    const payload = JSON.stringify(rows);
    await db`
      INSERT INTO fed_beige_book (release_date, release_code, fed_district, section_name, content_text, source_url, fetched_at)
      SELECT ${releaseDate ?? code}, ${code}, r.fed_district, r.section_name, r.content_text, r.source_url, NOW()
        FROM jsonb_to_recordset(${payload}::jsonb) AS r(fed_district integer, section_name text, content_text text, source_url text)
      ON CONFLICT (release_code, fed_district, section_name) DO UPDATE SET
        release_date = EXCLUDED.release_date,
        content_text = EXCLUDED.content_text,
        source_url = EXCLUDED.source_url,
        fetched_at = NOW()
    `;
  }
  await recordRegistryPartition(db, {
    source: BEIGE_BOOK_SOURCE,
    partitionKey: code,
    status: rows.length > 0 ? "succeeded" : "empty",
    rowCount: rows.length,
    insertedCount: rows.length,
    sourceUrl: beigeBookPageUrl(code, "summary"),
    runId: options.runId ?? null,
    nextAttemptAfterHours: rows.length > 0 ? BEIGE_REFRESH_HOURS : beigeEmptyRetryHours(code, options.now ?? new Date()),
    detail: { release_date: releaseDate, pages: found.length },
  });
  return result;
}

export interface RegistryFredResult {
  source: string;
  partitionKey: string;
  series: number;
  refreshedSeries: number;
  missingSeries: string[];
  observations: number;
  dryRun: boolean;
}

export async function runRegistryFred(options: FedOptions = {}): Promise<RegistryFredResult> {
  const db = options.db ?? sql;
  const tracked = await db<Array<{ series_id: string; series_title: string | null; fed_district: number | null; units: string | null; frequency: string | null }>>`
    SELECT DISTINCT ON (series_id) series_id, series_title, fed_district, units, frequency
      FROM fed_economic_indicators
     ORDER BY series_id, observation_date DESC
  `;
  const known = new Set(tracked.map((row) => row.series_id));
  const required = REQUIRED_FRED_SERIES.filter((meta) => !known.has(meta.series_id)).map((meta) => ({ ...meta, fed_district: null }));
  const series = [...tracked, ...required].filter((row) => isFredNativeSeries(row.series_id) || isBlsSeries(row.series_id));
  const result: RegistryFredResult = {
    source: FRED_SOURCE,
    partitionKey: FRED_PARTITION,
    series: series.length,
    refreshedSeries: 0,
    missingSeries: [],
    observations: 0,
    dryRun: Boolean(options.dryRun),
  };
  if (options.dryRun) return result;

  const blsKey = process.env.BLS_API_KEY || null;
  await mapWithConcurrency(series, FED_CONCURRENCY, async (meta) => {
    let observations: FredObservation[];
    if (isBlsSeries(meta.series_id)) {
      observations = parseBlsSeries(await registryFetchJson<unknown>(blsSeriesUrl(meta.series_id, blsKey), options.fetchOptions));
    } else {
      const csv = await fetchText(fredCsvUrl(meta.series_id), options.fetchOptions);
      observations = csv ? parseFredCsv(csv) : [];
    }
    if (observations.length === 0) {
      result.missingSeries.push(meta.series_id);
      return;
    }
    for (const group of chunk(observations, 2_000)) {
      const payload = JSON.stringify(group);
      await db`
        INSERT INTO fed_economic_indicators (series_id, series_title, fed_district, observation_date, value, units, frequency, fetched_at)
        SELECT ${meta.series_id}, ${meta.series_title}, ${meta.fed_district}, r.observation_date, r.value,
               ${meta.units}, ${meta.frequency}, NOW()
          FROM jsonb_to_recordset(${payload}::jsonb) AS r(observation_date text, value double precision)
        ON CONFLICT (series_id, observation_date) DO UPDATE SET
          value = EXCLUDED.value,
          fetched_at = NOW()
      `;
    }
    result.refreshedSeries += 1;
    result.observations += observations.length;
  });

  await recordRegistryPartition(db, {
    source: FRED_SOURCE,
    partitionKey: FRED_PARTITION,
    status: "succeeded",
    rowCount: result.series,
    matchedCount: result.refreshedSeries,
    unmatchedCount: result.missingSeries.length,
    insertedCount: result.observations,
    sourceUrl: "https://fred.stlouisfed.org/graph/fredgraph.csv",
    runId: options.runId ?? null,
    nextAttemptAfterHours: FRED_REFRESH_HOURS,
    detail: { missing_series: result.missingSeries.slice(0, 50) },
  });
  return result;
}

/** Candidate release codes: every month from 2015 through `now` (empty months are recorded and skipped). */
export function beigeBookCandidates(now: Date, firstYear = BEIGE_BOOK_FIRST_YEAR): string[] {
  const out: string[] = [];
  for (let year = now.getUTCFullYear(); year >= firstYear; year -= 1) {
    const lastMonth = year === now.getUTCFullYear() ? now.getUTCMonth() + 1 : 12;
    for (let month = lastMonth; month >= 1; month -= 1) out.push(`${year}${String(month).padStart(2, "0")}`);
  }
  return out;
}

/** Months already past with no release are not rechecked for a year; the current month is checked every few days. */
export function beigeEmptyRetryHours(code: string, now: Date): number {
  const year = Number(code.slice(0, 4));
  const month = Number(code.slice(4, 6));
  const monthsAgo = (now.getUTCFullYear() - year) * 12 + (now.getUTCMonth() + 1 - month);
  return monthsAgo >= 1 ? BEIGE_PAST_EMPTY_RETRY_HOURS : BEIGE_EMPTY_RETRY_HOURS;
}
