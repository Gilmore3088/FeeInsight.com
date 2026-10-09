import { sql } from "@/lib/data-store/connection";
import { listApiRoutePolicies } from "@/lib/api-hardening/policies";
import vercelConfig from "../../../../vercel.json";

type SqlTag = typeof sql;

/**
 * Atlas's schedule check (Agentic OS PRD WP-08): every cron in vercel.json against the route
 * audit ledger (`api_route_audit_events`, written by `withApiRoutePolicy` on every call). A
 * cron whose last scheduled time passed with no call since is `missed`; one whose call failed is
 * `failed`. A route without a policy writes no audit row, so its runs cannot be seen: it reads
 * `unknown`, never `ran`. Read-only; no model calls.
 */

export const SCHEDULE_CHECK_VERSION = 1;
/** Vercel fires a cron within its minute; give a slow cold start this long before calling it missed. */
export const SCHEDULE_GRACE_MINUTES = 10;
/** How far back to look for a cron's last scheduled time (covers monthly and quarterly crons). */
const LOOKBACK_MINUTES = 100 * 24 * 60;

export type ScheduleState = "ran" | "failed" | "missed" | "unknown" | "not_due";

export interface CronEntry {
  path: string;
  schedule: string;
}

export interface ScheduleCheckRow {
  path: string;
  schedule: string;
  routeId: string | null;
  state: ScheduleState;
  lastDueAt: string | null;
  lastCallAt: string | null;
  lastOutcome: string | null;
  note: string | null;
}

export interface ScheduleCheckResult {
  checkedAt: string;
  rows: ScheduleCheckRow[];
  counts: Record<ScheduleState, number>;
}

function parseField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const [range, stepText] = part.split("/");
    const step = stepText ? Number(stepText) : 1;
    let start = min;
    let end = max;
    if (range !== "*") {
      const [from, to] = range.split("-").map(Number);
      start = from;
      end = to ?? (stepText ? max : from);
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || !Number.isInteger(step) || step < 1) {
      throw new Error(`Unsupported cron field "${field}"`);
    }
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return values;
}

/** Pure: a five-field cron (UTC) as a minute matcher. Day-of-month and day-of-week OR when both are set. */
export function cronMatcher(schedule: string): (date: Date) => boolean {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`Unsupported cron "${schedule}"`);
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  const minutes = parseField(minute, 0, 59);
  const hours = parseField(hour, 0, 23);
  const days = parseField(dayOfMonth, 1, 31);
  const months = parseField(month, 1, 12);
  const weekdays = new Set([...parseField(dayOfWeek, 0, 7)].map((day) => day % 7));
  const dayStar = dayOfMonth === "*";
  const weekStar = dayOfWeek === "*";
  return (date) => {
    if (!minutes.has(date.getUTCMinutes()) || !hours.has(date.getUTCHours()) || !months.has(date.getUTCMonth() + 1)) return false;
    const dayHit = days.has(date.getUTCDate());
    const weekHit = weekdays.has(date.getUTCDay());
    if (dayStar && weekStar) return true;
    if (dayStar) return weekHit;
    if (weekStar) return dayHit;
    return dayHit || weekHit;
  };
}

/** Pure: the latest scheduled minute at or before `before`, or null within the lookback. */
export function lastScheduledAt(schedule: string, before: Date, lookbackMinutes = LOOKBACK_MINUTES): Date | null {
  const matches = cronMatcher(schedule);
  const cursor = new Date(before);
  cursor.setUTCSeconds(0, 0);
  for (let step = 0; step <= lookbackMinutes; step += 1) {
    if (matches(cursor)) return new Date(cursor);
    cursor.setUTCMinutes(cursor.getUTCMinutes() - 1);
  }
  return null;
}

/** Pure: the next scheduled minute strictly after `after`, or null within the lookahead. */
export function nextScheduledAt(schedule: string, after: Date, lookaheadMinutes = LOOKBACK_MINUTES): Date | null {
  const matches = cronMatcher(schedule);
  const cursor = new Date(after);
  cursor.setUTCSeconds(0, 0);
  for (let step = 0; step <= lookaheadMinutes; step += 1) {
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
    if (matches(cursor)) return new Date(cursor);
  }
  return null;
}

export function cronEntries(config: { crons?: CronEntry[] } = vercelConfig as { crons?: CronEntry[] }): CronEntry[] {
  return (config.crons ?? []).map((cron) => ({ path: cron.path, schedule: cron.schedule }));
}

export function pathnameOf(path: string): string {
  return path.split("?")[0];
}

/** The policy route id for a cron path, or null when the route writes no audit row. */
export function routeIdFor(path: string): string | null {
  const pathname = pathnameOf(path);
  return listApiRoutePolicies().find((policy) => policy.routeTemplate === pathname)?.routeId ?? null;
}

/** Pure: one cron's state from its last due time and the latest audit call since then. */
export function scheduleState(input: {
  routeId: string | null;
  lastDueAt: Date | null;
  lastCall: { at: Date; outcome: string } | null;
}): ScheduleState {
  if (!input.routeId) return "unknown";
  if (!input.lastDueAt) return "not_due";
  // No call on record at all: a cron added after its last due time looks exactly like this
  // until its first run, so the ledger alone cannot call it missed.
  if (!input.lastCall) return "unknown";
  if (input.lastCall.at.getTime() < input.lastDueAt.getTime() - 60_000) return "missed";
  return input.lastCall.outcome === "success" ? "ran" : "failed";
}

export async function runScheduleCheck({ db = sql, now = new Date() }: { db?: SqlTag; now?: Date } = {}): Promise<ScheduleCheckResult> {
  const entries = cronEntries();
  const cutoff = new Date(now.getTime() - SCHEDULE_GRACE_MINUTES * 60_000);
  const routeIds = [...new Set(entries.map((entry) => routeIdFor(entry.path)).filter((id): id is string => Boolean(id)))];
  const calls = routeIds.length === 0 ? [] : await db<Array<{ route_id: string; created_at: Date | string; outcome: string }>>`
    SELECT DISTINCT ON (route_id) route_id, created_at, outcome
      FROM api_route_audit_events
     WHERE route_id = ANY(${routeIds}::text[])
       AND created_at > ${new Date(now.getTime() - LOOKBACK_MINUTES * 60_000)}
     ORDER BY route_id, created_at DESC
  `;
  const latest = new Map(calls.map((call) => [call.route_id, { at: new Date(call.created_at), outcome: call.outcome }]));
  const shared = new Map<string, number>();
  for (const entry of entries) shared.set(pathnameOf(entry.path), (shared.get(pathnameOf(entry.path)) ?? 0) + 1);

  const rows = entries.map((entry): ScheduleCheckRow => {
    const routeId = routeIdFor(entry.path);
    const lastDueAt = lastScheduledAt(entry.schedule, cutoff);
    const lastCall = routeId ? latest.get(routeId) ?? null : null;
    const state = scheduleState({ routeId, lastDueAt, lastCall });
    const notes: string[] = [];
    if (!routeId) notes.push("No route policy, so its calls are not in the audit ledger.");
    else if (lastDueAt && !lastCall) notes.push("No call on record in the last 100 days; a new cron shows here until its first run.");
    if ((shared.get(pathnameOf(entry.path)) ?? 0) > 1) notes.push("Shares its route with another cron; any call to the route counts.");
    return {
      path: entry.path,
      schedule: entry.schedule,
      routeId,
      state,
      lastDueAt: lastDueAt?.toISOString() ?? null,
      lastCallAt: lastCall?.at.toISOString() ?? null,
      lastOutcome: lastCall?.outcome ?? null,
      note: notes.length > 0 ? notes.join(" ") : null,
    };
  });
  const counts: Record<ScheduleState, number> = { ran: 0, failed: 0, missed: 0, unknown: 0, not_due: 0 };
  for (const row of rows) counts[row.state] += 1;
  return { checkedAt: now.toISOString(), rows, counts };
}

export function summarizeScheduleCheck(result: ScheduleCheckResult): string {
  const { counts } = result;
  const problems = result.rows.filter((row) => row.state === "missed" || row.state === "failed");
  const head = `Checked ${result.rows.length} schedules against the route ledger: ${counts.ran} ran on time`;
  const bad = problems.length === 0
    ? "none missed or failed"
    : `${counts.missed} missed, ${counts.failed} failed (${problems.map((row) => row.path).join(", ")})`;
  const unknown = counts.unknown > 0 ? `; ${counts.unknown} unknown (no call on record)` : "";
  return `${head}, ${bad}${unknown}.`;
}
