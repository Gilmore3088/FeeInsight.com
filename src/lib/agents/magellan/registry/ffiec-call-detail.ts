import { sql } from "@/lib/data-store/connection";
import { FFIEC_BULK_URL, FFIEC_POR_FILE, fetchFfiecCallBulk, readFfiecPor, schedulePattern, type FfiecPorRead } from "@/lib/regulatory/ffiec";
import {
  FFIEC_CALL_ITEM_SCHEDULES,
  porItemValues,
  readFfiecCallItems,
  type FfiecColumnCheck,
  type FfiecItemValue,
} from "@/lib/regulatory/ffiec-call-items";
import type { RegistryFetchOptions } from "@/lib/regulatory/http";
import { parseQuarterKey, quarterEndDate, type Quarter } from "@/lib/regulatory/quarters";
import { ffiecOverdraftPartitions, ffiecRefreshHours } from "./ffiec-overdraft";
import { checkValues, flaggedOnly } from "@/lib/regulatory/data-checks";
import { recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry step: one quarter of bank call-report detail lines from the FFIEC bulk
 * call report (service charges by type, deposit accounts by size, past-due loans, charge-offs
 * and recoveries by loan type), written to institution_call_report_items. The lines and the
 * description check that guards each code are in src/lib/regulatory/ffiec-call-items.ts.
 *
 * Values are stored as filed: income lines year to date, balance lines at quarter end, dollars
 * in thousands. A line missing from the file or described differently is listed in the
 * partition detail and nothing is written for it.
 *
 * v5 (#1925) also reads the zip's POR file and stores each bank's "Last Date/Time Submission
 * Updated On" for the quarter as one more item row (`filing_last_updated`, code
 * `POR_LAST_UPDATED`, epoch seconds), so Deming's filings reconcile can tell which feed holds the
 * newer version of a refiled report. It is not a financial line: it is left out of the line
 * counts and value checks, and readers that sum or serve lines never see it.
 */

export const FFIEC_CALL_DETAIL_SOURCE = "ffiec-call-detail";
export const FFIEC_CALL_DETAIL_PARSER_VERSION = 5;
const EMPTY_RETRY_HOURS = 24;
const WRITE_CHUNK = 5_000;

/**
 * Same order as the overdraft line, but only back to 2023 Q1 (Oct 18, 2026): the back-fill had
 * loaded 13 quarters to 2023 Q3, and the years still due to 2015 would have added several GB to
 * institution_call_report_items. 2023 Q4 still loads so that year is whole. Lower it only by PR,
 * with the table's size budget (`src/lib/agents/hoovie/size-budgets.ts`) in view.
 */
export const FFIEC_CALL_DETAIL_FIRST: Quarter = { year: 2023, quarter: 1 };

export function ffiecCallDetailPartitions(now: Date): string[] {
  return ffiecOverdraftPartitions(now, FFIEC_CALL_DETAIL_FIRST);
}

export interface RegistryFfiecCallDetailOptions {
  runId?: number | null;
  partitionKey: string;
  dryRun?: boolean;
  db?: RegistryDb;
  fetchOptions?: RegistryFetchOptions;
  now?: Date;
}

export interface RegistryFfiecCallDetailResult {
  source: string;
  partitionKey: string;
  reportDate: string;
  sourceUrl: string;
  fileName: string | null;
  banks: number;
  matchedBanks: number;
  values: number;
  writtenRows: number;
  loadedLines: string[];
  missingLines: FfiecColumnCheck[];
  chargeOffPartsOverTotal: number;
  /** Banks with a filing last-updated time read from the POR file (0 when the file or column is missing). */
  filingTimes: number;
  dryRun: boolean;
  empty: boolean;
  emptyReason: string | null;
}

async function writeValues(db: RegistryDb, q: Quarter, values: FfiecItemValue[], runId: number | null): Promise<number> {
  const reportDate = quarterEndDate(q);
  let written = 0;
  for (let at = 0; at < values.length; at += WRITE_CHUNK) {
    const payload = JSON.stringify(
      values.slice(at, at + WRITE_CHUNK).map((v) => ({
        rssd: v.rssd,
        item_key: v.key,
        item_code: v.code,
        item_description: v.description,
        schedule: v.schedule,
        value: v.value,
        unit: v.unit,
        period_basis: v.basis,
      })),
    );
    const result = await db`
      WITH r AS (
        SELECT * FROM jsonb_to_recordset(${payload}::jsonb)
          AS x(rssd text, item_key text, item_code text, item_description text, schedule text, value numeric, unit text, period_basis text)
      ), ids AS (
        SELECT DISTINCT ON (s.rssd_id) s.rssd_id, s.id AS institution_id
          FROM institution_sources s
         WHERE s.source = 'fdic' AND s.rssd_id IN (SELECT DISTINCT rssd FROM r)
         ORDER BY s.rssd_id, s.id
      )
      INSERT INTO institution_call_report_items
        (institution_id, source, report_date, item_code, item_key, item_description, schedule, value, unit,
         period_basis, source_url, agent_run_id, fetched_at)
      SELECT ids.institution_id, 'ffiec', ${reportDate}::date, r.item_code, r.item_key, r.item_description, r.schedule,
             r.value, r.unit, r.period_basis, ${FFIEC_BULK_URL}, ${runId}, NOW()
        FROM r JOIN ids ON ids.rssd_id = r.rssd
      ON CONFLICT (institution_id, source, report_date, item_key) DO UPDATE SET
        item_code = EXCLUDED.item_code,
        item_description = EXCLUDED.item_description,
        schedule = EXCLUDED.schedule,
        value = EXCLUDED.value,
        unit = EXCLUDED.unit,
        period_basis = EXCLUDED.period_basis,
        source_url = EXCLUDED.source_url,
        agent_run_id = EXCLUDED.agent_run_id,
        fetched_at = NOW()
      RETURNING 1
    `;
    written += [...(result as unknown as unknown[])].length;
  }
  return written;
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

export async function runRegistryFfiecCallDetail(options: RegistryFfiecCallDetailOptions): Promise<RegistryFfiecCallDetailResult> {
  const db = options.db ?? sql;
  const dryRun = Boolean(options.dryRun);
  const quarter = parseQuarterKey(options.partitionKey);
  if (!quarter) throw new Error(`Invalid FFIEC quarter partition: ${options.partitionKey}`);
  const reportDate = quarterEndDate(quarter);

  const schedules = schedulePattern(FFIEC_CALL_ITEM_SCHEDULES);
  const download = await fetchFfiecCallBulk(quarter, options.fetchOptions, new RegExp(`${schedules.source}|${FFIEC_POR_FILE.source}`, "i"));
  const scheduleFiles = download.files
    ? Object.fromEntries(Object.entries(download.files).filter(([name]) => !FFIEC_POR_FILE.test(name)))
    : null;
  const parsed = scheduleFiles ? readFfiecCallItems(scheduleFiles) : null;
  const por: FfiecPorRead = download.files ? readFfiecPor(download.files) : { file: null, column: null, rows: [], unreadable: 0 };
  const filingTimes = porItemValues(por);
  const loadedLines = [...new Set((parsed?.columns ?? []).filter((c) => c.status === "loaded").map((c) => c.key))];
  // A line with an RCFD/RCON pair counts as missing only when neither code loaded.
  const missingLines = (parsed?.columns ?? []).filter((c) => c.status !== "loaded" && !loadedLines.includes(c.key));
  const values = parsed?.values ?? [];
  const rssds = [...new Set(values.map((v) => v.rssd))];
  const emptyReason = !download.files
    ? "FFIEC does not list this quarter yet"
    : loadedLines.length === 0
      ? `No detail line passed its code and description check (files: ${parsed?.files.join(", ") || "none"})`
      : null;

  const base: RegistryFfiecCallDetailResult = {
    source: FFIEC_CALL_DETAIL_SOURCE,
    partitionKey: options.partitionKey,
    reportDate,
    sourceUrl: FFIEC_BULK_URL,
    fileName: download.fileName,
    banks: rssds.length,
    matchedBanks: await countMatched(db, rssds),
    values: values.length,
    writtenRows: 0,
    loadedLines,
    missingLines,
    chargeOffPartsOverTotal: parsed?.chargeOffPartsOverTotal ?? 0,
    filingTimes: filingTimes.length,
    dryRun,
    empty: emptyReason !== null,
    emptyReason,
  };
  if (dryRun) return base;

  const valueChecks = flaggedOnly(checkValues(values.map((v) => ({ key: v.key, id: v.rssd, value: v.value }))));
  const detail = {
    value_checks: valueChecks,
    parser_version: FFIEC_CALL_DETAIL_PARSER_VERSION,
    report_date: reportDate,
    file: download.fileName,
    schedule_files: parsed?.files ?? [],
    loaded_lines: loadedLines,
    missing_lines: missingLines,
    columns: parsed?.columns ?? [],
    charge_off_parts_over_total: base.chargeOffPartsOverTotal,
    por: { file: por.file, column: por.column, banks: por.rows.length, unreadable: por.unreadable },
  };
  if (emptyReason !== null) {
    await recordRegistryPartition(db, {
      source: FFIEC_CALL_DETAIL_SOURCE,
      partitionKey: options.partitionKey,
      status: "empty",
      rowCount: 0,
      sourceUrl: FFIEC_BULK_URL,
      runId: options.runId ?? null,
      nextAttemptAfterHours: download.files ? ffiecRefreshHours(quarter, options.now ?? new Date()) : EMPTY_RETRY_HOURS,
      detail: { ...detail, reason: emptyReason },
    });
    return base;
  }

  const matched = base.matchedBanks;
  const writtenRows = await writeValues(db, quarter, values, options.runId ?? null);
  const filingTimeRows = filingTimes.length > 0 ? await writeValues(db, quarter, filingTimes, options.runId ?? null) : 0;
  await recordRegistryPartition(db, {
    source: FFIEC_CALL_DETAIL_SOURCE,
    partitionKey: options.partitionKey,
    status: "succeeded",
    rowCount: values.length,
    matchedCount: matched,
    unmatchedCount: Math.max(0, rssds.length - matched),
    insertedCount: writtenRows,
    sourceUrl: FFIEC_BULK_URL,
    runId: options.runId ?? null,
    nextAttemptAfterHours: ffiecRefreshHours(quarter, options.now ?? new Date()),
    detail: {
      ...detail,
      banks: rssds.length,
      matched_banks: matched,
      values: values.length,
      written_rows: writtenRows,
      filing_time_rows: filingTimeRows,
    },
  });
  return { ...base, writtenRows };
}
