import { sql } from "./connection";

type SqlTag = typeof sql;

/**
 * The Quality view's reads (Agentic OS PRD 12.3): Deming's regression gate, Bayes's replay
 * ledger, Atlas's schedule check, and the categories with the most confirmed takedowns. Each
 * section reads on its own, so one unreadable table shows as unknown instead of hiding the rest.
 * Read-only.
 */

export interface LatestStep {
  at: string;
  summary: string;
  detail: Record<string, unknown>;
}

export interface EvalCaseCount {
  dataset: string;
  status: string;
  count: number;
}

export interface ReplayJobRow {
  changeKey: string;
  owner: string;
  unit: string;
  status: string;
  affected: number;
  done: number;
  queued: number;
  excluded: number;
  note: string | null;
  lastCheckedAt: string | null;
}

export interface RepeatedError {
  category: string;
  checkName: string;
  count: number;
}

export interface AgentQuality {
  evalCases: EvalCaseCount[] | null;
  deming: LatestStep | null | undefined;
  replayJobs: ReplayJobRow[] | null;
  bayes: LatestStep | null | undefined;
  schedules: LatestStep | null | undefined;
  repeatedErrors: RepeatedError[] | null;
}

const iso = (value: unknown): string | null => (value ? new Date(value as string | Date).toISOString() : null);

function toDetail(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return value as Record<string, unknown>;
}

/** The newest finished run of a step, with the detail it recorded; null when it has never finished. */
export async function latestFinishedStep(db: SqlTag, stepKey: string): Promise<LatestStep | null> {
  const [row] = await db<Array<{ message: string; detail: unknown; created_at: Date | string }>>`
    WITH step AS (
      SELECT id, agent_run_id
        FROM agent_run_steps
       WHERE step_key = ${stepKey}
         AND status = 'completed'
       ORDER BY id DESC
       LIMIT 1
    )
    SELECT e.message, e.detail, e.created_at
      FROM agent_run_events e
      JOIN step ON e.agent_run_id = step.agent_run_id AND e.step_id = step.id
     WHERE e.event_type = 'step.finished'
     ORDER BY e.id DESC
     LIMIT 1
  `;
  if (!row) return null;
  return { at: iso(row.created_at) ?? "", summary: String(row.message ?? ""), detail: toDetail(row.detail) };
}

async function orNull<T>(what: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    console.error(`Agent quality: ${what} could not be read`, error);
    return null;
  }
}

/** `undefined` marks a step read that failed (unknown); `null` a step that has never finished. */
async function stepOrUnknown(db: SqlTag, stepKey: string): Promise<LatestStep | null | undefined> {
  try {
    return await latestFinishedStep(db, stepKey);
  } catch (error) {
    console.error(`Agent quality: ${stepKey} could not be read`, error);
    return undefined;
  }
}

export async function getAgentQuality(db: SqlTag = sql): Promise<AgentQuality> {
  const [evalCases, deming, replayJobs, bayes, schedules, repeatedErrors] = await Promise.all([
    orNull("eval cases", async () => {
      const rows = await db<Array<{ dataset: string; status: string; count: number | string }>>`
        SELECT dataset, status, COUNT(*) AS count FROM eval_cases GROUP BY 1, 2 ORDER BY 1, 2
      `;
      return rows.map((row) => ({ dataset: row.dataset, status: row.status, count: Number(row.count) }));
    }),
    stepOrUnknown(db, "deming-regression"),
    orNull("replay jobs", async () => {
      const rows = await db<Array<Record<string, unknown>>>`
        SELECT change_key, owner_agent, unit, status, affected, done, queued, excluded, note, last_checked_at
          FROM replay_jobs
         ORDER BY CASE status WHEN 'stuck' THEN 0 WHEN 'open' THEN 1 WHEN 'not_counted' THEN 2 ELSE 3 END, queued DESC, change_key
      `;
      return rows.map((row) => ({
        changeKey: String(row.change_key),
        owner: String(row.owner_agent),
        unit: String(row.unit),
        status: String(row.status),
        affected: Number(row.affected ?? 0),
        done: Number(row.done ?? 0),
        queued: Number(row.queued ?? 0),
        excluded: Number(row.excluded ?? 0),
        note: row.note ? String(row.note) : null,
        lastCheckedAt: iso(row.last_checked_at),
      }));
    }),
    stepOrUnknown(db, "bayes-replay-ledger"),
    stepOrUnknown(db, "schedule-check"),
    orNull("repeated errors", async () => {
      const rows = await db<Array<{ canonical_fee_key: string; check_name: string | null; count: number | string }>>`
        SELECT canonical_fee_key, check_name, COUNT(*) AS count
          FROM pipeline_feedback
         WHERE kind = 'takedown_confirmed'
           AND created_at > NOW() - INTERVAL '30 days'
           AND canonical_fee_key IS NOT NULL
         GROUP BY 1, 2
         ORDER BY 3 DESC, 1
         LIMIT 12
      `;
      return rows.map((row) => ({ category: row.canonical_fee_key, checkName: row.check_name ?? "unnamed check", count: Number(row.count) }));
    }),
  ]);
  return { evalCases, deming, replayJobs, bayes, schedules, repeatedErrors };
}

export interface ScheduleProblem {
  path: string;
  schedule: string;
  state: string;
  lastDueAt: string | null;
  lastCallAt: string | null;
}

/** Pure: the missed, failed and unknown schedules from a schedule-check step's detail. */
export function scheduleProblems(detail: Record<string, unknown>): ScheduleProblem[] {
  const rows = Array.isArray(detail.schedules) ? (detail.schedules as Array<Record<string, unknown>>) : [];
  return rows
    .filter((row) => row.state === "missed" || row.state === "failed" || row.state === "unknown")
    .map((row) => ({
      path: String(row.path ?? ""),
      schedule: String(row.schedule ?? ""),
      state: String(row.state),
      lastDueAt: row.lastDueAt ? String(row.lastDueAt) : null,
      lastCallAt: row.lastCallAt ? String(row.lastCallAt) : null,
    }));
}
