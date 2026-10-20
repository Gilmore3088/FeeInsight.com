import type { sql } from "@/lib/data-store/connection";
import { inSavepoint } from "@/lib/agents/savepoint";
import type { LiveAuditContext } from "@/lib/data-store/live-source-audit";

type SqlTag = typeof sql;

/**
 * Old monthly partitions of the retired `agent_events` log are dropped whole, not trimmed row by
 * row (James, Oct 19, 2026). On Oct 19 the row trim deleted 20,000 rows a run with 359,987 left
 * (about 18 days to catch up), and a row delete leaves dead tuples and returns no disk. Dropping
 * a month whose whole range ends before the retention cutoff frees its space at once.
 *
 * Scope: only `public.agent_events_YYYY_MM` partitions attached to `public.agent_events` whose
 * range ends before the cutoff. Never the default partition, never a `*_archived` table (the
 * monthly maintainer detaches those at 18 months), never the month the cutoff falls in (its old
 * rows stay with the row trim), never the current or a future month. `agent_auth_log` is a
 * different table and is not in scope.
 *
 * The detach and drop are done by `public.drop_expired_legacy_event_partition` (migration
 * 20270110000072), which checks the same scope again in the database: a direct child of
 * `public.agent_events`, not default or archived, its upper bound before the cutoff.
 *
 * Each partition goes in its own committed transaction, outside the step's transaction, with a
 * lock timeout: the drop locks the parent, and holding that lock to the end of the storage step
 * would block the one writer still left (Magellan's identity decisions) for the whole step. In
 * that transaction the parent is locked, the partition's rows are counted and its newest row is
 * checked against the cutoff (a newer row rolls back), the drop is recorded as an
 * `agent_run_events` row on the storage step, and only then does the function drop it.
 */

export const LEGACY_EVENT_SCHEMA = "public";
export const LEGACY_EVENT_TABLE = "agent_events";
/** How long a drop waits for the parent's lock before giving up until the next run. */
export const PARTITION_LOCK_TIMEOUT = "3s";
/** Each statement in a drop's transaction (the count of a ~190 MB month included) stops after this. */
export const PARTITION_STATEMENT_TIMEOUT = "15s";
export const PARTITION_DROPPED_EVENT = "atlas.storage.partition_dropped";

const DAY_MS = 86_400_000;
const PARTITION_NAME = /^agent_events_(\d{4})_(\d{2})$/;
const PARENT = `"${LEGACY_EVENT_SCHEMA}"."${LEGACY_EVENT_TABLE}"`;

export type KeptReason = "default" | "archived" | "unrecognised" | "boundary" | "not_expired";

export interface MonthPartition {
  name: string;
  /** First instant of the month, UTC. */
  from: Date;
  /** First instant of the next month, UTC (the range's exclusive upper bound). */
  to: Date;
}

export interface PartitionSelection {
  drop: MonthPartition[];
  kept: Array<{ name: string; reason: KeptReason }>;
}

export interface PartitionOutcome {
  name: string;
  rows: number | null;
  totalMb: number | null;
  dropped: boolean;
  error?: string;
}

export interface PartitionPlan {
  cutoff: string;
  partitions: PartitionOutcome[];
  /** The partly expired month: its old rows are left to the row trim. */
  boundary: string[];
  note?: string;
}

const mb = (bytes: unknown) => Math.round((Number(bytes ?? 0) / 1_048_576) * 10) / 10;
const count = (value: unknown) => (value == null || !Number.isFinite(Number(value)) ? null : Number(value));
const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300);

/** Pure: the retention cutoff, `days` before `now`. */
export function retentionCutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

/** Pure: the month range an `agent_events_YYYY_MM` partition name covers, or null for any other name. */
export function partitionMonth(name: string): MonthPartition | null {
  const match = PARTITION_NAME.exec(name);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { name, from: new Date(Date.UTC(year, month - 1, 1)), to: new Date(Date.UTC(year, month, 1)) };
}

/**
 * Pure: which partitions are wholly past the cutoff. A month is dropped only when its range ends
 * before the cutoff; the month the cutoff falls in is the boundary and stays.
 */
export function selectExpiredPartitions(names: string[], cutoff: Date): PartitionSelection {
  const drop: MonthPartition[] = [];
  const kept: PartitionSelection["kept"] = [];
  for (const name of [...names].sort()) {
    const month = partitionMonth(name);
    if (!month) {
      const reason: KeptReason = name === `${LEGACY_EVENT_TABLE}_default` ? "default" : name.endsWith("_archived") ? "archived" : "unrecognised";
      kept.push({ name, reason });
    } else if (month.to.getTime() < cutoff.getTime()) {
      drop.push(month);
    } else {
      kept.push({ name, reason: month.from.getTime() < cutoff.getTime() ? "boundary" : "not_expired" });
    }
  }
  return { drop, kept };
}

/** A partition name already matched `PARTITION_NAME`, so it is safe to quote as an identifier. */
function partitionTarget(name: string): string {
  if (!PARTITION_NAME.test(name)) throw new Error(`not a monthly partition name: ${name}`);
  return `"${LEGACY_EVENT_SCHEMA}"."${name}"`;
}

/** The parent's attached partitions in its own schema. Catalog only: takes no lock on the log. */
export async function listLegacyPartitions(db: SqlTag): Promise<string[]> {
  const rows = await db<{ relname: string }[]>`
    SELECT c.relname
      FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE i.inhparent = to_regclass(${PARENT})
       AND n.nspname = ${LEGACY_EVENT_SCHEMA}
  `;
  return rows.map((row) => row.relname);
}

/** Rows and total size of one partition, read on the step's own connection (dry run or switched off). */
async function measurePartition(db: SqlTag, name: string): Promise<PartitionOutcome> {
  try {
    const target = partitionTarget(name);
    // Its own savepoint: a failed count must not abort the step's transaction.
    const [row] = await inSavepoint(db, (scope) => scope.unsafe<{ n: string; bytes: string }[]>(
      `SELECT count(*)::bigint AS n, pg_total_relation_size($1::regclass)::bigint AS bytes FROM ${target}`,
      [target],
    ));
    return { name, rows: count(row?.n), totalMb: row ? mb(row.bytes) : null, dropped: false };
  } catch (error) {
    return { name, rows: null, totalMb: null, dropped: false, error: message(error) };
  }
}

/** Lock, check, record and drop one partition in its own committed transaction. */
async function dropPartition(commitDb: SqlTag, name: string, cutoff: Date, context: LiveAuditContext): Promise<PartitionOutcome> {
  try {
    const target = partitionTarget(name);
    const outcome = await commitDb.begin(async (transaction) => {
      const tx = transaction as unknown as SqlTag;
      await tx`SELECT set_config('lock_timeout', ${PARTITION_LOCK_TIMEOUT}, true),
                      set_config('statement_timeout', ${PARTITION_STATEMENT_TIMEOUT}, true)`;
      // The lock the detach takes anyway, taken first so no row arrives between count and drop.
      await tx.unsafe(`LOCK TABLE ${PARENT} IN ACCESS EXCLUSIVE MODE`);
      const attached = await tx<{ one: number }[]>`
        SELECT 1 AS one
          FROM pg_inherits i
          JOIN pg_class c ON c.oid = i.inhrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE i.inhparent = to_regclass(${PARENT}) AND n.nspname = ${LEGACY_EVENT_SCHEMA} AND c.relname = ${name}
      `;
      if (attached.length === 0) return { name, rows: null, totalMb: null, dropped: false, error: "no longer attached" };
      const [seen] = await tx.unsafe<{ n: string; newest: Date | string | null; bytes: string }[]>(
        `SELECT count(*)::bigint AS n, max(created_at) AS newest, pg_total_relation_size($1::regclass)::bigint AS bytes FROM ${target}`,
        [target],
      );
      const newest = seen?.newest == null ? null : new Date(seen.newest);
      if (newest && newest.getTime() >= cutoff.getTime()) {
        throw new Error(`${name} holds a row from ${newest.toISOString()}, after the cutoff`);
      }
      const rows = Number(seen?.n ?? 0);
      const totalMb = mb(seen?.bytes);
      await tx`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (${context.runId}, ${context.stepId}, ${PARTITION_DROPPED_EVENT}, 'completed',
                ${`Atlas dropped ${name} of the retired event log (${rows} rows, ${totalMb} MB).`},
                ${JSON.stringify({ step_key: context.stepKey, partition: `${LEGACY_EVENT_SCHEMA}.${name}`, rows, total_mb: totalMb, cutoff: cutoff.toISOString() })}::jsonb)
      `;
      // The function checks the scope again in the database before it detaches and drops.
      await tx`SELECT public.drop_expired_legacy_event_partition(${target}::regclass, ${cutoff.toISOString()}::timestamptz)`;
      return { name, rows, totalMb, dropped: true };
    });
    return outcome as PartitionOutcome;
  } catch (error) {
    return { name, rows: null, totalMb: null, dropped: false, error: message(error) };
  }
}

/**
 * Plan (and, when live, carry out) the partition drops. Call it before anything on the step's
 * connection touches the log: a lock the step's transaction held on it would block the drops
 * until their lock timeout.
 */
export async function dropExpiredLegacyPartitions(options: {
  db: SqlTag;
  commitDb?: SqlTag | null;
  live: boolean;
  cutoff: Date;
  context?: LiveAuditContext;
}): Promise<PartitionPlan> {
  const { drop, kept } = selectExpiredPartitions(await listLegacyPartitions(options.db), options.cutoff);
  const plan: PartitionPlan = {
    cutoff: options.cutoff.toISOString(),
    partitions: [],
    boundary: kept.filter((k) => k.reason === "boundary").map((k) => k.name),
  };
  const canDrop = options.live && options.commitDb != null && options.context != null;
  if (options.live && !canDrop) {
    plan.note = options.commitDb == null
      ? "no connection outside the step's transaction; nothing dropped"
      : "no run step to record the drop on; nothing dropped";
  }
  for (const month of drop) {
    plan.partitions.push(canDrop
      ? await dropPartition(options.commitDb as SqlTag, month.name, options.cutoff, options.context as LiveAuditContext)
      : await measurePartition(options.db, month.name));
  }
  return plan;
}
