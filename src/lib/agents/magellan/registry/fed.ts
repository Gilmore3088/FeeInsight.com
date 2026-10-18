import { sql } from "@/lib/data-store/connection";
import { STRUCK_FRED_SERIES } from "@/lib/data-store/struck-sources";
import type { RegistryFetchOptions } from "@/lib/regulatory/http";
import {
  BEIGE_BOOK_DISTRICTS,
  beigeBookPageUrl,
  BLS_SERIES_TITLES,
  fetchText,
  FOMC_CALENDAR_URL,
  fomcMinutesUrl,
  isBlsSeries,
  parseBeigeBookPage,
  parseFomcMinutesDates,
  parseFomcMinutesPage,
  type IndicatorObservation,
} from "@/lib/regulatory/fed";
import { fetchSdmxPackage, FRB_XML_PACKAGES } from "@/lib/regulatory/fed-board-data";
import {
  beaNipaUrl,
  blsBatchRequest,
  blsBatchSize,
  frbObservations,
  parseBeaNipaLine,
  parseBlsBatch,
  PUBLISHER_INDICATORS,
  type PublisherIndicator,
} from "@/lib/regulatory/federal-indicators";
import { registryFetchJson, RegistryHttpError } from "@/lib/regulatory/http";
import { BEA_KEY_ENV } from "./economy";
import { chunk, mapWithConcurrency, recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry steps for Federal Reserve published data.
 *
 * registry-beige-book (partition = release code YYYYMM): the national summary
 * and 12 district reports, one row per section, into fed_beige_book.
 * registry-fred (partition "current"; the step keeps its name): refreshes the economic
 * indicators in fed_economic_indicators, each from its original publisher (BLS, BEA, the
 * Federal Reserve Board; PUBLISHER_INDICATORS in regulatory/federal-indicators.ts). FRED is no
 * longer read (DECISIONS.md "No non-commercial data", 2026-10-18).
 * registry-fomc-minutes (partition "current"): the full text of each FOMC meeting's
 * minutes linked from the FOMC calendar page, into fed_fomc_minutes.
 */

export const BEIGE_BOOK_SOURCE = "beige-book";
/** Registry source key, kept from the FRED era so the step, schedule and run history stay joined. */
export const FRED_SOURCE = "fred";
/** v2: each series from its original publisher (BLS, BEA, Fed Board), not FRED (2026-10-18). */
export const FED_INDICATORS_PARSER_VERSION = 2;
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
  /**
   * Series readers still serve from their FRED-era rows: stored before the publisher cutover and
   * with no row from their publisher yet (each fetch so far failed). Reported as "still on
   * FRED-era values" until the first publisher row lands (fedIndicatorServedSql).
   */
  stillOnFredEra: string[];
  /** Fed Board packages not downloaded this run because the last download is recent enough (frbPackageDue). */
  skippedPackages: string[];
  observations: number;
  dryRun: boolean;
}

/** A Fed Board package is never downloaded twice within this many hours. */
export const FRB_PACKAGE_MIN_HOURS = 24;
/** ... and is downloaded at least this often (weekly), even when no new period is expected. */
export const FRB_PACKAGE_MAX_HOURS = 24 * 7;

/** The first day of the period before the one `now` is in: what a monthly or quarterly series should hold once published. */
export function expectedLatestPeriod(frequency: "monthly" | "quarterly", now: Date): string {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const start = frequency === "monthly" ? new Date(Date.UTC(year, month - 1, 1)) : new Date(Date.UTC(year, Math.floor(month / 3) * 3 - 3, 1));
  return start.toISOString().slice(0, 10);
}

/**
 * Whether to download a Fed Board package this run. The H.15 zip is tens of megabytes (the Board
 * lists about 68 MB) and FEDFUNDS is a monthly average published early the next month, so a
 * daily download is wasted: the package is fetched when it never has been, at most once a day
 * while a member series lacks the period just ended (so a new month lands within a day), and
 * otherwise once a week (to pick up any revision).
 */
export function frbPackageDue(
  lastFetchedAt: string | null,
  members: Array<{ latest: string | null; frequency: "monthly" | "quarterly" }>,
  now: Date,
): { due: boolean; reason: string } {
  if (!lastFetchedAt) return { due: true, reason: "never downloaded" };
  const last = Date.parse(lastFetchedAt);
  if (!Number.isFinite(last)) return { due: true, reason: "never downloaded" };
  const hours = (now.getTime() - last) / 3_600_000;
  if (hours < FRB_PACKAGE_MIN_HOURS) return { due: false, reason: "downloaded within the last day" };
  if (hours >= FRB_PACKAGE_MAX_HOURS) return { due: true, reason: "weekly refresh" };
  const behind = members.some((m) => !m.latest || m.latest < expectedLatestPeriod(m.frequency, now));
  return behind ? { due: true, reason: "a new period is due" } : { due: false, reason: "up to date; refreshed weekly" };
}

/** The series one publisher returned, by our series_id, with why any came back empty. */
interface PublisherPull {
  observations: Map<string, IndicatorObservation[]>;
  problems: Record<string, string>;
}

async function pullBls(series: PublisherIndicator[], options: FedOptions, catalogTitles: Record<string, string>): Promise<PublisherPull> {
  const out: PublisherPull = { observations: new Map(), problems: {} };
  const key = process.env.BLS_API_KEY || null;
  const ids = [...new Set(series.map((s) => s.publisher_id))];
  const byPublisherId = new Map<string, IndicatorObservation[]>();
  const idProblems: Record<string, string> = {};
  for (const batch of chunk(ids, blsBatchSize(key))) {
    const request = blsBatchRequest(batch, key, options.now);
    try {
      const body = await registryFetchJson<unknown>(request.url, options.fetchOptions, { json: request.json });
      const parsed = parseBlsBatch(body);
      for (const [id, obs] of parsed.bySeries) byPublisherId.set(id, obs);
      Object.assign(catalogTitles, parsed.catalogTitles);
      for (const id of batch) {
        if (!parsed.bySeries.has(id)) idProblems[id] = parsed.messages.find((m) => m.includes(id)) ?? parsed.messages[0] ?? "BLS returned no data";
      }
    } catch (error) {
      for (const id of batch) idProblems[id] = error instanceof Error ? error.message : String(error);
    }
  }
  for (const s of series) {
    const obs = byPublisherId.get(s.publisher_id);
    if (obs) out.observations.set(s.series_id, obs);
    else out.problems[s.series_id] = idProblems[s.publisher_id] ?? "BLS returned no data";
  }
  return out;
}

async function pullBea(series: PublisherIndicator[], options: FedOptions): Promise<PublisherPull> {
  const out: PublisherPull = { observations: new Map(), problems: {} };
  const key = process.env[BEA_KEY_ENV];
  if (!key) {
    for (const s of series) out.problems[s.series_id] = `${BEA_KEY_ENV} is not set`;
    return out;
  }
  const tables = new Map<string, unknown>();
  for (const s of series) {
    if (!s.bea) continue;
    const tableKey = `${s.bea.table}/${s.bea.frequency}`;
    try {
      if (!tables.has(tableKey)) {
        tables.set(tableKey, await registryFetchJson<unknown>(beaNipaUrl(key, s.bea.table, s.bea.frequency, options.now), options.fetchOptions));
      }
      const parsed = parseBeaNipaLine(tables.get(tableKey), s.bea.line, s.bea.scaleTo);
      if (parsed.observations.length > 0) out.observations.set(s.series_id, parsed.observations);
      else out.problems[s.series_id] = parsed.problem ?? "no values";
    } catch (error) {
      // The key travels in the URL: report the status only, never the URL.
      out.problems[s.series_id] = error instanceof RegistryHttpError && error.status ? `BEA HTTP ${error.status}` : "BEA request failed";
    }
  }
  return out;
}

interface FrbPull extends PublisherPull {
  /** Packages downloaded this run, with when. */
  fetched: Record<string, string>;
  /** Packages skipped this run (not due), whose members keep their stored rows. */
  skipped: string[];
  skippedSeries: Set<string>;
}

async function pullFrb(
  series: PublisherIndicator[],
  options: FedOptions,
  lastFetched: Record<string, string>,
  publisherLatest: Map<string, string>,
): Promise<FrbPull> {
  const out: FrbPull = { observations: new Map(), problems: {}, fetched: {}, skipped: [], skippedSeries: new Set() };
  const now = options.now ?? new Date();
  const byPackage = new Map<keyof typeof FRB_XML_PACKAGES, PublisherIndicator[]>();
  for (const s of series) if (s.frb) byPackage.set(s.frb.pkg, [...(byPackage.get(s.frb.pkg) ?? []), s]);
  for (const [pkg, members] of byPackage) {
    const due = frbPackageDue(
      lastFetched[pkg] ?? null,
      members.map((m) => ({ latest: publisherLatest.get(m.series_id) ?? null, frequency: m.frb?.frequency ?? "monthly" })),
      now,
    );
    if (!due.due) {
      out.skipped.push(`${pkg.toUpperCase()} (${due.reason})`);
      for (const m of members) out.skippedSeries.add(m.series_id);
      continue;
    }
    try {
      const { found } = await fetchSdmxPackage(FRB_XML_PACKAGES[pkg], members.map((m) => m.publisher_id), options.fetchOptions);
      for (const s of members) {
        const obs = frbObservations(found.get(s.publisher_id), s.frb?.frequency ?? "monthly");
        if (obs.length > 0) out.observations.set(s.series_id, obs);
        else out.problems[s.series_id] = found.has(s.publisher_id) ? "series had no values" : `${s.publisher_id} not in the ${pkg.toUpperCase()} package`;
      }
      out.fetched[pkg] = now.toISOString();
    } catch (error) {
      for (const s of members) out.problems[s.series_id] = error instanceof Error ? error.message : String(error);
    }
  }
  return out;
}

/**
 * Refreshes every indicator in PUBLISHER_INDICATORS from its original publisher (BLS, BEA, the
 * Federal Reserve Board), plus any other BLS CPI series already tracked. FRED is no longer read
 * (2026-10-18). The first run records `publisher_cutover_at` in the partition detail, and every
 * run records the series it loads (`publisher_series`). Readers apply the rule per series
 * (fedIndicatorServedSql): a series keeps showing its FRED-era rows until its publisher's first
 * row lands, then only rows written since the cutover; a series no publisher loads is hidden. No
 * row is deleted. Series still on FRED-era values are named in the step output.
 */
export async function runRegistryFred(options: FedOptions = {}): Promise<RegistryFredResult> {
  const db = options.db ?? sql;
  const tracked = await db<Array<{ series_id: string; series_title: string | null; fed_district: number | null; units: string | null }>>`
    SELECT DISTINCT ON (series_id) series_id, series_title, fed_district, units
      FROM fed_economic_indicators
     ORDER BY series_id, observation_date DESC
  `;
  const known = new Set(PUBLISHER_INDICATORS.map((s) => s.series_id));
  // BLS CPI series stored by earlier runs and not in the catalogue keep refreshing from BLS.
  const trackedBls: PublisherIndicator[] = tracked
    .filter((row) => isBlsSeries(row.series_id) && !known.has(row.series_id))
    .map((row) => ({
      series_id: row.series_id,
      publisher_id: row.series_id,
      series_title: BLS_SERIES_TITLES[row.series_id] ?? row.series_title ?? row.series_id,
      units: row.units ?? "Index",
      frequency: "Monthly" as const,
      fed_district: row.fed_district,
      publisher: "bls" as const,
    }));
  // Struck series (DECISIONS.md "No non-commercial data") are never fetched.
  const series = [...PUBLISHER_INDICATORS, ...trackedBls].filter((s) => !STRUCK_FRED_SERIES.includes(s.series_id));
  const result: RegistryFredResult = {
    source: FRED_SOURCE,
    partitionKey: FRED_PARTITION,
    series: series.length,
    refreshedSeries: 0,
    missingSeries: [],
    stillOnFredEra: [],
    skippedPackages: [],
    observations: 0,
    dryRun: Boolean(options.dryRun),
  };
  if (options.dryRun) return result;

  // The cutover is fixed by the first publisher run and carried forward on every later one.
  const previous = await db<Array<{ cutover: string | null; frb_fetched: Record<string, string> | null }>>`
    SELECT detail->>'publisher_cutover_at' AS cutover, detail->'frb_package_fetched_at' AS frb_fetched
      FROM registry_ingest_partitions
     WHERE source = ${FRED_SOURCE} AND partition_key = ${FRED_PARTITION}
  `;
  let cutover = previous[0]?.cutover ?? null;
  const lastFrbFetched: Record<string, string> = { ...(previous[0]?.frb_fetched ?? {}) };
  // Each series' latest observation written by its publisher since the cutover (none on the first run).
  const publisherLatest = new Map<string, string>();
  if (cutover) {
    const rows = await db<Array<{ series_id: string; latest: string | null }>>`
      SELECT series_id, MAX(observation_date)::text AS latest
        FROM fed_economic_indicators
       WHERE fetched_at >= ${cutover}::timestamptz
       GROUP BY series_id
    `;
    for (const row of rows) publisherLatest.set(row.series_id, String(row.latest ?? "").slice(0, 10));
  } else {
    const [row] = await db<Array<{ now: Date | string }>>`SELECT NOW() AS now`;
    cutover = row?.now instanceof Date ? row.now.toISOString() : String(row?.now ?? new Date().toISOString());
  }

  const catalogTitles: Record<string, string> = {};
  const frbPull = pullFrb(series.filter((s) => s.publisher === "frb"), options, lastFrbFetched, publisherLatest);
  const pulls = await Promise.all([
    pullBls(series.filter((s) => s.publisher === "bls"), options, catalogTitles),
    pullBea(series.filter((s) => s.publisher === "bea"), options),
    frbPull,
  ]);
  const frb = await frbPull;
  result.skippedPackages = frb.skipped;
  const observationsById = new Map<string, IndicatorObservation[]>();
  const problems: Record<string, string> = {};
  for (const pull of pulls) {
    for (const [id, obs] of pull.observations) observationsById.set(id, obs);
    Object.assign(problems, pull.problems);
  }

  const perPublisher: Record<string, { series: number; refreshed: number }> = {};
  await mapWithConcurrency(series, FED_CONCURRENCY, async (meta) => {
    const counts = (perPublisher[meta.publisher] ??= { series: 0, refreshed: 0 });
    counts.series += 1;
    const observations = observationsById.get(meta.series_id) ?? [];
    // Not downloaded this run on purpose (package not due): the stored publisher rows stand.
    if (observations.length === 0 && frb.skippedSeries.has(meta.series_id)) return;
    if (observations.length === 0) {
      result.missingSeries.push(`${meta.series_id} (${meta.publisher}: ${problems[meta.series_id] ?? "no values"})`);
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
          series_title = EXCLUDED.series_title,
          units = EXCLUDED.units,
          frequency = EXCLUDED.frequency,
          fetched_at = NOW()
      `;
    }
    // Observations older than the pull window keep the label they were stored with; correct them too.
    await db`
      UPDATE fed_economic_indicators
         SET series_title = ${meta.series_title}, units = ${meta.units}
       WHERE series_id = ${meta.series_id}
         AND (series_title IS DISTINCT FROM ${meta.series_title} OR units IS DISTINCT FROM ${meta.units})
    `;
    counts.refreshed += 1;
    result.refreshedSeries += 1;
    result.observations += observations.length;
    publisherLatest.set(meta.series_id, observations.reduce((max, o) => (o.observation_date > max ? o.observation_date : max), ""));
  });
  result.missingSeries.sort();
  // Stored series with no publisher row yet: readers still serve their FRED-era values.
  const stored = new Set(tracked.map((row) => row.series_id));
  result.stillOnFredEra = series
    .map((s) => s.series_id)
    .filter((id) => stored.has(id) && !publisherLatest.has(id))
    .sort();

  await recordRegistryPartition(db, {
    source: FRED_SOURCE,
    partitionKey: FRED_PARTITION,
    status: "succeeded",
    rowCount: result.series,
    matchedCount: result.refreshedSeries,
    unmatchedCount: result.missingSeries.length,
    insertedCount: result.observations,
    sourceUrl: null,
    runId: options.runId ?? null,
    nextAttemptAfterHours: FRED_REFRESH_HOURS,
    detail: {
      parser_version: FED_INDICATORS_PARSER_VERSION,
      publisher_cutover_at: cutover,
      publishers: perPublisher,
      missing_series: result.missingSeries.slice(0, 80),
      still_on_fred_era_values: result.stillOnFredEra,
      publisher_series: series.map((s) => s.series_id),
      frb_package_fetched_at: { ...lastFrbFetched, ...frb.fetched },
      frb_packages_skipped: frb.skipped,
      bls_catalog_titles: catalogTitles,
    },
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
