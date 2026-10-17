import { sql } from "@/lib/data-store/connection";
import { inSavepoint } from "@/lib/agents/savepoint";

type SqlTag = typeof sql;

/**
 * Atlas's storage watch and retention: the database's size measured every day, and three trims of
 * log history, each switched off until James says yes.
 *
 * Why: on Oct 17, 2026 Supabase grew the disk from 8 GB to 12 GB. Measured that day, the database
 * held 6.3 GB: about 3 GB of real data (financials, branches, call reports, fees) and about 2.5 GB
 * of the pipeline's own history, which nothing ever trimmed. `pipeline_attempts` alone was 1.35 GB
 * and 2.3 million rows in 15 days (about 110,000 rows a day after the first week's backfill).
 *
 * A step in Atlas's daily scoreboard run. Every day it records the database size, the largest
 * tables and the growth since the last run, and counts what each trim would remove. A trim deletes
 * only while its switch below is true, and at most `DELETE_BATCH` rows a run, so a day's work stays
 * small. Fees are never in scope: the fee tiers, takedowns and every audit record stay. The disk
 * does not shrink when rows go; the freed space is reused, which is what stops the growth.
 *
 * The trims:
 * 1. `legacy_event_log`: rows of the retired `agent_events` log older than 60 days (about 420 MB on
 *    Oct 17, all in the April-August partitions). Its only reader looks at the last 24 hours.
 * 2. `run_events`: run-ledger events older than 90 days, except the newest event of each kind for
 *    each step (several steps read their last cursor or last result from it) and any event that
 *    recorded a cost.
 * 3. `attempt_repeats`: exact repeats in the attempt log. In the extract, verify and publish stages
 *    only, a row older than 30 days is removed when a row identical in every field but its time
 *    (institution, document, stage, strategy, version, fingerprint, outcome, yield, cost, detail)
 *    exists both before and after it. The first and last copy of every run of identical rows stay,
 *    so "already tried at this version", "first decided" and "latest outcome" read the same. The
 *    discover, fetch and read stages are left whole because their readers count misses and
 *    retries. The 30-day floor clears the longest count window in those three stages (the
 *    scoreboard's 30 days); state outliers read 90 days but take the newest row per fee, which
 *    stays. Read in a rolling window of `ATTEMPT_WINDOW` ids per run.
 */

export const STORAGE_STEP_KEY = "atlas-storage-retention";

/** Each switch turns on by PR, only after James's typed yes naming that trim. */
export const RETENTION_LIVE = {
  legacy_event_log: false,
  run_events: false,
  attempt_repeats: false,
} as const;

export type RetentionPolicy = keyof typeof RETENTION_LIVE;

export const LEGACY_EVENT_LOG_DAYS = 60;
export const RUN_EVENTS_DAYS = 90;
export const ATTEMPT_REPEAT_DAYS = 30;
/** Stages whose readers never count identical repeats (see the module note). */
export const ATTEMPT_REPEAT_STAGES = ["extract", "verify", "publish"] as const;
/** Attempt-log rows read per run for repeats, in id order from the last run's cursor. */
export const ATTEMPT_WINDOW = 200_000;
/** Most rows one trim deletes in one run. */
export const DELETE_BATCH = 20_000;
/** A size above this, or a day's growth above `STORAGE_ALERT_GROWTH_MB`, is flagged in the summary. */
export const STORAGE_ALERT_MB = 9_000;
export const STORAGE_ALERT_GROWTH_MB = 300;
const LISTED_TABLES = 12;

export interface TableSize {
  table: string;
  totalMb: number;
  rows: number;
}

export interface TrimResult {
  policy: RetentionPolicy;
  live: boolean;
  /** Rows the trim would remove (for attempt repeats, within this run's window). Null when the count failed. */
  eligible: number | null;
  deleted: number;
  error?: string;
}

export interface StorageResult {
  dryRun: boolean;
  databaseMb: number | null;
  previousMb: number | null;
  previousAt: string | null;
  growthMb: number | null;
  tables: TableSize[];
  alerts: string[];
  trims: TrimResult[];
  /** The attempt-log window this run read, and where the next run starts. */
  attemptWindow: { afterId: number; throughId: number | null; nextAfterId: number } | null;
}

const mb = (bytes: unknown) => Math.round((Number(bytes ?? 0) / 1_048_576) * 10) / 10;
const num = (value: unknown) => (value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value));
const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300);

async function measure(db: SqlTag): Promise<{ databaseMb: number | null; tables: TableSize[] }> {
  const [size] = await db<{ bytes: string }[]>`SELECT pg_database_size(current_database())::bigint AS bytes`;
  const rows = await db<{ relname: string; bytes: string; n_live_tup: string }[]>`
    SELECT relname, pg_total_relation_size(relid)::bigint AS bytes, n_live_tup::bigint AS n_live_tup
      FROM pg_stat_user_tables
     ORDER BY pg_total_relation_size(relid) DESC
     LIMIT ${LISTED_TABLES}
  `;
  return {
    databaseMb: size ? mb(size.bytes) : null,
    tables: rows.map((row) => ({ table: row.relname, totalMb: mb(row.bytes), rows: Number(row.n_live_tup) })),
  };
}

/** The last completed run of this step: its measured size and attempt-log cursor. */
async function previousRun(db: SqlTag): Promise<{ databaseMb: number | null; at: string | null; nextAfterId: number }> {
  const [row] = await db<{ database_mb: string | null; next_after_id: string | null; created_at: Date | string }[]>`
    SELECT e.detail->>'database_mb' AS database_mb,
           e.detail->'attempt_window'->>'next_after_id' AS next_after_id,
           e.created_at
      FROM agent_run_events e
      JOIN agent_run_steps s ON s.id = e.step_id
     WHERE s.step_key = ${STORAGE_STEP_KEY}
       AND e.event_type = 'step.finished'
       AND e.status = 'completed'
     ORDER BY e.created_at DESC, e.id DESC
     LIMIT 1
  `;
  if (!row) return { databaseMb: null, at: null, nextAfterId: 0 };
  const at = row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at);
  return { databaseMb: num(row.database_mb), at, nextAfterId: num(row.next_after_id) ?? 0 };
}

async function trimLegacyEventLog(db: SqlTag, live: boolean): Promise<TrimResult> {
  const [row] = await db<{ n: string }[]>`
    SELECT count(*)::bigint AS n FROM agent_events
     WHERE created_at < NOW() - make_interval(days => ${LEGACY_EVENT_LOG_DAYS}::int)
  `;
  let deleted = 0;
  if (live) {
    const gone = await db<{ event_id: string }[]>`
      DELETE FROM agent_events
       WHERE (event_id, created_at) IN (
         SELECT event_id, created_at FROM agent_events
          WHERE created_at < NOW() - make_interval(days => ${LEGACY_EVENT_LOG_DAYS}::int)
          ORDER BY created_at
          LIMIT ${DELETE_BATCH}
       )
      RETURNING event_id
    `;
    deleted = gone.length;
  }
  return { policy: "legacy_event_log", live, eligible: Number(row?.n ?? 0), deleted };
}

/**
 * Old run events, minus the newest of each kind per step and any that carried a cost. The same
 * condition is written into the count and the delete below.
 */
async function trimRunEvents(db: SqlTag, live: boolean): Promise<TrimResult> {
  const [row] = await db<{ n: string }[]>`
    SELECT count(*)::bigint AS n
      FROM agent_run_events e
      LEFT JOIN agent_run_steps s ON s.id = e.step_id
     WHERE e.created_at < NOW() - make_interval(days => ${RUN_EVENTS_DAYS}::int)
       AND e.cost_microusd = 0
       AND EXISTS (
         SELECT 1 FROM agent_run_events newer
           LEFT JOIN agent_run_steps ns ON ns.id = newer.step_id
          WHERE newer.event_type = e.event_type
            AND ns.step_key IS NOT DISTINCT FROM s.step_key
            AND newer.created_at > e.created_at
       )
  `;
  let deleted = 0;
  if (live) {
    const gone = await db<{ id: string }[]>`
      DELETE FROM agent_run_events
       WHERE id IN (
         SELECT e.id
           FROM agent_run_events e
           LEFT JOIN agent_run_steps s ON s.id = e.step_id
          WHERE e.created_at < NOW() - make_interval(days => ${RUN_EVENTS_DAYS}::int)
            AND e.cost_microusd = 0
            AND EXISTS (
              SELECT 1 FROM agent_run_events newer
                LEFT JOIN agent_run_steps ns ON ns.id = newer.step_id
               WHERE newer.event_type = e.event_type
                 AND ns.step_key IS NOT DISTINCT FROM s.step_key
                 AND newer.created_at > e.created_at
            )
          ORDER BY e.id
          LIMIT ${DELETE_BATCH}
       )
      RETURNING id
    `;
    deleted = gone.length;
  }
  return { policy: "run_events", live, eligible: Number(row?.n ?? 0), deleted };
}

async function trimAttemptRepeats(
  db: SqlTag,
  live: boolean,
  afterId: number,
): Promise<{ trim: TrimResult; window: NonNullable<StorageResult["attemptWindow"]> }> {
  const stages = [...ATTEMPT_REPEAT_STAGES];
  const [row] = await db<{ read: string; through_id: string | null; repeats: string }[]>`
    WITH win AS (
      SELECT * FROM pipeline_attempts
       WHERE id > ${afterId}
         AND stage = ANY(${stages}::text[])
         AND created_at < NOW() - make_interval(days => ${ATTEMPT_REPEAT_DAYS}::int)
       ORDER BY id
       LIMIT ${ATTEMPT_WINDOW}
    )
    SELECT count(*)::bigint AS read,
           max(win.id)::bigint AS through_id,
           count(*) FILTER (WHERE
             EXISTS (SELECT 1 FROM pipeline_attempts twin
                      WHERE twin.institution_id IS NOT DISTINCT FROM win.institution_id
                        AND twin.stage = win.stage
                        AND twin.created_at < win.created_at
                        AND twin.source_document_id IS NOT DISTINCT FROM win.source_document_id
                        AND twin.strategy = win.strategy
                        AND twin.strategy_version = win.strategy_version
                        AND twin.input_fingerprint IS NOT DISTINCT FROM win.input_fingerprint
                        AND twin.outcome = win.outcome
                        AND twin.yield_count = win.yield_count
                        AND twin.cost_microusd = win.cost_microusd
                        AND twin.detail = win.detail)
             AND EXISTS (SELECT 1 FROM pipeline_attempts twin
                      WHERE twin.institution_id IS NOT DISTINCT FROM win.institution_id
                        AND twin.stage = win.stage
                        AND twin.created_at > win.created_at
                        AND twin.source_document_id IS NOT DISTINCT FROM win.source_document_id
                        AND twin.strategy = win.strategy
                        AND twin.strategy_version = win.strategy_version
                        AND twin.input_fingerprint IS NOT DISTINCT FROM win.input_fingerprint
                        AND twin.outcome = win.outcome
                        AND twin.yield_count = win.yield_count
                        AND twin.cost_microusd = win.cost_microusd
                        AND twin.detail = win.detail)
           )::bigint AS repeats
      FROM win
  `;
  const read = Number(row?.read ?? 0);
  const throughId = num(row?.through_id ?? null);
  // A full window moves on next run; a short one has reached the newest old row, so the sweep starts over.
  const nextAfterId = read >= ATTEMPT_WINDOW && throughId != null ? throughId : 0;
  let deleted = 0;
  if (live && Number(row?.repeats ?? 0) > 0 && throughId != null) {
    // The first and last copies are never in the set, so a row deleted here always keeps an older
    // and a newer twin; deleting within one statement cannot remove both ends of a run.
    const gone = await db<{ id: string }[]>`
      DELETE FROM pipeline_attempts pa
       WHERE pa.id IN (
         SELECT win.id FROM pipeline_attempts win
          WHERE win.id > ${afterId} AND win.id <= ${throughId}
            AND win.stage = ANY(${stages}::text[])
            AND win.created_at < NOW() - make_interval(days => ${ATTEMPT_REPEAT_DAYS}::int)
            AND EXISTS (SELECT 1 FROM pipeline_attempts twin
                         WHERE twin.institution_id IS NOT DISTINCT FROM win.institution_id
                           AND twin.stage = win.stage
                           AND twin.created_at < win.created_at
                           AND twin.source_document_id IS NOT DISTINCT FROM win.source_document_id
                           AND twin.strategy = win.strategy
                           AND twin.strategy_version = win.strategy_version
                           AND twin.input_fingerprint IS NOT DISTINCT FROM win.input_fingerprint
                           AND twin.outcome = win.outcome
                           AND twin.yield_count = win.yield_count
                           AND twin.cost_microusd = win.cost_microusd
                           AND twin.detail = win.detail)
            AND EXISTS (SELECT 1 FROM pipeline_attempts twin
                         WHERE twin.institution_id IS NOT DISTINCT FROM win.institution_id
                           AND twin.stage = win.stage
                           AND twin.created_at > win.created_at
                           AND twin.source_document_id IS NOT DISTINCT FROM win.source_document_id
                           AND twin.strategy = win.strategy
                           AND twin.strategy_version = win.strategy_version
                           AND twin.input_fingerprint IS NOT DISTINCT FROM win.input_fingerprint
                           AND twin.outcome = win.outcome
                           AND twin.yield_count = win.yield_count
                           AND twin.cost_microusd = win.cost_microusd
                           AND twin.detail = win.detail)
          ORDER BY win.id
          LIMIT ${DELETE_BATCH}
       )
      RETURNING pa.id
    `;
    deleted = gone.length;
  }
  return {
    trim: { policy: "attempt_repeats", live, eligible: Number(row?.repeats ?? 0), deleted },
    window: { afterId, throughId, nextAfterId },
  };
}

/** Pure: the summary's warnings for a size or a day's growth above the thresholds. */
export function storageAlerts(databaseMb: number | null, growthMb: number | null): string[] {
  const alerts: string[] = [];
  if (databaseMb != null && databaseMb > STORAGE_ALERT_MB) alerts.push(`database is ${databaseMb.toLocaleString("en-US")} MB, above ${STORAGE_ALERT_MB.toLocaleString("en-US")} MB`);
  if (growthMb != null && growthMb > STORAGE_ALERT_GROWTH_MB) alerts.push(`grew ${growthMb.toLocaleString("en-US")} MB since the last run, above ${STORAGE_ALERT_GROWTH_MB} MB`);
  return alerts;
}

/**
 * Measure, then count (and, where switched on, run) each trim. Never throws: a failed measurement
 * or trim is reported and the others still run, each in its own savepoint.
 */
export async function runStorageRetention(
  options: { db?: SqlTag; dryRun?: boolean; live?: Partial<Record<RetentionPolicy, boolean>> } = {},
): Promise<StorageResult> {
  const db = options.db ?? sql;
  const dryRun = Boolean(options.dryRun);
  const isLive = (policy: RetentionPolicy) => !dryRun && (options.live?.[policy] ?? RETENTION_LIVE[policy]);

  const sized = await inSavepoint(db, measure).catch(() => ({ databaseMb: null, tables: [] as TableSize[] }));
  const previous = await inSavepoint(db, previousRun).catch(() => ({ databaseMb: null, at: null, nextAfterId: 0 }));
  const growthMb = sized.databaseMb != null && previous.databaseMb != null
    ? Math.round((sized.databaseMb - previous.databaseMb) * 10) / 10
    : null;

  const trims: TrimResult[] = [];
  const failed = (policy: RetentionPolicy, error: unknown): TrimResult => ({ policy, live: isLive(policy), eligible: null, deleted: 0, error: message(error) });

  trims.push(await inSavepoint(db, (scope) => trimLegacyEventLog(scope, isLive("legacy_event_log"))).catch((error) => failed("legacy_event_log", error)));
  trims.push(await inSavepoint(db, (scope) => trimRunEvents(scope, isLive("run_events"))).catch((error) => failed("run_events", error)));
  let attemptWindow: StorageResult["attemptWindow"] = null;
  try {
    const repeats = await inSavepoint(db, (scope) => trimAttemptRepeats(scope, isLive("attempt_repeats"), previous.nextAfterId));
    trims.push(repeats.trim);
    attemptWindow = repeats.window;
  } catch (error) {
    trims.push(failed("attempt_repeats", error));
  }

  return {
    dryRun,
    databaseMb: sized.databaseMb,
    previousMb: previous.databaseMb,
    previousAt: previous.at,
    growthMb,
    tables: sized.tables,
    alerts: storageAlerts(sized.databaseMb, growthMb),
    trims,
    attemptWindow,
  };
}

export function storageRetentionDetail(result: StorageResult): Record<string, unknown> {
  return {
    dry_run: result.dryRun,
    database_mb: result.databaseMb,
    previous_mb: result.previousMb,
    previous_at: result.previousAt,
    growth_mb: result.growthMb,
    alerts: result.alerts,
    tables: result.tables.map((t) => ({ table: t.table, total_mb: t.totalMb, rows: t.rows })),
    trims: result.trims.map((t) => ({ policy: t.policy, live: t.live, eligible: t.eligible, deleted: t.deleted, ...(t.error ? { error: t.error } : {}) })),
    attempt_window: result.attemptWindow
      ? { after_id: result.attemptWindow.afterId, through_id: result.attemptWindow.throughId, next_after_id: result.attemptWindow.nextAfterId }
      : null,
  };
}

const TRIM_NAMES: Record<RetentionPolicy, string> = {
  legacy_event_log: "old rows of the retired event log",
  run_events: "run events over 90 days old",
  attempt_repeats: "exact repeats in the attempt log",
};

export function summarizeStorageRetention(result: StorageResult): string {
  const size = result.databaseMb == null
    ? "Atlas could not read the database size."
    : `Database ${result.databaseMb.toLocaleString("en-US")} MB${result.growthMb == null ? "" : ` (${result.growthMb >= 0 ? "+" : ""}${result.growthMb.toLocaleString("en-US")} MB since the last run)`}.`;
  const alert = result.alerts.length > 0 ? ` Warning: ${result.alerts.join("; ")}.` : "";
  const trims = result.trims.map((t) => {
    if (t.eligible == null) return `${TRIM_NAMES[t.policy]}: could not count`;
    const n = t.eligible.toLocaleString("en-US");
    return t.live ? `${TRIM_NAMES[t.policy]}: deleted ${t.deleted.toLocaleString("en-US")} of ${n}` : `${TRIM_NAMES[t.policy]}: ${n} (off)`;
  });
  return `${size}${alert} Trims: ${trims.join("; ")}.`;
}
