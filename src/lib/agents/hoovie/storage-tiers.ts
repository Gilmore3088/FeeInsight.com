import { callItemFactsRelation } from "@/lib/data-store/call-item-storage";
import { CALL_PERIOD_PRUNE_LIVE, CALL_PERIOD_RESTORE_TARGET, pruneCallPeriod, restoreCallPeriod } from "./call-period-prune";
import type { sql } from "@/lib/data-store/connection";
import { inSavepoint } from "@/lib/agents/savepoint";
import { STORAGE_STEP_KEY } from "@/lib/agents/atlas/storage-retention";
import { COLD_FORMAT, ColdFileWriter, coldObjectKey, decodeColdFile, getColdStore, type ColdStore } from "./cold-files";

type SqlTag = typeof sql;

/**
 * Storage tiers for public data (#1870). Hot data stays in Postgres: the newest periods Hamilton
 * and the pages read. Older periods can be written to compressed files in R2 (`cold-files.ts`),
 * with one index row each in `public_data_cold_files`, and read back on demand by the data
 * catalog (`src/lib/data-catalog/cold-reads.ts`).
 *
 * Runs inside Atlas's daily storage step (`atlas-storage-retention`), on that step's one
 * connection and transaction, with a 10 s statement timeout. Every day it lists each tiered
 * table's periods (a loose index scan), counts the rows of at most `PLAN_COUNTS_PER_RUN` cold
 * periods it has not counted yet (counts carry over from the last run, so the full dry-run count
 * builds up over a few days without a heavy scan), and estimates the size a prune would free.
 *
 * Two things stay off:
 * - Export (`COLD_EXPORT_LIVE`): writing a cold period to R2 and its index row. Writes no
 *   existing row. Turned on by a later PR once James says yes.
 * - Pruning: `call-period-prune.ts` compares the current period to its verified file before an
 *   atomic removal. This production data change remains off pending a reviewed manifest and
 *   restore/consumer acceptance. Readers use a file only once its index row has `pruned_at` set.
 */

/** Turns on by PR, after James's yes. While false, nothing is written to R2 or the index table. */
export const COLD_EXPORT_LIVE = false;

export interface ColdTierPolicy {
  table: string;
  /** Row sources in the table, each tiered on its own periods. */
  sources: readonly string[];
  /** Newest periods per source that stay hot in Postgres. */
  hotPeriods: number;
  why: string;
}

/**
 * What stays hot, per table. Only tables listed here are tiered; every other public-data table
 * stays wholly in Postgres.
 */
export const COLD_TIER_POLICY: readonly ColdTierPolicy[] = [
  {
    table: "institution_call_report_items",
    sources: ["ffiec", "ncua"],
    // Three years of quarters: the newest quarter that the peer, cost-of-deposits and account-size
    // reads use, plus year-over-year and the twelve-quarter CFO view for Hamilton's series.
    hotPeriods: 12,
    why: "About 3.6 GB and 8.7 million rows on Oct 17, 2026, almost all of it back-filled history.",
  },
];

/**
 * Public-data tables deliberately not tiered yet, with the reason. area_statistics (about 1 GB)
 * mixes 29 sources with periods in three shapes (year, quarter, month), carries struck-row rules
 * that its readers apply in SQL, and is read by most catalog queries; tiering it needs its own
 * per-source policy.
 */
export const NOT_TIERED_YET: Readonly<Record<string, string>> = {
  area_statistics: "29 sources with year, quarter and month periods and struck-row rules; needs a per-source policy first",
};

export const COLD_STATEMENT_TIMEOUT = "10s";
/** The export reads a whole period through a cursor, so it gets longer than the plan's statements. */
export const EXPORT_STATEMENT_TIMEOUT = "120s";
/** Cold periods counted per run; counts carry over between runs. */
export const PLAN_COUNTS_PER_RUN = 2;
/** Cold periods exported per run while the export is on. */
export const EXPORT_PARTITIONS_PER_RUN = 1;
/** Rows fetched per cursor batch during an export. */
export const EXPORT_CURSOR_ROWS = 5_000;

export const CALL_ITEM_COLUMNS = [
  "id",
  "institution_id",
  "source",
  "report_date",
  "item_code",
  "item_key",
  "item_description",
  "schedule",
  "value",
  "unit",
  "period_basis",
  "source_url",
  "agent_run_id",
  "fetched_at",
] as const;

export type ColdFileState = "none" | "written" | "verified" | "pruned";

export interface ColdPartition {
  source: string;
  period: string;
  /** Rows in Postgres for this period; null until counted. */
  rows: number | null;
  file: ColdFileState;
}

export interface ColdTierTable {
  table: string;
  hotPeriods: number;
  /** Periods that stay hot, per source. */
  hot: Record<string, string[]>;
  cold: ColdPartition[];
  /** Rows counted so far across the cold periods. */
  countedRows: number;
  /** Cold periods not counted yet. */
  uncounted: number;
  /** Average bytes a row takes in Postgres (table, indexes and TOAST over the row estimate). */
  avgRowBytes: number | null;
  /** countedRows x avgRowBytes, in MB: about what a prune of the counted periods would free. */
  estimatedMbFreed: number | null;
}

export interface ColdExportResult {
  table: string;
  source: string;
  period: string;
  status: "exported" | "failed";
  rowCount?: number;
  byteSize?: number;
  objectKey?: string;
  error?: string;
}

export interface ColdTierResult {
  exportLive: boolean;
  storeConfigured: boolean;
  /** False until the public_data_cold_files migration is applied. */
  indexReady: boolean;
  tables: ColdTierTable[];
  exported: ColdExportResult[];
  pruned?: Array<{ source: string; period: string; deleted: number; status: string }>;
  restored?: { source: string; period: string; rows: number };
  /** "source|period" -> rows, carried to the next run. */
  counts: Record<string, number>;
  error?: string;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300);
const countKey = (table: string, source: string, period: string) => `${table}|${source}|${period}`;
const num = (value: unknown) => (value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value));

/** Pure: newest-first periods split into the hot ones and the cold ones. */
export function splitHotCold(periodsNewestFirst: readonly string[], hotPeriods: number): { hot: string[]; cold: string[] } {
  const sorted = [...new Set(periodsNewestFirst)].sort().reverse();
  return { hot: sorted.slice(0, hotPeriods), cold: sorted.slice(hotPeriods) };
}

/** Every report date a source has, newest first: a loose index scan over (source, report_date). */
async function callReportDates(db: SqlTag, source: string): Promise<string[]> {
  const rows = await db<{ period: string }[]>`
    WITH RECURSIVE d AS (
      SELECT max(report_date) AS report_date FROM institution_call_report_items WHERE source = ${source}
      UNION ALL
      SELECT (SELECT max(i.report_date) FROM institution_call_report_items i
               WHERE i.source = ${source} AND i.report_date < d.report_date)
        FROM d
       WHERE d.report_date IS NOT NULL
    )
    SELECT report_date::text AS period FROM d WHERE report_date IS NOT NULL
  `;
  return rows.map((row) => row.period);
}

async function averageRowBytes(db: SqlTag, table: string): Promise<number | null> {
  const [row] = await db<{ bytes: string | null; tuples: string | null }[]>`
    SELECT pg_total_relation_size(c.oid)::bigint AS bytes, c.reltuples::bigint AS tuples
      FROM pg_class c
     WHERE c.oid = to_regclass('public.' || ${table})
  `;
  const bytes = num(row?.bytes);
  const tuples = num(row?.tuples);
  if (bytes == null || tuples == null || tuples <= 0) return null;
  return Math.round(bytes / tuples);
}

interface FileRow {
  table_name: string;
  source: string;
  period: string;
  row_count: string | number;
  verified_at: unknown;
  pruned_at: unknown;
}

/** The index rows for these tables, or null when the index table does not exist yet. */
async function readIndex(db: SqlTag, tables: string[]): Promise<FileRow[] | null> {
  const [ready] = await db<{ ready: boolean }[]>`SELECT to_regclass('public.public_data_cold_files') IS NOT NULL AS ready`;
  if (!ready?.ready) return null;
  return [
    ...(await db<FileRow[]>`
      SELECT table_name, source, period, row_count, verified_at, pruned_at
        FROM public_data_cold_files
       WHERE table_name = ANY(${tables}::text[])
    `),
  ];
}

async function countCallPeriod(db: SqlTag, source: string, period: string): Promise<number> {
  const [row] = await db<{ n: string }[]>`
    SELECT count(*)::bigint AS n FROM institution_call_report_items
     WHERE source = ${source} AND report_date = ${period}::date
  `;
  return Number(row?.n ?? 0);
}

/** Counts carried from the last storage-step run. */
async function previousCounts(db: SqlTag): Promise<Record<string, number>> {
  const [row] = await db<{ counts: unknown }[]>`
    SELECT e.detail->'cold_tier'->'counts' AS counts
      FROM agent_run_events e
      JOIN agent_run_steps s ON s.id = e.step_id
     WHERE s.step_key = ${STORAGE_STEP_KEY}
       AND e.event_type = 'step.finished'
       AND e.status = 'completed'
       AND jsonb_typeof(e.detail->'cold_tier'->'counts') = 'object'
     ORDER BY e.created_at DESC, e.id DESC
     LIMIT 1
  `;
  const raw = typeof row?.counts === "string" ? JSON.parse(row.counts) : row?.counts;
  const counts: Record<string, number> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const n = num(value);
      if (n != null) counts[key] = n;
    }
  }
  return counts;
}

function fileState(row: FileRow | undefined): ColdFileState {
  if (!row) return "none";
  if (row.pruned_at) return "pruned";
  if (row.verified_at) return "verified";
  return "written";
}

async function withTimeout<T>(db: SqlTag, timeout: string, work: (scope: SqlTag) => Promise<T>): Promise<T> {
  return inSavepoint(db, async (scope) => {
    const [prior] = await scope<{ value: string | null }[]>`
      SELECT current_setting('statement_timeout') AS value, set_config('statement_timeout', ${timeout}, true) AS applied
    `;
    // On failure the savepoint rolls back, which also undoes the timeout; restore only on success.
    const value = await work(scope);
    if (prior?.value != null) await scope`SELECT set_config('statement_timeout', ${prior.value}, true)`;
    return value;
  });
}

/**
 * Writes one call-report period to a cold file, reads it back to check the checksum and row count,
 * then records the index row as verified. Reads the period through a cursor; changes no existing row.
 */
export async function exportCallPeriod(
  db: SqlTag,
  store: ColdStore,
  args: { source: string; period: string; avgRowBytes: number | null; runId?: number | null },
): Promise<ColdExportResult> {
  const table = "institution_call_report_items";
  const base = { table, source: args.source, period: args.period };
  if (!store.configured) return { ...base, status: "failed", error: "R2 is not configured" };
  try {
    return await withTimeout(db, EXPORT_STATEMENT_TIMEOUT, async (scope) => {
      const writer = new ColdFileWriter(CALL_ITEM_COLUMNS);
      const query = scope<Array<Record<string, unknown>>>`
        SELECT id::text AS id, institution_id::text AS institution_id, source, report_date::text AS report_date,
               item_code, item_key, item_description, schedule, value::text AS value, unit, period_basis,
               source_url, agent_run_id::text AS agent_run_id,
               to_char(fetched_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS fetched_at
          FROM ${scope.unsafe(await callItemFactsRelation(scope))}
         WHERE source = ${args.source} AND report_date = ${args.period}::date
         ORDER BY id
      `;
      for await (const batch of query.cursor(EXPORT_CURSOR_ROWS)) writer.push(batch);
      const file = writer.finish();
      const objectKey = coldObjectKey(table, args.source, `${args.period}.${file.sha256}`);
      await store.put(objectKey, file.bytes);
      decodeColdFile(await store.get(objectKey), { expected: { sha256: file.sha256, rowCount: file.rowCount }, lineFilter: () => false });
      const indexed = await scope`
        INSERT INTO public_data_cold_files
          (table_name, source, period, bucket, object_key, format, columns, row_count, byte_size, sha256,
           hot_bytes_estimate, agent_run_id, verified_at)
        VALUES (${table}, ${args.source}, ${args.period}, ${store.bucket}, ${objectKey}, ${COLD_FORMAT},
                ${[...CALL_ITEM_COLUMNS]}::text[], ${file.rowCount}, ${file.bytes.length}, ${file.sha256},
                ${args.avgRowBytes == null ? null : args.avgRowBytes * file.rowCount}, ${args.runId ?? null}, NOW())
        ON CONFLICT (table_name, source, period) DO UPDATE
          SET bucket = EXCLUDED.bucket, object_key = EXCLUDED.object_key, columns = EXCLUDED.columns,
              row_count = EXCLUDED.row_count, byte_size = EXCLUDED.byte_size, sha256 = EXCLUDED.sha256,
              hot_bytes_estimate = EXCLUDED.hot_bytes_estimate, agent_run_id = EXCLUDED.agent_run_id,
              written_at = NOW(), verified_at = NOW()
          WHERE public_data_cold_files.pruned_at IS NULL
        RETURNING id
      `;
      if (indexed.length !== 1) throw new Error("Archive index changed or the period was already pruned; existing archive kept");
      return { ...base, status: "exported" as const, rowCount: file.rowCount, byteSize: file.bytes.length, objectKey };
    });
  } catch (error) {
    return { ...base, status: "failed", error: message(error) };
  }
}

/**
 * The daily plan: which periods are cold, their row counts so far and the size a prune would
 * free. Export and atomic pruning require their separate switches. Default operation is read-only.
 */
export async function runColdTier(
  options: { db: SqlTag; dryRun?: boolean; exportLive?: boolean; pruneLive?: boolean; restore?: { source: "ffiec" | "ncua"; period: string }; store?: ColdStore; runId?: number | null },
): Promise<ColdTierResult> {
  const { db } = options;
  const store = options.store ?? getColdStore();
  const exportLive = !options.dryRun && (options.exportLive ?? COLD_EXPORT_LIVE);
  const result: ColdTierResult = { exportLive, storeConfigured: store.configured, indexReady: false, tables: [], exported: [], counts: {} };
  try {
    await withTimeout(db, COLD_STATEMENT_TIMEOUT, async (scope) => {
      const index = await inSavepoint(scope, (s) => readIndex(s, COLD_TIER_POLICY.map((p) => p.table))).catch(() => null);
      result.indexReady = index != null;
      const files = new Map((index ?? []).map((row) => [countKey(row.table_name, row.source, row.period), row]));
      const prior = await inSavepoint(scope, previousCounts).catch(() => ({}) as Record<string, number>);
      let countBudget = PLAN_COUNTS_PER_RUN;

      for (const policy of COLD_TIER_POLICY) {
        const avgRowBytes = await inSavepoint(scope, (s) => averageRowBytes(s, policy.table)).catch(() => null);
        const hot: Record<string, string[]> = {};
        const cold: ColdPartition[] = [];
        for (const source of policy.sources) {
          const periods = await inSavepoint(scope, (s) => callReportDates(s, source));
          const split = splitHotCold(periods, policy.hotPeriods);
          hot[source] = split.hot;
          // Oldest first, so counting and export start with the oldest quarters.
          for (const period of [...split.cold].reverse()) {
            const key = countKey(policy.table, source, period);
            const file = files.get(key);
            let rows: number | null = file ? Number(file.row_count) : (prior[key] ?? null);
            if (rows == null && countBudget > 0) {
              countBudget -= 1;
              rows = await inSavepoint(scope, (s) => countCallPeriod(s, source, period)).catch(() => null);
            }
            if (rows != null) result.counts[key] = rows;
            cold.push({ source, period, rows, file: fileState(file) });
          }
        }
        const countedRows = cold.filter((p) => p.file !== "pruned").reduce((sum, p) => sum + (p.rows ?? 0), 0);
        result.tables.push({
          table: policy.table,
          hotPeriods: policy.hotPeriods,
          hot,
          cold,
          countedRows,
          uncounted: cold.filter((p) => p.rows == null).length,
          avgRowBytes,
          estimatedMbFreed: avgRowBytes == null ? null : Math.round((countedRows * avgRowBytes) / 1_048_576),
        });
      }
    });
  } catch (error) {
    result.error = message(error);
    return result;
  }

  const restoreTarget = options.restore ?? CALL_PERIOD_RESTORE_TARGET;
  if (!options.dryRun && restoreTarget && result.indexReady) {
    try {
      const rows = await inSavepoint(db, (scope) => restoreCallPeriod(scope, store, restoreTarget));
      result.restored = { ...restoreTarget, rows };
      for (const table of result.tables) for (const period of table.cold) {
        if (period.source === restoreTarget.source && period.period === restoreTarget.period) period.file = "verified";
      }
    } catch (error) { result.error = `Archive restore held: ${message(error)}`; }
    return result; // A rollback step never exports or prunes in the same pass.
  }
  if (exportLive && result.indexReady) {
    for (const table of result.tables) {
      const next = table.cold.filter((p) => p.file === "none").slice(0, EXPORT_PARTITIONS_PER_RUN);
      for (const partition of next) {
        const exported = await exportCallPeriod(db, store, { source: partition.source, period: partition.period, avgRowBytes: table.avgRowBytes, runId: options.runId });
        result.exported.push(exported);
        if (exported.status === "exported") partition.file = "verified";
      }
    }
  }
  if (!options.dryRun && (options.pruneLive ?? CALL_PERIOD_PRUNE_LIVE) && result.indexReady) {
    const next = result.tables.flatMap((t) => t.cold).find((p) => p.file === "verified");
    if (next && (next.source === "ffiec" || next.source === "ncua")) {
      try {
        const receipt = await inSavepoint(db, (scope) => pruneCallPeriod(scope, store, { source: next.source as "ffiec" | "ncua", period: next.period }));
        result.pruned = [{ source: next.source, period: next.period, ...receipt }];
      } catch (error) { result.error = `Archive prune held: ${message(error)}`; }
    }
  }
  return result;
}

export function coldTierDetail(result: ColdTierResult): Record<string, unknown> {
  return {
    export_live: result.exportLive,
    store_configured: result.storeConfigured,
    index_ready: result.indexReady,
    prune: CALL_PERIOD_PRUNE_LIVE ? "enabled" : "implemented; off pending reviewed rollout",
    pruned: result.pruned ?? [],
    restored: result.restored ?? null,
    counts: result.counts,
    tables: result.tables.map((t) => ({
      table: t.table,
      hot_periods: t.hotPeriods,
      hot: t.hot,
      cold_periods: t.cold.length,
      counted_rows: t.countedRows,
      uncounted_periods: t.uncounted,
      avg_row_bytes: t.avgRowBytes,
      estimated_mb_freed: t.estimatedMbFreed,
      files: {
        verified: t.cold.filter((p) => p.file === "verified").length,
        written: t.cold.filter((p) => p.file === "written").length,
        pruned: t.cold.filter((p) => p.file === "pruned").length,
      },
    })),
    exported: result.exported.map((e) => ({
      table: e.table,
      source: e.source,
      period: e.period,
      status: e.status,
      ...(e.rowCount != null ? { row_count: e.rowCount, byte_size: e.byteSize, object_key: e.objectKey } : {}),
      ...(e.error ? { error: e.error } : {}),
    })),
    not_tiered: NOT_TIERED_YET,
    ...(result.error ? { error: result.error } : {}),
  };
}

export function summarizeColdTier(result: ColdTierResult): string {
  if (result.error) return `Cold tier: could not plan (${result.error}).`;
  const parts = result.tables.map((t) => {
    const counted = t.cold.length - t.uncounted;
    const size = t.estimatedMbFreed == null ? "" : ` (about ${t.estimatedMbFreed.toLocaleString("en-US")} MB)`;
    const rest = t.uncounted > 0 ? `, ${t.uncounted} not counted yet` : "";
    return `${t.table}: ${t.cold.length} periods older than the newest ${t.hotPeriods} per source; ${t.countedRows.toLocaleString("en-US")} rows in ${counted} counted${size}${rest}`;
  });
  const exported = result.exported.length > 0
    ? ` Exported: ${result.exported.map((e) => `${e.source} ${e.period} ${e.status === "exported" ? `${(e.rowCount ?? 0).toLocaleString("en-US")} rows` : `failed (${e.error})`}`).join("; ")}.`
    : "";
  const index = result.indexReady ? "" : " The cold-file index table is not migrated yet.";
  return `Cold tier: ${parts.join("; ")}. Export ${result.exportLive ? "on" : "off"}; pruning waits for James's yes.${exported}${index}`;
}
