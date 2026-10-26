import { compactCallStorageReady, writeCompactCallItems } from "@/lib/data-store/call-item-storage";
import { sql } from "@/lib/data-store/connection";
import { registryFetch, type RegistryFetchOptions } from "@/lib/regulatory/http";
import { ncuaZipUrl } from "@/lib/regulatory/ncua";
import { readNcuaExtras, type NcuaExtraValue } from "@/lib/regulatory/ncua-extras";
import {
  latestPublishableQuarter,
  parseQuarterKey,
  quarterEndDate,
  quarterKey,
  quartersNewestFirst,
  type Quarter,
} from "@/lib/regulatory/quarters";
import { NCUA_FILING_LAG_DAYS } from "./ncua-financials";
import { checkValues, flaggedOnly } from "@/lib/regulatory/data-checks";
import { recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry step: one quarter of NCUA 5300 lines beyond the fixed financial columns
 * (share and deposit account counts, employees, shares over the insured limit, fee-income
 * lines), written to institution_call_report_items under NCUA's own codes and descriptions.
 * Which lines are read comes from the zip's account description file, never from a code list
 * written here (src/lib/regulatory/ncua-extras.ts). Dollar lines are stored in whole dollars as
 * filed; income lines are year to date.
 */

export const NCUA_EXTRAS_SOURCE = "ncua-extras";
export const NCUA_EXTRAS_PARSER_VERSION = 3;
/**
 * Newest quarters first, back to here. Held at the 13 quarters already loaded (Oct 18, 2026): the
 * back-fill had reached 2023 Q2 and the six years still due to 2020 Q1 were about 4 GB more of lines
 * nothing reads yet. Lower it only by PR, with the size budget for institution_call_report_items
 * (`src/lib/agents/hoovie/size-budgets.ts`) in view.
 */
export const NCUA_EXTRAS_FIRST: Quarter = { year: 2023, quarter: 2 };
const RECENT_REFRESH_HOURS = 24 * 7;
const HISTORICAL_REFRESH_HOURS = 24 * 180;
const EMPTY_RETRY_HOURS = 24;
const WRITE_CHUNK = 5_000;

export function ncuaExtrasPartitions(now: Date, from: Quarter = NCUA_EXTRAS_FIRST): string[] {
  return quartersNewestFirst(from, latestPublishableQuarter(now, NCUA_FILING_LAG_DAYS)).map(quarterKey);
}

export interface RegistryNcuaExtrasOptions {
  runId?: number | null;
  partitionKey: string;
  dryRun?: boolean;
  db?: RegistryDb;
  fetchOptions?: RegistryFetchOptions;
  now?: Date;
}

export interface RegistryNcuaExtrasResult {
  source: string;
  partitionKey: string;
  reportDate: string;
  sourceUrl: string;
  lines: number;
  creditUnions: number;
  values: number;
  writtenRows: number;
  topicsWithoutLines: string[];
  dryRun: boolean;
  empty: boolean;
  emptyReason: string | null;
}

async function fetchZip(url: string, options: RegistryFetchOptions = {}): Promise<Uint8Array | null> {
  try {
    const response = await registryFetch(url, { timeoutMs: 180_000, ...options });
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    if (error && typeof error === "object" && "status" in error && (error as { status: number }).status === 404) return null;
    throw error;
  }
}

async function writeValues(db: RegistryDb, reportDate: string, url: string, values: NcuaExtraValue[], runId: number | null): Promise<number> {
  if (await compactCallStorageReady(db)) {
    return writeCompactCallItems(db, { source: "ncua", reportDate: reportDate, url: url, runId,
      rows: values.map((v) => ({
        charter: v.charter,
        item_key: v.key,
        item_code: v.code,
        item_description: v.description,
        schedule: v.table,
        value: v.value,
        unit: v.unit,
        period_basis: v.basis,
      })),
    });
  }
  let written = 0;
  for (let at = 0; at < values.length; at += WRITE_CHUNK) {
    const payload = JSON.stringify(
      values.slice(at, at + WRITE_CHUNK).map((v) => ({
        charter: v.charter,
        item_key: v.key,
        item_code: v.code,
        item_description: v.description,
        schedule: v.table,
        value: v.value,
        unit: v.unit,
        period_basis: v.basis,
      })),
    );
    const result = await db`
      WITH r AS (
        SELECT * FROM jsonb_to_recordset(${payload}::jsonb)
          AS x(charter text, item_key text, item_code text, item_description text, schedule text, value numeric, unit text, period_basis text)
      ), ids AS (
        SELECT DISTINCT ON (c.charter) c.charter, s.id AS institution_id
          FROM (SELECT DISTINCT charter FROM r) c
          JOIN institution_sources s ON s.source = 'ncua' AND (s.cert_number = c.charter OR s.ncua_charter_id = c.charter)
         ORDER BY c.charter, s.id
      )
      INSERT INTO institution_call_report_items AS f
        (institution_id, source, report_date, item_code, item_key, item_description, schedule, value, unit,
         period_basis, source_url, agent_run_id, fetched_at)
      SELECT ids.institution_id, 'ncua', ${reportDate}::date, r.item_code, r.item_key, r.item_description, NULLIF(r.schedule, ''),
             r.value, r.unit, r.period_basis, ${url}, ${runId}, NOW()
        FROM r JOIN ids ON ids.charter = r.charter
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
      -- Partition receipts record successful rechecks; unchanged facts keep their original row.
      WHERE ROW(f.item_code, f.item_description, f.schedule, f.value, f.unit, f.period_basis, f.source_url)
        IS DISTINCT FROM ROW(EXCLUDED.item_code, EXCLUDED.item_description, EXCLUDED.schedule, EXCLUDED.value, EXCLUDED.unit, EXCLUDED.period_basis, EXCLUDED.source_url)
      RETURNING 1
    `;
    written += [...(result as unknown as unknown[])].length;
  }
  return written;
}

export async function runRegistryNcuaExtras(options: RegistryNcuaExtrasOptions): Promise<RegistryNcuaExtrasResult> {
  const db = options.db ?? sql;
  const dryRun = Boolean(options.dryRun);
  const quarter = parseQuarterKey(options.partitionKey);
  if (!quarter) throw new Error(`Invalid NCUA quarter partition: ${options.partitionKey}`);
  const reportDate = quarterEndDate(quarter);
  const url = ncuaZipUrl(quarter);
  const now = options.now ?? new Date();

  const zip = await fetchZip(url, options.fetchOptions);
  const read = zip ? readNcuaExtras(zip) : null;
  const emptyReason = !zip
    ? "NCUA has not published this quarter yet"
    : !read?.hasDescriptionFile
      ? "The zip has no account description file (AcctDesc), so no line can be confirmed"
      : read.values.length === 0
        ? "No 5300 line matched the account-count, employee, insured-limit, fee-income, dividend or share-mix topics"
        : null;
  const values = read?.values ?? [];
  const charters = new Set(values.map((v) => v.charter));
  const base: RegistryNcuaExtrasResult = {
    source: NCUA_EXTRAS_SOURCE,
    partitionKey: options.partitionKey,
    reportDate,
    sourceUrl: url,
    lines: read?.lines.length ?? 0,
    creditUnions: charters.size,
    values: values.length,
    writtenRows: 0,
    topicsWithoutLines: read?.topicsWithoutLines ?? [],
    dryRun,
    empty: emptyReason !== null,
    emptyReason,
  };
  if (dryRun) return base;

  const latest = latestPublishableQuarter(now, NCUA_FILING_LAG_DAYS);
  const refreshHours = latest.year === quarter.year ? RECENT_REFRESH_HOURS : HISTORICAL_REFRESH_HOURS;
  const valueChecks = flaggedOnly(checkValues(values.map((v) => ({ key: v.key, id: v.charter, value: v.value }))));
  const detail = {
    value_checks: valueChecks,
    parser_version: NCUA_EXTRAS_PARSER_VERSION,
    report_date: reportDate,
    description_file: read?.descriptionFile ?? null,
    lines: (read?.lines ?? []).map((l) => ({ code: l.code, topic: l.topic, name: l.name, description: l.description, unit: l.unit })),
    lines_not_in_data: read?.linesNotInData ?? [],
    topics_without_lines: base.topicsWithoutLines,
    truncated_lines: read?.truncatedLines ?? 0,
  };
  if (emptyReason !== null) {
    await recordRegistryPartition(db, {
      source: NCUA_EXTRAS_SOURCE,
      partitionKey: options.partitionKey,
      status: "empty",
      rowCount: 0,
      sourceUrl: url,
      runId: options.runId ?? null,
      nextAttemptAfterHours: zip ? refreshHours : EMPTY_RETRY_HOURS,
      detail: { ...detail, reason: emptyReason },
    });
    return base;
  }

  const writtenRows = await writeValues(db, reportDate, url, values, options.runId ?? null);
  await recordRegistryPartition(db, {
    source: NCUA_EXTRAS_SOURCE,
    partitionKey: options.partitionKey,
    status: "succeeded",
    rowCount: values.length,
    insertedCount: writtenRows,
    sourceUrl: url,
    runId: options.runId ?? null,
    nextAttemptAfterHours: refreshHours,
    detail: { ...detail, credit_unions: charters.size, values: values.length, written_rows: writtenRows },
  });
  return { ...base, writtenRows };
}
