import { sql } from "@/lib/data-store/connection";
import type { RegistryFetchOptions } from "@/lib/regulatory/http";
import { latestPublishableQuarter, parseQuarterKey, quarterEndDate, quarterKey, quartersNewestFirst, type Quarter } from "@/lib/regulatory/quarters";
import {
  cleanUbpr,
  fetchUbprBulk,
  loadedKeys,
  readUbprBanks,
  readUbprPeerAverages,
  UBPR_BULK_URL,
  UBPR_RATIO_PRODUCT,
  UBPR_STATS_PRODUCT,
  type UbprBankRecord,
  type UbprCleaningReport,
  type UbprColumnCheck,
  type UbprPeerAverage,
} from "@/lib/regulatory/ubpr-peer-groups";
import { ffiecRefreshHours } from "./ffiec-overdraft";
import { recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry step: one quarter of FFIEC UBPR data. Writes each bank's UBPR peer group
 * and its own value for the fee-related ratios to ubpr_bank_peer_groups, and the published
 * peer-group averages to ubpr_peer_group_averages. Column checks and the cleaning report
 * (banks without a group, odd group numbers, impossible and far-out values, unmatched RSSDs)
 * go in the partition detail; nothing is filled in or altered.
 *
 * Banks are matched to institution_sources by RSSD (source 'fdic'); unmatched banks are kept
 * with institution_id NULL and counted.
 */

export const UBPR_PEER_GROUPS_SOURCE = "ubpr-peer-groups";
/** v3 (#2204): follow the actual TSV radio postback handler, or submit a non-postback radio with Download. */
export const UBPR_PEER_GROUPS_PARSER_VERSION = 4;
const EMPTY_RETRY_HOURS = 24;
/** A withdrawn format is re-checked weekly, not every tick (#2473). */
const FORMAT_NOT_SERVED_RETRY_HOURS = 24 * 7;
/** The issue tracking FFIEC's withdrawal of the tab-delimited single-period UBPR file. */
const FORMAT_NOT_SERVED_ISSUE = 2473;
const WRITE_CHUNK = 2_000;

/** First quarter loaded: matches the FFIEC call-report lines; UBPR bulk history goes further back. */
export const UBPR_FIRST: Quarter = { year: 2015, quarter: 1 };
/** Days after quarter end before the UBPR quarter is expected (an estimate; UBPR follows the call report). */
export const UBPR_LAG_DAYS = 60;

/** Quarters newest first, 2015Q1 on. */
export function ubprPeerGroupsPartitions(now: Date, from: Quarter = UBPR_FIRST): string[] {
  return quartersNewestFirst(from, latestPublishableQuarter(now, UBPR_LAG_DAYS)).map(quarterKey);
}

export interface RegistryUbprPeerGroupsOptions {
  runId?: number | null;
  partitionKey: string;
  dryRun?: boolean;
  db?: RegistryDb;
  fetchOptions?: RegistryFetchOptions;
  now?: Date;
}

export interface RegistryUbprPeerGroupsResult {
  source: string;
  partitionKey: string;
  reportDate: string;
  sourceUrl: string;
  fileName: string | null;
  statsFileName: string | null;
  banks: number;
  banksWithPeerGroup: number;
  matchedBanks: number;
  unmatchedBanks: number;
  peerGroups: number;
  peerAverages: number;
  writtenBankRows: number;
  writtenAverageRows: number;
  peerGroupColumn: UbprColumnCheck | null;
  loadedRatios: string[];
  missingRatios: UbprColumnCheck[];
  averagesLoadedRatios: string[];
  averagesEmptyReason: string | null;
  cleaning: UbprCleaningReport | null;
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

async function writeBanks(db: RegistryDb, reportDate: string, banks: UbprBankRecord[], file: string | null, runId: number | null): Promise<number> {
  let written = 0;
  for (let at = 0; at < banks.length; at += WRITE_CHUNK) {
    const payload = JSON.stringify(
      banks.slice(at, at + WRITE_CHUNK).map((b) => ({ rssd: b.rssd, peer_group: b.peerGroup, ratios: b.ratios, ratio_codes: b.codes, raw_json: b.raw })),
    );
    const result = await db`
      WITH r AS (
        SELECT * FROM jsonb_to_recordset(${payload}::jsonb)
          AS x(rssd text, peer_group text, ratios jsonb, ratio_codes jsonb, raw_json jsonb)
      ), ids AS (
        SELECT DISTINCT ON (s.rssd_id) s.rssd_id, s.id AS institution_id
          FROM institution_sources s
         WHERE s.source = 'fdic' AND s.rssd_id IN (SELECT rssd FROM r)
         ORDER BY s.rssd_id, s.id
      )
      INSERT INTO ubpr_bank_peer_groups
        (rssd, report_date, institution_id, peer_group, ratios, ratio_codes, raw_json, source_file, source_url, agent_run_id, fetched_at)
      SELECT r.rssd, ${reportDate}::date, ids.institution_id, r.peer_group, r.ratios, r.ratio_codes, r.raw_json,
             ${file}, ${UBPR_BULK_URL}, ${runId}, NOW()
        FROM r LEFT JOIN ids ON ids.rssd_id = r.rssd
      ON CONFLICT (rssd, report_date) DO UPDATE SET
        institution_id = EXCLUDED.institution_id,
        peer_group = EXCLUDED.peer_group,
        ratios = EXCLUDED.ratios,
        ratio_codes = EXCLUDED.ratio_codes,
        raw_json = EXCLUDED.raw_json,
        source_file = EXCLUDED.source_file,
        source_url = EXCLUDED.source_url,
        agent_run_id = EXCLUDED.agent_run_id,
        fetched_at = NOW()
      RETURNING 1
    `;
    written += [...(result as unknown as unknown[])].length;
  }
  return written;
}

async function writeAverages(db: RegistryDb, reportDate: string, averages: UbprPeerAverage[], runId: number | null): Promise<number> {
  if (averages.length === 0) return 0;
  const payload = JSON.stringify(
    averages.map((a) => ({
      peer_group: a.peerGroup,
      ratio_key: a.key,
      ratio_code: a.code,
      ratio_description: a.description,
      value: a.value,
      source_file: a.file,
      raw_json: a.raw,
    })),
  );
  const result = await db`
    INSERT INTO ubpr_peer_group_averages
      (report_date, peer_group, ratio_key, ratio_code, ratio_description, value, source_file, raw_json, source_url, agent_run_id, fetched_at)
    SELECT ${reportDate}::date, x.peer_group, x.ratio_key, x.ratio_code, x.ratio_description, x.value, x.source_file, x.raw_json,
           ${UBPR_BULK_URL}, ${runId}, NOW()
      FROM jsonb_to_recordset(${payload}::jsonb)
        AS x(peer_group text, ratio_key text, ratio_code text, ratio_description text, value numeric, source_file text, raw_json jsonb)
    ON CONFLICT (report_date, peer_group, ratio_key) DO UPDATE SET
      ratio_code = EXCLUDED.ratio_code,
      ratio_description = EXCLUDED.ratio_description,
      value = EXCLUDED.value,
      source_file = EXCLUDED.source_file,
      raw_json = EXCLUDED.raw_json,
      source_url = EXCLUDED.source_url,
      agent_run_id = EXCLUDED.agent_run_id,
      fetched_at = NOW()
    RETURNING 1
  `;
  return [...(result as unknown as unknown[])].length;
}

export async function runRegistryUbprPeerGroups(options: RegistryUbprPeerGroupsOptions): Promise<RegistryUbprPeerGroupsResult> {
  const db = options.db ?? sql;
  const dryRun = Boolean(options.dryRun);
  const quarter = parseQuarterKey(options.partitionKey);
  if (!quarter) throw new Error(`Invalid UBPR quarter partition: ${options.partitionKey}`);
  const reportDate = quarterEndDate(quarter);
  const now = options.now ?? new Date();

  const ratioDownload = await fetchUbprBulk(quarter, UBPR_RATIO_PRODUCT, options.fetchOptions);
  const banksRead = ratioDownload.zip ? readUbprBanks(ratioDownload.zip) : null;
  const banks = banksRead?.banks ?? [];
  const loadedRatios = banksRead ? loadedKeys(banksRead.columns) : [];
  const peerLoaded = banksRead ? loadedKeys([banksRead.peerGroupColumn]).length > 0 : false;

  // The peer statistics product is optional: its absence leaves averages empty, not the partition.
  const statsDownload = ratioDownload.zip ? await fetchUbprBulk(quarter, UBPR_STATS_PRODUCT, options.fetchOptions) : null;
  const avgRead = statsDownload?.zip ? readUbprPeerAverages(statsDownload.zip, quarter) : null;
  const averages = avgRead?.averages ?? [];
  const averagesEmptyReason = !statsDownload
    ? "UBPR ratio product not available, so peer statistics were not fetched"
    : statsDownload.missing === "product_not_listed"
      ? "No UBPR peer statistics product on the FFIEC bulk page"
      : statsDownload.missing === "period_not_listed"
        ? "The UBPR peer statistics product does not list this quarter"
        : avgRead && loadedKeys([avgRead.peerGroupColumn]).length === 0
          ? `No peer group column passed its description check in ${avgRead.files.join(", ") || "any file"}`
          : averages.length === 0
            ? "No peer-group average passed its checks"
            : null;

  const rssds = banks.map((b) => b.rssd);
  const matchedBanks = await countMatched(db, rssds);
  const cleaning = banksRead ? cleanUbpr(banksRead, averages, Math.max(0, rssds.length - matchedBanks)) : null;

  const emptyReason =
    ratioDownload.missing === "product_not_listed"
      ? `No "UBPR Ratio -- Single Period" product on the FFIEC bulk page (products listed: ${ratioDownload.productLabels.join("; ") || "none"})`
      : ratioDownload.missing === "period_not_listed"
        ? "FFIEC does not list this UBPR quarter yet"
        : ratioDownload.missing === "format_not_served"
          ? `FFIEC answered the tab-delimited "${ratioDownload.productLabel ?? "UBPR ratio"}" download for ${reportDate} with its form page and no message; ` +
            `it serves this product only as XBRL (#${FORMAT_NOT_SERVED_ISSUE})`
        : !peerLoaded && loadedRatios.length === 0
          ? `No peer group or ratio column passed its description check (files kept: ${banksRead?.files.join(", ") || "none"})`
          : null;

  const base: RegistryUbprPeerGroupsResult = {
    source: UBPR_PEER_GROUPS_SOURCE,
    partitionKey: options.partitionKey,
    reportDate,
    sourceUrl: UBPR_BULK_URL,
    fileName: ratioDownload.fileName,
    statsFileName: statsDownload?.fileName ?? null,
    banks: banks.length,
    banksWithPeerGroup: banks.filter((b) => b.peerGroup !== null).length,
    matchedBanks,
    unmatchedBanks: Math.max(0, rssds.length - matchedBanks),
    peerGroups: new Set(banks.map((b) => b.peerGroup).filter((g) => g !== null)).size,
    peerAverages: averages.length,
    writtenBankRows: 0,
    writtenAverageRows: 0,
    peerGroupColumn: banksRead?.peerGroupColumn ?? null,
    loadedRatios,
    missingRatios: (banksRead?.columns ?? []).filter((c) => !loadedRatios.includes(c.key)),
    averagesLoadedRatios: avgRead ? [...new Set(averages.map((a) => a.key))] : [],
    averagesEmptyReason,
    cleaning,
    dryRun,
    empty: emptyReason !== null,
    emptyReason,
  };
  if (dryRun) return base;

  const detail = {
    parser_version: UBPR_PEER_GROUPS_PARSER_VERSION,
    report_date: reportDate,
    ratio_product: ratioDownload.productLabel,
    stats_product: statsDownload?.productLabel ?? null,
    product_labels: ratioDownload.productLabels,
    file: ratioDownload.fileName,
    stats_file: statsDownload?.fileName ?? null,
    zip_files: ratioDownload.zip?.names ?? [],
    kept_files: banksRead?.files ?? [],
    stats_zip_files: statsDownload?.zip?.names ?? [],
    peer_group_column: base.peerGroupColumn,
    columns: banksRead?.columns ?? [],
    loaded_ratios: loadedRatios,
    missing_ratios: base.missingRatios,
    unparseable_cells: banksRead?.unparseableCells ?? 0,
    averages: avgRead
      ? {
          peer_group_column: avgRead.peerGroupColumn,
          columns: avgRead.columns,
          period_column: avgRead.periodColumn,
          statistic_column: avgRead.statisticColumn,
          rows_other_period: avgRead.rowsOtherPeriod,
          rows_other_statistic: avgRead.rowsOtherStatistic,
          duplicate_peer_groups: avgRead.duplicatePeerGroups,
          unparseable_cells: avgRead.unparseableCells,
          values: averages.length,
        }
      : null,
    averages_empty_reason: averagesEmptyReason,
    cleaning,
  };

  if (emptyReason !== null) {
    await recordRegistryPartition(db, {
      source: UBPR_PEER_GROUPS_SOURCE,
      partitionKey: options.partitionKey,
      status: "empty",
      rowCount: 0,
      sourceUrl: UBPR_BULK_URL,
      runId: options.runId ?? null,
      nextAttemptAfterHours: ratioDownload.zip
        ? ffiecRefreshHours(quarter, now)
        : ratioDownload.missing === "format_not_served" ? FORMAT_NOT_SERVED_RETRY_HOURS : EMPTY_RETRY_HOURS,
      detail: {
        ...detail,
        reason: emptyReason,
        ...(ratioDownload.missing === "format_not_served"
          ? { missing_source: { host: "cdr.ffiec.gov", url: UBPR_BULK_URL, page: ratioDownload.answeredPage ?? null, issue: FORMAT_NOT_SERVED_ISSUE } }
          : {}),
      },
    });
    return base;
  }

  const runId = options.runId ?? null;
  const writtenBankRows = await writeBanks(db, reportDate, banks, ratioDownload.fileName, runId);
  const writtenAverageRows = await writeAverages(db, reportDate, averages, runId);
  await recordRegistryPartition(db, {
    source: UBPR_PEER_GROUPS_SOURCE,
    partitionKey: options.partitionKey,
    status: "succeeded",
    rowCount: banks.length + averages.length,
    matchedCount: matchedBanks,
    unmatchedCount: base.unmatchedBanks,
    insertedCount: writtenBankRows + writtenAverageRows,
    sourceUrl: UBPR_BULK_URL,
    runId,
    nextAttemptAfterHours: ffiecRefreshHours(quarter, now),
    detail: { ...detail, banks: banks.length, matched_banks: matchedBanks, written_bank_rows: writtenBankRows, written_average_rows: writtenAverageRows },
  });
  return { ...base, writtenBankRows, writtenAverageRows };
}
