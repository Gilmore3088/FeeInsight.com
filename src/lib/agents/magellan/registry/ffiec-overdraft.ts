import { sql } from "@/lib/data-store/connection";
import { FFIEC_BULK_URL, fetchFfiecCallBulk, readScheduleRiOverdraft, type FfiecOverdraftRow } from "@/lib/regulatory/ffiec";
import type { RegistryFetchOptions } from "@/lib/regulatory/http";
import {
  compareQuarters,
  latestPublishableQuarter,
  parseQuarterKey,
  previousQuarter,
  quarterEndDate,
  quarterKey,
  type Quarter,
} from "@/lib/regulatory/quarters";
import { recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry step: one quarter of bank consumer overdraft and NSF income (call report
 * RIAD H032, banks with $1B or more in assets) from the FFIEC bulk call report, written to
 * institution_financial_records.overdraft_revenue on the bank's existing FDIC row.
 *
 * FDIC rows hold quarterly income, but H032 is filed year to date. A quarter's value is its
 * YTD minus the quarters already stored for the same year, and only when every earlier quarter
 * of that year is on file for that bank; otherwise it stays empty rather than guessed. So the
 * partitions run oldest quarter first within each year.
 */

export const FFIEC_OVERDRAFT_SOURCE = "ffiec-overdraft";
/** FFIEC posts the bulk file about 45 days after quarter end. */
export const FFIEC_FILING_LAG_DAYS = 50;
/** H032 first appeared on the March 2015 call report. */
export const FFIEC_OVERDRAFT_FIRST: Quarter = { year: 2015, quarter: 1 };
const RECENT_REFRESH_HOURS = 24 * 7;
const HISTORICAL_REFRESH_HOURS = 24 * 180;
const EMPTY_RETRY_HOURS = 24;

/** Years newest first, quarters oldest first inside each year, so YTD differences have their base. */
export function ffiecOverdraftPartitions(now: Date, from: Quarter = FFIEC_OVERDRAFT_FIRST): string[] {
  const latest = latestPublishableQuarter(now, FFIEC_FILING_LAG_DAYS);
  const out: string[] = [];
  for (let year = latest.year; year >= from.year; year -= 1) {
    for (let quarter = 1 as Quarter["quarter"]; quarter <= 4; quarter = (quarter + 1) as Quarter["quarter"]) {
      const q: Quarter = { year, quarter };
      if (compareQuarters(q, from) >= 0 && compareQuarters(q, latest) <= 0) out.push(quarterKey(q));
      if (quarter === 4) break;
    }
  }
  return out;
}

/** Quarter-end dates earlier in the same year. */
export function earlierQuarterEnds(q: Quarter): string[] {
  const out: string[] = [];
  for (let p = previousQuarter(q); p.year === q.year; p = previousQuarter(p)) out.push(quarterEndDate(p));
  return out;
}

export interface RegistryFfiecOverdraftOptions {
  runId?: number | null;
  partitionKey: string;
  dryRun?: boolean;
  db?: RegistryDb;
  fetchOptions?: RegistryFetchOptions;
  now?: Date;
}

export interface RegistryFfiecOverdraftResult {
  source: string;
  partitionKey: string;
  reportDate: string;
  sourceUrl: string;
  fileName: string | null;
  filers: number;
  matchedBanks: number;
  updatedRows: number;
  quarterlyValues: number;
  dryRun: boolean;
  empty: boolean;
  emptyReason: string | null;
}

async function countMatched(db: RegistryDb, rssds: string[]): Promise<number> {
  if (rssds.length === 0) return 0;
  const [row] = await db<{ matched: number }[]>`
    SELECT COUNT(DISTINCT rssd_id)::int AS matched
      FROM institution_sources
     WHERE source = 'fdic' AND rssd_id IN ${db(rssds)}
  `;
  return Number(row?.matched ?? 0);
}

async function writeQuarter(
  db: RegistryDb,
  q: Quarter,
  rows: FfiecOverdraftRow[],
): Promise<{ updated: number; quarterly: number }> {
  const payload = JSON.stringify(rows.map((r) => ({ rssd: r.rssd, ytd: r.ytdThousands })));
  const reportDate = quarterEndDate(q);
  const earlier = earlierQuarterEnds(q);
  const result = await db`
    WITH r AS (
      SELECT * FROM jsonb_to_recordset(${payload}::jsonb) AS x(rssd text, ytd bigint)
    ), ids AS (
      SELECT DISTINCT ON (s.id) s.id AS institution_id, r.ytd
        FROM r
        JOIN institution_sources s ON s.source = 'fdic' AND s.rssd_id = r.rssd
       ORDER BY s.id
    ), prior AS (
      SELECT f.institution_id, COUNT(*)::int AS quarters, SUM(f.overdraft_revenue) AS total
        FROM institution_financial_records f
        JOIN ids USING (institution_id)
       WHERE f.source = 'fdic'
         AND f.report_date = ANY(${earlier}::text[])
         AND f.overdraft_revenue IS NOT NULL
       GROUP BY f.institution_id
    )
    UPDATE institution_financial_records f
       SET overdraft_revenue = CASE
             WHEN ${earlier.length}::int = 0 THEN ids.ytd
             WHEN COALESCE(prior.quarters, 0) = ${earlier.length}::int THEN ids.ytd - prior.total
             ELSE NULL
           END
      FROM ids
      LEFT JOIN prior USING (institution_id)
     WHERE f.source = 'fdic'
       AND f.institution_id = ids.institution_id
       AND f.report_date = ${reportDate}
    RETURNING (f.overdraft_revenue IS NOT NULL) AS quarterly
  `;
  const list = [...(result as unknown as Array<{ quarterly: boolean }>)];
  return { updated: list.length, quarterly: list.filter((row) => row.quarterly).length };
}

export function ffiecRefreshHours(q: Quarter, now: Date): number {
  const latest = latestPublishableQuarter(now, FFIEC_FILING_LAG_DAYS);
  return latest.year === q.year ? RECENT_REFRESH_HOURS : HISTORICAL_REFRESH_HOURS;
}

export async function runRegistryFfiecOverdraft(options: RegistryFfiecOverdraftOptions): Promise<RegistryFfiecOverdraftResult> {
  const db = options.db ?? sql;
  const dryRun = Boolean(options.dryRun);
  const quarter = parseQuarterKey(options.partitionKey);
  if (!quarter) throw new Error(`Invalid FFIEC quarter partition: ${options.partitionKey}`);
  const reportDate = quarterEndDate(quarter);

  const download = await fetchFfiecCallBulk(quarter, options.fetchOptions);
  const parsed = download.files ? readScheduleRiOverdraft(download.files) : null;
  const emptyReason = !download.files
    ? "FFIEC does not list this quarter yet"
    : !parsed?.hasColumn
      ? `The bulk file has no Schedule RI RIADH032 column (files: ${parsed?.files.join(", ") || "none"})`
      : null;
  const rows = parsed?.rows ?? [];
  const rssds = rows.map((r) => r.rssd);
  const base: RegistryFfiecOverdraftResult = {
    source: FFIEC_OVERDRAFT_SOURCE,
    partitionKey: options.partitionKey,
    reportDate,
    sourceUrl: FFIEC_BULK_URL,
    fileName: download.fileName,
    filers: rows.length,
    matchedBanks: await countMatched(db, rssds),
    updatedRows: 0,
    quarterlyValues: 0,
    dryRun,
    empty: emptyReason !== null,
    emptyReason,
  };
  if (dryRun) return base;

  if (emptyReason !== null) {
    await recordRegistryPartition(db, {
      source: FFIEC_OVERDRAFT_SOURCE,
      partitionKey: options.partitionKey,
      status: "empty",
      rowCount: 0,
      sourceUrl: FFIEC_BULK_URL,
      runId: options.runId ?? null,
      nextAttemptAfterHours: download.files ? HISTORICAL_REFRESH_HOURS : EMPTY_RETRY_HOURS,
      detail: { report_date: reportDate, reason: emptyReason, file: download.fileName },
    });
    return base;
  }

  const written = await writeQuarter(db, quarter, rows);
  await recordRegistryPartition(db, {
    source: FFIEC_OVERDRAFT_SOURCE,
    partitionKey: options.partitionKey,
    status: "succeeded",
    rowCount: rows.length,
    matchedCount: base.matchedBanks,
    unmatchedCount: Math.max(0, rows.length - base.matchedBanks),
    insertedCount: written.updated,
    sourceUrl: FFIEC_BULK_URL,
    runId: options.runId ?? null,
    nextAttemptAfterHours: ffiecRefreshHours(quarter, options.now ?? new Date()),
    detail: {
      report_date: reportDate,
      file: download.fileName,
      filers: rows.length,
      updated_rows: written.updated,
      quarterly_values: written.quarterly,
      no_base_quarters: written.updated - written.quarterly,
    },
  });
  return { ...base, updatedRows: written.updated, quarterlyValues: written.quarterly };
}
