import { sql } from "@/lib/data-store/connection";
import { checkAreaStats, dedupeAreaStats } from "@/lib/regulatory/economy";
import { registryFetch, RegistryHttpError, type RegistryFetchOptions } from "@/lib/regulatory/http";
import {
  findPaydayReportLink,
  parsePaydayPartition,
  paydayFetch,
  paydayPartitionKeys,
  paydayPdfText,
  readPaydayFigures,
} from "@/lib/regulatory/payday-reports";
import { upsertAreaStats } from "./economy";
import { recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry step: one state regulator's payday / small-dollar annual report per
 * partition (`<STATE>-<year>`), labelled figures into area_statistics by state and year.
 * A year not published yet is recorded empty and retried monthly; a report whose figures
 * cannot be read without ambiguity is recorded empty with each metric's reason.
 */

export const PAYDAY_REPORTS_SOURCE = "state-payday-reports";
export const PAYDAY_REPORTS_PARSER_VERSION = 1;
const HOURS = { day: 24, month: 24 * 30, year: 24 * 365 };

export function paydayReportsPartitions(now: Date): string[] {
  return paydayPartitionKeys(now);
}

export interface RegistryPaydayReportsOptions {
  runId?: number | null;
  partitionKey: string;
  dryRun?: boolean;
  db?: RegistryDb;
  fetchOptions?: RegistryFetchOptions;
  /** Tests pass a stub; the default reads the PDF with unpdf. */
  pdfText?: (bytes: Uint8Array) => Promise<string>;
}

export interface RegistryPaydayReportsResult {
  source: string;
  partitionKey: string;
  sourceUrl: string | null;
  rows: number;
  writtenRows: number;
  missingFields: string[];
  dryRun: boolean;
  empty: boolean;
  emptyReason: string | null;
  summary: string;
  detail: Record<string, unknown>;
}

const gone = (error: unknown) => error instanceof RegistryHttpError && error.status !== null && [403, 404, 410].includes(error.status);

export async function runRegistryPaydayReports(options: RegistryPaydayReportsOptions): Promise<RegistryPaydayReportsResult> {
  const db = options.db ?? sql;
  const parsed = parsePaydayPartition(options.partitionKey);
  if (!parsed) throw new Error(`Invalid payday report partition: ${options.partitionKey}`);
  const { source, year } = parsed;
  const fetchOptions = options.fetchOptions ?? {};
  const base: RegistryPaydayReportsResult = {
    source: PAYDAY_REPORTS_SOURCE,
    partitionKey: options.partitionKey,
    sourceUrl: null,
    rows: 0,
    writtenRows: 0,
    missingFields: [],
    dryRun: Boolean(options.dryRun),
    empty: false,
    emptyReason: null,
    summary: "",
    detail: {},
  };
  const empty = async (reason: string, url: string | null, retryHours: number, extra: Record<string, unknown> = {}) => {
    const detail = { parser_version: PAYDAY_REPORTS_PARSER_VERSION, reason, ...extra };
    if (!options.dryRun) {
      await recordRegistryPartition(db, {
        source: PAYDAY_REPORTS_SOURCE,
        partitionKey: options.partitionKey,
        status: "empty",
        rowCount: 0,
        sourceUrl: url,
        runId: options.runId ?? null,
        nextAttemptAfterHours: retryHours,
        detail,
      });
    }
    return { ...base, sourceUrl: url, empty: true, emptyReason: reason, missingFields: (extra.missing_fields as string[]) ?? [], detail, summary: `${source.title} ${year}: nothing loaded. ${reason}.` };
  };

  let url: string | null = source.knownUrls[year] ?? null;
  const urlBasis = url ? "known_url" : "index_page";
  const linkDetail: Record<string, unknown> = {};
  if (!url && source.indexUrl) {
    try {
      const links = findPaydayReportLink(await (await registryFetch(source.indexUrl, fetchOptions)).text(), source, year);
      linkDetail.index_links = links;
      if (links.length === 1) url = links[0];
      else if (links.length > 1) return empty(`Several report links name ${year}; none chosen`, source.indexUrl, HOURS.month, linkDetail);
    } catch (error) {
      if (!gone(error)) throw error;
      linkDetail.index_error = (error as Error).message;
    }
  }
  if (!url) return empty(`${source.title} for ${year} is not published (or not linked) yet`, source.indexUrl, HOURS.month, linkDetail);

  let text: string;
  try {
    const bytes = new Uint8Array(await (await registryFetch(url, fetchOptions)).arrayBuffer());
    text = await (options.pdfText ?? paydayPdfText)(bytes);
  } catch (error) {
    if (gone(error)) return empty(`Report file unavailable: ${(error as Error).message}`, url, HOURS.month, linkDetail);
    throw error;
  }
  const fetched = paydayFetch(readPaydayFigures(text, source.state, year, url), url);
  const detail: Record<string, unknown> = {
    parser_version: PAYDAY_REPORTS_PARSER_VERSION,
    url_basis: urlBasis,
    ...linkDetail,
    text_chars: text.length,
    missing_fields: fetched.missingFields,
    series: fetched.rows.map((r) => r.series_key),
  };
  if (fetched.rows.length === 0) return empty(fetched.emptyReason ?? "Nothing read", url, HOURS.year, detail);
  const rows = dedupeAreaStats(fetched.rows);
  const checks = checkAreaStats(rows);
  detail.checks = checks;
  if (options.dryRun) {
    return { ...base, sourceUrl: url, rows: rows.length, missingFields: fetched.missingFields, detail, summary: `${source.title} ${year}: read ${rows.length} figures (dry run).` };
  }
  const written = await upsertAreaStats(db, PAYDAY_REPORTS_SOURCE, rows, url, options.runId ?? null);
  await recordRegistryPartition(db, {
    source: PAYDAY_REPORTS_SOURCE,
    partitionKey: options.partitionKey,
    status: "succeeded",
    rowCount: rows.length,
    insertedCount: written,
    sourceUrl: url,
    runId: options.runId ?? null,
    // Annual reports can be revised (Texas republished 2024); look again yearly.
    nextAttemptAfterHours: HOURS.year,
    detail: { ...detail, written_rows: written },
  });
  return {
    ...base,
    sourceUrl: url,
    rows: rows.length,
    writtenRows: written,
    missingFields: fetched.missingFields,
    detail: { ...detail, written_rows: written },
    summary: `Magellan loaded ${source.title} ${year}: ${written} figures${fetched.missingFields.length ? `; not read: ${fetched.missingFields.length}` : ""}.`,
  };
}
