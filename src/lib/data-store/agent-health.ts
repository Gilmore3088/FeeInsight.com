import { sql } from "./connection";

/**
 * Agent health from the run ledger: for each agent, the steps it finished and the
 * steps that failed on each of the last seven days, and which kinds of step failed.
 * Read straight from `agent_run_steps`; cancelled and skipped steps count as neither.
 */

export const HEALTH_AGENTS = ["atlas", "magellan", "rosetta", "knox", "darwin", "hamilton"] as const;
export type HealthAgent = (typeof HEALTH_AGENTS)[number];

/**
 * Steps that notify outside services (search engines) rather than move fee data. Their
 * failures are shown on their own, so a rejected SEO ping never marks an agent's
 * pipeline work as failing.
 */
export const NOTIFICATION_STEPS: Record<string, { label: string; recovery: string }> = {
  "indexnow-ping": {
    label: "IndexNow ping (search-engine notice)",
    recovery:
      "Pipeline work is unaffected. A 403 means IndexNow did not accept the key for this host: check that /ca6202af6d65f287a44e558a58a3ad22.txt on the live site returns exactly the key. The daily ping retries on its own.",
  },
};

export function isNotificationStep(stepKey: string): boolean {
  return Object.prototype.hasOwnProperty.call(NOTIFICATION_STEPS, stepKey);
}

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
  lastFailedAt: string | null;
  lastDoneAt: string | null;
  /** The newest run of this step failed: it is broken now, not just earlier this week. */
  stillFailing: boolean;
  /** Newest recorded error for the step, when it was read (notification steps). */
  lastError?: string | null;
}

export interface AgentHealth {
  agent: HealthAgent;
  done: number;
  failed: number;
  waiting: number;
  days: DayCount[];
  failing: FailingStep[];
  /** Notification steps (e.g. the IndexNow ping) that failed this week; not part of tone. */
  notifications: FailingStep[];
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
    const byNotice = new Map<string, FailingStep>();
    let waiting = 0;
    let lastDoneAt: string | null = null;
    for (const row of mine) {
      if (row.status === "queued" || row.status === "running") {
        waiting += row.count;
        continue;
      }
      if (row.status !== "completed" && row.status !== "failed") continue;
      const notice = isNotificationStep(row.stepKey);
      const steps = notice ? byNotice : bySteps;
      // Notification steps stay out of the day bars and counts: they are not pipeline work.
      const bucket = notice ? undefined : byDay.get(row.day);
      const step = steps.get(row.stepKey) ?? {
        stepKey: row.stepKey, failed: 0, done: 0, lastFailedAt: null, lastDoneAt: null, stillFailing: false,
      };
      if (row.status === "completed") {
        if (bucket) bucket.done += row.count;
        step.done += row.count;
        if (!notice && row.lastAt && (!lastDoneAt || row.lastAt > lastDoneAt)) lastDoneAt = row.lastAt;
        if (row.lastAt && (!step.lastDoneAt || row.lastAt > step.lastDoneAt)) step.lastDoneAt = row.lastAt;
      } else {
        if (bucket) bucket.failed += row.count;
        step.failed += row.count;
        if (row.lastAt && (!step.lastFailedAt || row.lastAt > step.lastFailedAt)) step.lastFailedAt = row.lastAt;
      }
      steps.set(row.stepKey, step);
    }
    const dayCounts = [...byDay.values()];
    const done = dayCounts.reduce((sum, day) => sum + day.done, 0);
    const failed = dayCounts.reduce((sum, day) => sum + day.failed, 0);
    const failing = failedSteps(bySteps);
    const notifications = failedSteps(byNotice);
    const recent = dayCounts.slice(-2);
    // A step whose newest run failed is broken now, whatever the share says.
    const tone = failing.some((step) => step.stillFailing) ? "bad" : healthTone(
      recent.reduce((sum, day) => sum + day.done, 0),
      recent.reduce((sum, day) => sum + day.failed, 0),
    );
    return { agent, done, failed, waiting, days: dayCounts, failing, notifications, lastDoneAt, tone };
  });
}

function failedSteps(steps: Map<string, FailingStep>): FailingStep[] {
  return [...steps.values()]
    .filter((step) => step.failed > 0)
    .map((step) => ({ ...step, stillFailing: Boolean(step.lastFailedAt && (!step.lastDoneAt || step.lastFailedAt > step.lastDoneAt)) }))
    .sort((a, b) => Number(b.stillFailing) - Number(a.stillFailing) || b.failed - a.failed);
}

export async function getAgentHealth(now = new Date()): Promise<AgentHealth[]> {
  const noticeKeys = Object.keys(NOTIFICATION_STEPS);
  const [rows, noticeErrors] = await Promise.all([sql`
    SELECT agent_name, step_key, status,
           to_char((COALESCE(completed_at, updated_at, queued_at) AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day,
           COUNT(*)::int AS count,
           MAX(COALESCE(completed_at, updated_at)) AS last_at
      FROM agent_run_steps
     WHERE queued_at > NOW() - interval '8 days'
     GROUP BY 1, 2, 3, 4
  `, sql`
    SELECT DISTINCT ON (step_key) step_key, error_summary
      FROM agent_run_steps
     WHERE step_key = ANY(${noticeKeys})
       AND status = 'failed'
       AND queued_at > NOW() - interval '8 days'
     ORDER BY step_key, id DESC
  `]);
  const errors = new Map(noticeErrors.map((row) => [String(row.step_key), row.error_summary ? String(row.error_summary) : null]));
  const health = summarizeAgentHealth(
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
  return health.map((agent) => ({
    ...agent,
    notifications: agent.notifications.map((step) => ({ ...step, lastError: errors.get(step.stepKey) ?? null })),
  }));
}
