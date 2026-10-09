import { sql } from "@/lib/data-store/connection";
import type { RegistryFetchOptions } from "@/lib/regulatory/http";
import {
  BEIGE_BOOK_DISTRICTS,
  beigeBookPageUrl,
  BLS_SERIES_TITLES,
  blsSeriesRequest,
  fetchText,
  FOMC_CALENDAR_URL,
  fomcMinutesUrl,
  fredCsvUrl,
  isBlsSeries,
  isFredNativeSeries,
  parseBlsCatalogTitle,
  parseBlsSeries,
  parseBeigeBookPage,
  parseFomcMinutesDates,
  parseFomcMinutesPage,
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
 * registry-fomc-minutes (partition "current"): the full text of each FOMC meeting's
 * minutes linked from the FOMC calendar page, into fed_fomc_minutes.
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
  const required = REQUIRED_FRED_SERIES.filter((meta) => !known.has(meta.series_id));
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
  const blsCatalogTitles: Record<string, string> = {};
  await mapWithConcurrency(series, FED_CONCURRENCY, async (meta) => {
    let observations: FredObservation[];
    if (isBlsSeries(meta.series_id)) {
      const request = blsSeriesRequest(meta.series_id, blsKey);
      const body = await registryFetchJson<unknown>(request.url, options.fetchOptions, { json: request.json });
      observations = parseBlsSeries(body);
      const catalogTitle = parseBlsCatalogTitle(body);
      if (catalogTitle) blsCatalogTitles[meta.series_id] = catalogTitle;
    } else {
      const csv = await fetchText(fredCsvUrl(meta.series_id), options.fetchOptions);
      observations = csv ? parseFredCsv(csv) : [];
    }
    if (observations.length === 0) {
      result.missingSeries.push(meta.series_id);
      return;
    }
    const title = BLS_SERIES_TITLES[meta.series_id] ?? meta.series_title;
    for (const group of chunk(observations, 2_000)) {
      const payload = JSON.stringify(group);
      await db`
        INSERT INTO fed_economic_indicators (series_id, series_title, fed_district, observation_date, value, units, frequency, fetched_at)
        SELECT ${meta.series_id}, ${title}, ${meta.fed_district}, r.observation_date, r.value,
               ${meta.units}, ${meta.frequency}, NOW()
          FROM jsonb_to_recordset(${payload}::jsonb) AS r(observation_date text, value double precision)
        ON CONFLICT (series_id, observation_date) DO UPDATE SET
          value = EXCLUDED.value,
          series_title = EXCLUDED.series_title,
          fetched_at = NOW()
      `;
    }
    if (BLS_SERIES_TITLES[meta.series_id]) {
      // Observations older than the 7-year pull keep the label they were stored with; correct them too.
      await db`
        UPDATE fed_economic_indicators
           SET series_title = ${title}, units = ${meta.units}
         WHERE series_id = ${meta.series_id}
           AND (series_title IS DISTINCT FROM ${title} OR units IS DISTINCT FROM ${meta.units})
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
    detail: { missing_series: result.missingSeries.slice(0, 50), bls_catalog_titles: blsCatalogTitles },
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

export const FOMC_MINUTES_SOURCE = "fomc-minutes";
export const FOMC_MINUTES_PARTITION = "current";
const FOMC_REFRESH_HOURS = 24;
/** Minutes pulled per run; the calendar page links about five years, so the backfill takes a few days. */
const FOMC_MINUTES_PER_RUN = 8;
/** Pages shorter than this did not parse into minutes; they are counted, not stored. */
const FOMC_MIN_TEXT_LENGTH = 5_000;

export interface RegistryFomcMinutesResult {
  source: string;
  partitionKey: string;
  linked: number;
  alreadyStored: number;
  fetched: number;
  stored: number;
  tooShort: string[];
  remaining: number;
  dryRun: boolean;
}

export async function runRegistryFomcMinutes(options: FedOptions = {}): Promise<RegistryFomcMinutesResult> {
  const db = options.db ?? sql;
  const calendar = await fetchText(FOMC_CALENDAR_URL, options.fetchOptions);
  const linked = calendar ? parseFomcMinutesDates(calendar) : [];
  const storedRows = await db<Array<{ meeting_date: string }>>`
    SELECT to_char(meeting_date, 'YYYY-MM-DD') AS meeting_date FROM fed_fomc_minutes
  `;
  const stored = new Set(storedRows.map((row) => row.meeting_date));
  const missing = linked.filter((date) => !stored.has(date));
  const batch = missing.slice(0, FOMC_MINUTES_PER_RUN);
  const pages = await mapWithConcurrency(batch, FED_CONCURRENCY, async (meetingDate) => {
    const url = fomcMinutesUrl(meetingDate);
    const html = await fetchText(url, options.fetchOptions);
    return { meetingDate, url, page: html ? parseFomcMinutesPage(html) : null };
  });
  const rows = pages
    .filter((p) => p.page && p.page.text.length >= FOMC_MIN_TEXT_LENGTH)
    .map((p) => ({ meeting_date: p.meetingDate, title: p.page?.title ?? null, content_text: p.page?.text ?? "", source_url: p.url }));
  const tooShort = pages.filter((p) => !p.page || p.page.text.length < FOMC_MIN_TEXT_LENGTH).map((p) => p.meetingDate);
  const result: RegistryFomcMinutesResult = {
    source: FOMC_MINUTES_SOURCE,
    partitionKey: FOMC_MINUTES_PARTITION,
    linked: linked.length,
    alreadyStored: linked.length - missing.length,
    fetched: pages.length,
    stored: 0,
    tooShort,
    remaining: Math.max(0, missing.length - batch.length),
    dryRun: Boolean(options.dryRun),
  };
  if (options.dryRun) return result;

  if (rows.length > 0) {
    const payload = JSON.stringify(rows);
    const inserted = await db<Array<{ meeting_date: string }>>`
      INSERT INTO fed_fomc_minutes (meeting_date, title, content_text, source_url, fetched_at)
      SELECT r.meeting_date::date, r.title, r.content_text, r.source_url, NOW()
        FROM jsonb_to_recordset(${payload}::jsonb) AS r(meeting_date text, title text, content_text text, source_url text)
      ON CONFLICT (meeting_date) DO UPDATE SET
        title = EXCLUDED.title,
        content_text = EXCLUDED.content_text,
        source_url = EXCLUDED.source_url,
        fetched_at = NOW()
      RETURNING meeting_date
    `;
    result.stored = inserted.length;
  }
  await recordRegistryPartition(db, {
    source: FOMC_MINUTES_SOURCE,
    partitionKey: FOMC_MINUTES_PARTITION,
    status: linked.length > 0 ? "succeeded" : "empty",
    rowCount: linked.length,
    insertedCount: result.stored,
    sourceUrl: FOMC_CALENDAR_URL,
    runId: options.runId ?? null,
    // Come back sooner while the backfill is still going.
    nextAttemptAfterHours: result.remaining > 0 ? 2 : FOMC_REFRESH_HOURS,
    detail: { linked: linked.length, already_stored: result.alreadyStored, stored: result.stored, too_short: tooShort, remaining: result.remaining },
  });
  return result;
}
