import { sql } from "./connection";

/**
 * Agent health from the run ledger: for each agent, the steps it finished and the
 * steps that failed on each of the last seven days, and which kinds of step failed.
 * Read straight from `agent_run_steps`; cancelled and skipped steps count as neither.
 */

export const HEALTH_AGENTS = ["atlas", "magellan", "rosetta", "knox", "darwin", "hamilton"] as const;
export type HealthAgent = (typeof HEALTH_AGENTS)[number];

export interface StepCountRow {
  agent: string;
  stepKey: string;
  status: string;
  /** UTC day, YYYY-MM-DD. */
  day: string;
  count: number;
  lastAt: string | null;
}

export interface DayCount {
  day: string;
  done: number;
  failed: number;
}

export interface FailingStep {
  stepKey: string;
  failed: number;
  done: number;
}

export interface AgentHealth {
  agent: HealthAgent;
  done: number;
  failed: number;
  waiting: number;
  days: DayCount[];
  failing: FailingStep[];
  lastDoneAt: string | null;
  tone: "good" | "watch" | "bad" | "quiet";
}

/** The seven UTC days ending today, oldest first. */
export function lastSevenDays(now: Date): string[] {
  const days: string[] = [];
  for (let back = 6; back >= 0; back -= 1) {
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back));
    days.push(day.toISOString().slice(0, 10));
  }
  return days;
}

/** Judged on the last two days so an old bad patch does not colour today: over 10% failed is bad, over 2% worth watching, nothing finished is quiet. */
export function healthTone(done: number, failed: number): AgentHealth["tone"] {
  if (done + failed === 0) return "quiet";
  const share = failed / (done + failed);
  if (share > 0.1) return "bad";
  if (share > 0.02) return "watch";
  return "good";
}

/** Pure: fold ledger counts into one health card per agent. */
export function summarizeAgentHealth(rows: StepCountRow[], now: Date): AgentHealth[] {
  const days = lastSevenDays(now);
  return HEALTH_AGENTS.map((agent) => {
    const mine = rows.filter((row) => row.agent === agent);
    const byDay = new Map(days.map((day) => [day, { day, done: 0, failed: 0 }]));
    const bySteps = new Map<string, FailingStep>();
    let waiting = 0;
    let lastDoneAt: string | null = null;
    for (const row of mine) {
      if (row.status === "queued" || row.status === "running") {
        waiting += row.count;
        continue;
      }
      if (row.status !== "completed" && row.status !== "failed") continue;
      const bucket = byDay.get(row.day);
      const step = bySteps.get(row.stepKey) ?? { stepKey: row.stepKey, failed: 0, done: 0 };
      if (row.status === "completed") {
        if (bucket) bucket.done += row.count;
        step.done += row.count;
        if (row.lastAt && (!lastDoneAt || row.lastAt > lastDoneAt)) lastDoneAt = row.lastAt;
      } else {
        if (bucket) bucket.failed += row.count;
        step.failed += row.count;
      }
      bySteps.set(row.stepKey, step);
    }
    const dayCounts = [...byDay.values()];
    const done = dayCounts.reduce((sum, day) => sum + day.done, 0);
    const failed = dayCounts.reduce((sum, day) => sum + day.failed, 0);
    const failing = [...bySteps.values()].filter((step) => step.failed > 0).sort((a, b) => b.failed - a.failed);
    const recent = dayCounts.slice(-2);
    const tone = healthTone(
      recent.reduce((sum, day) => sum + day.done, 0),
      recent.reduce((sum, day) => sum + day.failed, 0),
    );
    return { agent, done, failed, waiting, days: dayCounts, failing, lastDoneAt, tone };
  });
}

export async function getAgentHealth(now = new Date()): Promise<AgentHealth[]> {
  const rows = await sql`
    SELECT agent_name, step_key, status,
           to_char((COALESCE(completed_at, updated_at, queued_at) AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day,
           COUNT(*)::int AS count,
           MAX(completed_at) AS last_at
      FROM agent_run_steps
     WHERE queued_at > NOW() - interval '8 days'
     GROUP BY 1, 2, 3, 4
  `;
  return summarizeAgentHealth(
    rows.map((row) => ({
      agent: String(row.agent_name),
      stepKey: String(row.step_key),
      status: String(row.status),
      day: String(row.day),
      count: Number(row.count),
      lastAt: row.last_at ? new Date(row.last_at as string).toISOString() : null,
    })),
    now,
  );
}
