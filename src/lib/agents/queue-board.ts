import type { sql } from "@/lib/data-store/connection";
import { inSavepoint } from "@/lib/agents/savepoint";
import type { LessonAgent } from "@/lib/agents/learning/lesson-types";
import type { PipelineQueue } from "@/lib/agents/queue-registry";

type SqlTag = typeof sql;

/**
 * The piles board (#1108): every queue in `queue-registry.ts` measured once a day with the
 * scoreboard, stored in `pipeline_scoreboard_snapshots.detail.queues`, and judged against its
 * limits. Deterministic read-only SQL; never calls a model.
 *
 * Two alarms:
 * - `age`: the pile's oldest item is older than its `ageLimitDays`;
 * - `growth`: the pile is bigger today than on the newest stored day at least `growthWindowDays`
 *   back. With no stored day that old yet, growth is not judged and says so.
 * A pile whose read failed is stored with a null size and no alarm, never as zero.
 */

export const QUEUE_BOARD_VERSION = 1;
/** History days read beyond the longest growth window, so a missed day still has a base. */
const HISTORY_SLACK_DAYS = 7;
const DAY_MS = 86_400_000;

export type QueueAlarm = "age" | "growth";

export interface QueueReading {
  key: string;
  label: string;
  owner: LessonAgent;
  /** Null when the read failed. */
  size: number | null;
  oldest: string | null;
  oldestDays: number | null;
  ageLimitDays: number;
  growthWindowDays: number;
  /** The stored day growth is compared with; null until the history reaches back that far. */
  growthBase: { date: string; size: number } | null;
  alarms: QueueAlarm[];
  wayOut: string;
}

export interface QueueBoard {
  version: number;
  readAt: string;
  queues: QueueReading[];
}

/** One stored day's sizes by queue key, from `detail.queues`. */
export interface QueueHistoryDay {
  date: string;
  sizes: Record<string, number | null>;
}

function daysBetween(from: string, to: Date): number {
  return Math.floor((to.getTime() - Date.parse(from)) / DAY_MS);
}

/** Pure: the newest stored day at least `windowDays` before `today` with a size for `key`. */
export function growthBaseFor(key: string, windowDays: number, history: QueueHistoryDay[], today: string): { date: string; size: number } | null {
  const cutoff = Date.parse(`${today}T00:00:00Z`) - windowDays * DAY_MS;
  let base: { date: string; size: number } | null = null;
  for (const day of history) {
    const size = day.sizes[key];
    if (size == null || Date.parse(`${day.date}T00:00:00Z`) > cutoff) continue;
    if (!base || day.date > base.date) base = { date: day.date, size };
  }
  return base;
}

/** Pure: one queue's reading and alarms. */
export function judgeQueue(
  entry: PipelineQueue,
  measured: { size: number; oldest: string | null } | null,
  history: QueueHistoryDay[],
  now: Date,
): QueueReading {
  const today = now.toISOString().slice(0, 10);
  const oldest = measured?.oldest ?? null;
  const oldestDays = oldest == null ? null : daysBetween(oldest, now);
  const growthBase = measured ? growthBaseFor(entry.key, entry.growthWindowDays, history, today) : null;
  const alarms: QueueAlarm[] = [];
  if (measured && oldestDays != null && measured.size > 0 && oldestDays > entry.ageLimitDays) alarms.push("age");
  if (measured && growthBase && measured.size > growthBase.size) alarms.push("growth");
  return {
    key: entry.key,
    label: entry.label,
    owner: entry.owner,
    size: measured?.size ?? null,
    oldest,
    oldestDays,
    ageLimitDays: entry.ageLimitDays,
    growthWindowDays: entry.growthWindowDays,
    growthBase,
    alarms,
    wayOut: entry.wayOut,
  };
}

/** Pure: the sizes a stored `detail.queues` holds, by key. Anything malformed is skipped. */
export function queueSizesFromDetail(value: unknown): Record<string, number | null> {
  const sizes: Record<string, number | null> = {};
  const queues = (value as { queues?: unknown } | null)?.queues;
  if (!Array.isArray(queues)) return sizes;
  for (const item of queues) {
    const key = (item as { key?: unknown })?.key;
    const size = (item as { size?: unknown })?.size;
    if (typeof key !== "string") continue;
    sizes[key] = size == null || !Number.isFinite(Number(size)) ? null : Number(size);
  }
  return sizes;
}

/** Pure: a stored board, or null when `value` is not one. */
export function queueBoardFromDetail(value: unknown): QueueBoard | null {
  const board = value as Partial<QueueBoard> | null;
  if (!board || typeof board !== "object" || !Array.isArray(board.queues)) return null;
  return board as QueueBoard;
}

async function readHistory(db: SqlTag, now: Date, queues: readonly PipelineQueue[]): Promise<QueueHistoryDay[]> {
  const longest = Math.max(0, ...queues.map((queue) => queue.growthWindowDays));
  const today = now.toISOString().slice(0, 10);
  const rows = await inSavepoint(db, (scope) => scope<Array<{ day: string; queues: unknown }>>`
    SELECT snapshot_date::text AS day, detail->'queues' AS queues
      FROM pipeline_scoreboard_snapshots
     WHERE snapshot_date < ${today}::date
       AND snapshot_date >= ${today}::date - ${longest + HISTORY_SLACK_DAYS}::int
  `).catch((error) => {
    console.error("Queue board: history could not be read", error);
    return [];
  });
  return rows.map((row) => ({
    date: String(row.day),
    sizes: queueSizesFromDetail(typeof row.queues === "string" ? JSON.parse(row.queues) : row.queues),
  }));
}

async function measure(db: SqlTag, entry: PipelineQueue): Promise<{ size: number; oldest: string | null } | null> {
  return inSavepoint(db, async (scope) => {
    const [row] = await scope.unsafe<Array<{ size: unknown; oldest: unknown }>>(entry.sql);
    const oldest = row?.oldest == null ? null : new Date(row.oldest as string | Date).toISOString();
    return { size: Number(row?.size ?? 0), oldest };
  }).catch((error) => {
    console.error(`Queue board: ${entry.key} could not be read`, error);
    return null;
  });
}

/**
 * Measures each queue (sequentially: each in its own savepoint) and judges it against its stored
 * history. The scoreboard passes `PIPELINE_QUEUES`; this module imports only the registry's type,
 * so the page and the data store can read stored boards without loading the agents.
 */
export async function readQueueBoard(db: SqlTag, queues: readonly PipelineQueue[], now = new Date()): Promise<QueueBoard> {
  const history = await readHistory(db, now, queues);
  const readings: QueueReading[] = [];
  for (const entry of queues) readings.push(judgeQueue(entry, await measure(db, entry), history, now));
  return { version: QUEUE_BOARD_VERSION, readAt: now.toISOString(), queues: readings };
}

const count = (value: number) => value.toLocaleString("en-US");

/** One clause for the scoreboard step summary. */
export function summarizeQueueBoard(board: QueueBoard): string {
  const alarmed = board.queues.filter((queue) => queue.alarms.length > 0);
  const unread = board.queues.filter((queue) => queue.size == null).length;
  const head = `${alarmed.length} of ${board.queues.length} piles alarmed${unread > 0 ? ` (${unread} unreadable)` : ""}`;
  if (alarmed.length === 0) return `Piles: ${head}.`;
  const named = alarmed.map((queue) => {
    const why = queue.alarms.map((alarm) => alarm === "age"
      ? `oldest ${queue.oldestDays} days, limit ${queue.ageLimitDays}`
      : `up from ${count(queue.growthBase!.size)} on ${queue.growthBase!.date}`).join("; ");
    return `${queue.label} (${queue.owner}) ${count(queue.size ?? 0)}: ${why}`;
  });
  return `Piles: ${head}: ${named.join(", ")}.`;
}
