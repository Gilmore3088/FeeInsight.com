import { strFromU8 } from "fflate";
import { sql } from "@/lib/data-store/connection";
import { unzipSchedules } from "@/lib/regulatory/ffiec";
import {
  BHCF_FILE_PATTERN,
  MDRM_FILE_PATTERN,
  Y9C_ALL_CODES,
  bhcfZipUrls,
  checkY9cQuality,
  fetchBhcfZip,
  fetchMdrmText,
  readMdrm,
  readY9c,
  type Y9cColumnCheck,
  type Y9cFiler,
  type Y9cQualityReport,
  type Y9cRead,
  type Y9cValue,
} from "@/lib/regulatory/fr-y9c";
import { blockedHost, type RegistryBlockedHost, type RegistryFetchOptions } from "@/lib/regulatory/http";
import {
  latestPublishableQuarter,
  parseQuarterKey,
  quarterEndDate,
  quarterKey,
  quartersNewestFirst,
  type Quarter,
} from "@/lib/regulatory/quarters";
import { recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry step: one quarter of FR Y-9C holding-company lines (total assets,
 * deposits, loans, equity, net income, noninterest income, service charges on deposit
 * accounts, interchange where reported, charge-offs and recoveries) from the NIC bulk BHCF
 * file, written to holding_company_y9c_items keyed by the filer's RSSD, with one
 * holding_company_y9c_filers row per filer holding its identity and raw cells.
 *
 * holding_company_financials is not reused: it is a wide table keyed by SEC CIK with fixed
 * columns and no source column, so Y-9C lines would not fit without altering it.
 *
 * Banks link through institution_sources.holding_company_rssd. Values are stored as filed:
 * thousands of dollars, income lines year to date. A line missing from the file or described
 * differently (file description row, else the MDRM dictionary) is listed in the partition
 * detail and nothing is written for it.
 *
 * When NIC refuses the request (HTTP 401/403; www.ffiec.gov answers production's Vercel requests
 * with 403, #1806), the quarter is recorded empty with `detail.missing_source` naming the host.
 * FR Y-9C has no official second host, so nothing stands in for it.
 */

export const FR_Y9C_SOURCE = "fr-y9c";
export const FR_Y9C_PARSER_VERSION = 1;
/** Y-9C is due 40 days after quarter end (45 for Q4); NIC posts the bulk file after that. */
export const FR_Y9C_FILING_LAG_DAYS = 75;
export const FR_Y9C_FIRST: Quarter = { year: 2015, quarter: 1 };
const RECENT_REFRESH_HOURS = 24 * 7;
const HISTORICAL_REFRESH_HOURS = 24 * 180;
const EMPTY_RETRY_HOURS = 24;
/** A refused host is asked again weekly, not daily. */
const BLOCKED_RETRY_HOURS = 24 * 7;
const WRITE_CHUNK = 5_000;

export interface Y9cMissingSource {
  host: string;
  url: string;
  status: number;
  /** FR Y-9C has no official second host. */
  second_host: null;
}

export function frY9cPartitions(now: Date, from: Quarter = FR_Y9C_FIRST): string[] {
  return quartersNewestFirst(from, latestPublishableQuarter(now, FR_Y9C_FILING_LAG_DAYS)).map(quarterKey);
}

function refreshHours(q: Quarter, now: Date): number {
  return latestPublishableQuarter(now, FR_Y9C_FILING_LAG_DAYS).year === q.year ? RECENT_REFRESH_HOURS : HISTORICAL_REFRESH_HOURS;
}

export interface RegistryFrY9cOptions {
  runId?: number | null;
  partitionKey: string;
  dryRun?: boolean;
  db?: RegistryDb;
  fetchOptions?: RegistryFetchOptions;
  now?: Date;
}

export interface RegistryFrY9cResult {
  source: string;
  partitionKey: string;
  reportDate: string;
  sourceUrl: string;
  fileName: string | null;
  filers: number;
  matchedHoldingCompanies: number;
  values: number;
  writtenRows: number;
  writtenFilers: number;
  loadedLines: string[];
  missingLines: Y9cColumnCheck[];
  usedMdrm: boolean;
  quality: Y9cQualityReport | null;
  /** Set when NIC refused the request: the host and what it answered. */
  missingSource: Y9cMissingSource | null;
  dryRun: boolean;
  empty: boolean;
  emptyReason: string | null;
}

async function writeFilers(db: RegistryDb, reportDate: string, url: string, filers: Y9cFiler[], runId: number | null): Promise<number> {
  let written = 0;
  for (let at = 0; at < filers.length; at += WRITE_CHUNK) {
    const payload = JSON.stringify(
      filers.slice(at, at + WRITE_CHUNK).map((f) => ({ rssd: f.rssd, legal_name: f.name, city: f.city, state_code: f.state, raw_json: f.raw })),
    );
    const result = await db`
      INSERT INTO holding_company_y9c_filers
        (holding_company_rssd, report_date, legal_name, city, state_code, raw_json, source_url, agent_run_id, fetched_at)
      SELECT x.rssd, ${reportDate}::date, x.legal_name, x.city, x.state_code, x.raw_json, ${url}, ${runId}, NOW()
        FROM jsonb_to_recordset(${payload}::jsonb) AS x(rssd text, legal_name text, city text, state_code text, raw_json jsonb)
      ON CONFLICT (holding_company_rssd, report_date) DO UPDATE SET
        legal_name = EXCLUDED.legal_name,
        city = EXCLUDED.city,
        state_code = EXCLUDED.state_code,
        raw_json = EXCLUDED.raw_json,
        source_url = EXCLUDED.source_url,
        agent_run_id = EXCLUDED.agent_run_id,
        fetched_at = NOW()
      RETURNING 1
    `;
    written += [...(result as unknown as unknown[])].length;
  }
  return written;
}

async function writeValues(db: RegistryDb, reportDate: string, url: string, values: Y9cValue[], runId: number | null): Promise<number> {
  let written = 0;
  for (let at = 0; at < values.length; at += WRITE_CHUNK) {
    const payload = JSON.stringify(
      values.slice(at, at + WRITE_CHUNK).map((v) => ({
        rssd: v.rssd,
        item_key: v.key,
        item_code: v.code,
        item_description: v.description,
        description_source: v.descriptionSource,
        schedule: v.schedule,
        value: v.value,
        unit: v.unit,
        period_basis: v.basis,
      })),
    );
    const result = await db`
      INSERT INTO holding_company_y9c_items
        (holding_company_rssd, report_date, item_code, item_key, item_description, description_source, schedule, value,
         unit, period_basis, source_url, agent_run_id, fetched_at)
      SELECT x.rssd, ${reportDate}::date, x.item_code, x.item_key, x.item_description, x.description_source, x.schedule,
             x.value, x.unit, x.period_basis, ${url}, ${runId}, NOW()
        FROM jsonb_to_recordset(${payload}::jsonb)
          AS x(rssd text, item_key text, item_code text, item_description text, description_source text, schedule text,
               value numeric, unit text, period_basis text)
      ON CONFLICT (holding_company_rssd, report_date, item_key) DO UPDATE SET
        item_code = EXCLUDED.item_code,
        item_description = EXCLUDED.item_description,
        description_source = EXCLUDED.description_source,
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

/** Filers that are the recorded holding company of at least one bank we track. */
async function countMatched(db: RegistryDb, rssds: string[]): Promise<number> {
  if (rssds.length === 0) return 0;
  const [row] = await db<{ matched: number }[]>`
    SELECT COUNT(DISTINCT holding_company_rssd)::int AS matched
      FROM institution_sources
     WHERE holding_company_rssd IN ${db(rssds)}
  `;
  return Number(row?.matched ?? 0);
}

/**
 * NIC refused the request (#1806: HTTP 403 to Vercel). FR Y-9C has no official second host, so
 * the quarter is recorded empty with `detail.missing_source` naming the host. Nothing is written.
 */
async function recordBlocked(
  db: RegistryDb,
  input: { partitionKey: string; reportDate: string; dryRun: boolean; runId: number | null; blocked: RegistryBlockedHost },
): Promise<RegistryFrY9cResult> {
  const missingSource: Y9cMissingSource = { host: input.blocked.host, url: input.blocked.url, status: input.blocked.status, second_host: null };
  const emptyReason = `FR Y-9C source missing: ${input.blocked.host} answered HTTP ${input.blocked.status} and FR Y-9C has no official second host`;
  const base: RegistryFrY9cResult = {
    source: FR_Y9C_SOURCE,
    partitionKey: input.partitionKey,
    reportDate: input.reportDate,
    sourceUrl: input.blocked.url,
    fileName: null,
    filers: 0,
    matchedHoldingCompanies: 0,
    values: 0,
    writtenRows: 0,
    writtenFilers: 0,
    loadedLines: [],
    missingLines: [],
    usedMdrm: false,
    quality: null,
    missingSource,
    dryRun: input.dryRun,
    empty: true,
    emptyReason,
  };
  if (input.dryRun) return base;
  await recordRegistryPartition(db, {
    source: FR_Y9C_SOURCE,
    partitionKey: input.partitionKey,
    status: "empty",
    rowCount: 0,
    sourceUrl: input.blocked.url,
    runId: input.runId,
    nextAttemptAfterHours: BLOCKED_RETRY_HOURS,
    detail: { parser_version: FR_Y9C_PARSER_VERSION, report_date: input.reportDate, missing_source: missingSource, reason: emptyReason },
  });
  return base;
}

export async function runRegistryFrY9c(options: RegistryFrY9cOptions): Promise<RegistryFrY9cResult> {
  const db = options.db ?? sql;
  const dryRun = Boolean(options.dryRun);
  const quarter = parseQuarterKey(options.partitionKey);
  if (!quarter) throw new Error(`Invalid FR Y-9C quarter partition: ${options.partitionKey}`);
  const reportDate = quarterEndDate(quarter);
  const now = options.now ?? new Date();

  let download: Awaited<ReturnType<typeof fetchBhcfZip>>;
  try {
    download = await fetchBhcfZip(quarter, options.fetchOptions);
  } catch (error) {
    const blocked = blockedHost(error);
    if (!blocked) throw error;
    return recordBlocked(db, { partitionKey: options.partitionKey, reportDate, dryRun, runId: options.runId ?? null, blocked });
  }
  const sourceUrl = download?.url ?? bhcfZipUrls(quarter)[0];
  let fileName: string | null = null;
  let read: Y9cRead | null = null;
  let usedMdrm = false;
  let mdrmUnavailable = false;
  if (download) {
    const files = await unzipSchedules(download.body, BHCF_FILE_PATTERN);
    fileName = Object.keys(files).sort()[0] ?? null;
    if (fileName) {
      const text = strFromU8(files[fileName], true);
      read = readY9c(text, quarter, null);
      // Columns the file does not describe are checked against the MDRM dictionary instead.
      if (read.columns.some((c) => c.status === "no_description")) {
        const mdrmText = await fetchMdrmText(options.fetchOptions, (zip) => unzipSchedules(zip, MDRM_FILE_PATTERN));
        const mdrm = mdrmText ? readMdrm(mdrmText, new Set(Y9C_ALL_CODES)) : null;
        if (mdrm?.headerFound) {
          usedMdrm = true;
          read = readY9c(text, quarter, mdrm.entries);
        } else mdrmUnavailable = true;
      }
    }
  }

  const loadedLines = [...new Set((read?.columns ?? []).filter((c) => c.status === "loaded").map((c) => c.key))];
  const missingLines = (read?.columns ?? []).filter((c) => c.status !== "loaded" && !loadedLines.includes(c.key));
  const values = read?.values ?? [];
  const filers = read?.filers ?? [];
  const quality = read ? checkY9cQuality(read, quarter) : null;
  const emptyReason = !download
    ? "NIC does not list a BHCF file for this quarter yet"
    : !fileName
      ? "The BHCF zip holds no BHCF data file"
      : (read?.missingIdentityFields ?? []).includes("RSSD9001")
        ? "The BHCF file has no RSSD9001 column"
        : loadedLines.length === 0
          ? `No Y-9C line passed its code and description check${mdrmUnavailable ? " (MDRM dictionary unavailable)" : ""}`
          : null;

  const base: RegistryFrY9cResult = {
    source: FR_Y9C_SOURCE,
    partitionKey: options.partitionKey,
    reportDate,
    sourceUrl,
    fileName,
    filers: filers.length,
    matchedHoldingCompanies: await countMatched(db, filers.map((f) => f.rssd)),
    values: values.length,
    writtenRows: 0,
    writtenFilers: 0,
    loadedLines,
    missingLines,
    usedMdrm,
    quality,
    missingSource: null,
    dryRun,
    empty: emptyReason !== null,
    emptyReason,
  };
  if (dryRun) return base;

  const detail = {
    parser_version: FR_Y9C_PARSER_VERSION,
    report_date: reportDate,
    file: fileName,
    delimiter: read?.delimiter ?? null,
    has_description_row: read?.hasDescriptionRow ?? null,
    used_mdrm: usedMdrm,
    mdrm_unavailable: mdrmUnavailable,
    missing_identity_fields: read?.missingIdentityFields ?? [],
    loaded_lines: loadedLines,
    missing_lines: missingLines,
    columns: read?.columns ?? [],
    quality,
  };
  if (emptyReason !== null) {
    await recordRegistryPartition(db, {
      source: FR_Y9C_SOURCE,
      partitionKey: options.partitionKey,
      status: "empty",
      rowCount: 0,
      sourceUrl,
      runId: options.runId ?? null,
      nextAttemptAfterHours: download ? refreshHours(quarter, now) : EMPTY_RETRY_HOURS,
      detail: { ...detail, reason: emptyReason },
    });
    return base;
  }

  const runId = options.runId ?? null;
  const writtenFilers = await writeFilers(db, reportDate, sourceUrl, filers, runId);
  const writtenRows = await writeValues(db, reportDate, sourceUrl, values, runId);
  const matched = base.matchedHoldingCompanies;
  await recordRegistryPartition(db, {
    source: FR_Y9C_SOURCE,
    partitionKey: options.partitionKey,
    status: "succeeded",
    rowCount: values.length,
    matchedCount: matched,
    unmatchedCount: Math.max(0, filers.length - matched),
    insertedCount: writtenRows,
    sourceUrl,
    runId,
    nextAttemptAfterHours: refreshHours(quarter, now),
    detail: { ...detail, filers: filers.length, matched_holding_companies: matched, values: values.length, written_rows: writtenRows, written_filers: writtenFilers },
  });
  return { ...base, writtenRows, writtenFilers };
}
