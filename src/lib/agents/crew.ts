import { sql } from "@/lib/data-store/connection";
import { narrateEvent, STEP_OWNER } from "./narrate";
import type { AdminAgent } from "./types";
import { agentRegistry, nextRunFor } from "./atlas/registry";

/**
 * The Fee Insight crew: the six pipeline agents presented as named workers with a
 * state, a "now" and a "last" sentence, and a shared plain-English activity log.
 * Everything here is read from the run ledger; nothing calls a model.
 */

export interface CrewMemberMeta {
  agent: AdminAgent;
  name: string;
  role: string;
  /** Admin page with this worker's detailed tools. */
  href: string;
}

export const CREW: CrewMemberMeta[] = [
  { agent: "atlas", name: "Atlas", role: "Runs the schedule and coordinates the crew", href: "/admin/atlas/details" },
  { agent: "magellan", name: "Magellan", role: "Finds and downloads fee schedules", href: "/admin/magellan" },
  { agent: "rosetta", name: "Rosetta", role: "Reads PDFs and web pages", href: "/admin/rosetta" },
  { agent: "knox", name: "Knox", role: "Pulls fees out of documents", href: "/admin/knox" },
  { agent: "darwin", name: "Darwin", role: "Checks every fee before it counts", href: "/admin/darwin" },
  { agent: "hamilton", name: "Hamilton", role: "Publishes fees and runs the index", href: "/admin/hamilton" },
  { agent: "growth", name: "Growth", role: "Drafts marketing posts and emails for James to approve", href: "/admin/customers/content" },
];

export function crewMember(agent: string): CrewMemberMeta | undefined {
  return CREW.find((member) => member.agent === agent);
}

/** `unknown`: the run ledger could not be read, so no state is claimed (PRD 12.2). */
export type CrewState = "working" | "waiting" | "blocked" | "idle" | "unknown";

export interface CrewFeedItem {
  id: number;
  at: string;
  agent: AdminAgent;
  runId: number;
  stateCode: string | null;
  tone: "ok" | "warn" | "error";
  text: string;
}

export interface CrewMemberStatus extends CrewMemberMeta {
  state: CrewState;
  now: string;
  last: string | null;
  lastAt: string | null;
  doneToday: number;
  /** Latest step this worker started, whatever its outcome. */
  lastAttemptAt: string | null;
  /** Latest step this worker finished successfully. */
  lastSuccessAt: string | null;
  /** Soonest scheduled run from vercel.json, or null when only the tick drives it. */
  nextRunAt: string | null;
}

const FEED_EVENT_TYPES = ["step.finished", "step.failed", "step.reaped", "step.dead", "run.blocked", "run.completed"];

function eventTone(eventType: string, status: string): CrewFeedItem["tone"] {
  if (eventType === "step.failed" || eventType === "step.dead" || status === "failed") return "error";
  if (eventType === "step.reaped" || eventType === "run.blocked" || status === "blocked") return "warn";
  return "ok";
}

function asAgent(value: unknown, stepKey: string | null): AdminAgent {
  const candidate = String(value ?? "");
  if (crewMember(candidate)) return candidate as AdminAgent;
  return (stepKey && STEP_OWNER[stepKey]) || "atlas";
}

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

export function feedItemFromRow(row: Record<string, unknown>): CrewFeedItem | null {
  const stepKey = row.step_key ? String(row.step_key) : null;
  const eventType = String(row.event_type);
  const status = String(row.status ?? "");
  const text = narrateEvent({
    eventType,
    status,
    message: String(row.message ?? ""),
    detail: toDetail(row.detail),
    stepKey,
    stateCode: row.state_code ? String(row.state_code) : null,
  });
  if (!text) return null;
  return {
    id: Number(row.id),
    at: new Date(row.created_at as string | Date).toISOString(),
    agent: asAgent(row.step_agent ?? row.run_agent, stepKey),
    runId: Number(row.run_id),
    stateCode: row.state_code ? String(row.state_code) : null,
    tone: eventTone(eventType, status),
    text,
  };
}

/** Newest-first plain-English activity, optionally for one worker. */
export async function getCrewFeed({
  agent,
  limit = 40,
}: { agent?: AdminAgent | null; limit?: number } = {}): Promise<CrewFeedItem[]> {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 200);
  const rows = await sql`
    SELECT e.id, e.created_at, e.event_type, e.status, e.message, e.detail,
           s.step_key, s.agent_name AS step_agent, r.agent_name AS run_agent,
           r.state_code, r.id AS run_id
      FROM agent_run_events e
      JOIN agent_runs r ON r.id = e.agent_run_id
      LEFT JOIN agent_run_steps s ON s.id = e.step_id
     WHERE e.event_type = ANY(${FEED_EVENT_TYPES})
       AND (${agent ?? null}::text IS NULL OR COALESCE(s.agent_name, r.agent_name) = ${agent ?? null})
     ORDER BY e.created_at DESC, e.id DESC
     LIMIT ${safeLimit * 2}
  `;
  return rows
    .map(feedItemFromRow)
    .filter((item): item is CrewFeedItem => item !== null)
    .slice(0, safeLimit);
}

export interface CrewSignals {
  lastAttemptAt?: string | null;
  lastSuccessAt?: string | null;
  nextRunAt?: string | null;
  runningStep: { title: string; stateCode: string | null } | null;
  queuedSteps: number;
  activeRuns: number;
  lastItem: CrewFeedItem | null;
  failedRecently: boolean;
  doneToday: number;
}

/** Pure: a worker's state and sentences from the ledger signals gathered for it. */
export function deriveCrewMember(meta: CrewMemberMeta, signals: CrewSignals): CrewMemberStatus {
  let state: CrewState = "idle";
  let now = "Nothing to do right now.";
  if (meta.agent === "atlas" && signals.activeRuns > 0) {
    state = "working";
    now = `Coordinating ${signals.activeRuns === 1 ? "1 run" : `${signals.activeRuns} runs`}.`;
  } else if (signals.runningStep) {
    state = "working";
    now = `${signals.runningStep.title}${signals.runningStep.stateCode ? ` (${signals.runningStep.stateCode})` : ""}.`;
  } else if (signals.queuedSteps > 0) {
    state = "waiting";
    now = `${signals.queuedSteps === 1 ? "1 job" : `${signals.queuedSteps} jobs`} queued, waiting for the next tick.`;
  }
  if (state !== "working" && signals.failedRecently) {
    state = "blocked";
    now = "My last job failed. See the log below.";
  }
  return {
    ...meta,
    state,
    now,
    last: signals.lastItem?.text ?? null,
    lastAt: signals.lastItem?.at ?? null,
    doneToday: signals.doneToday,
    lastAttemptAt: signals.lastAttemptAt ?? null,
    lastSuccessAt: signals.lastSuccessAt ?? null,
    nextRunAt: signals.nextRunAt ?? null,
  };
}

/** Pure: every worker as Unknown, for when the ledger cannot be read. Never a guessed "idle". */
export function unknownCrew(now: Date = new Date()): CrewMemberStatus[] {
  const registry = agentRegistry();
  return CREW.map((meta) => ({
    ...meta,
    state: "unknown",
    now: "Status unknown: the run ledger could not be read.",
    last: null,
    lastAt: null,
    doneToday: 0,
    lastAttemptAt: null,
    lastSuccessAt: null,
    nextRunAt: nextRunFor(registry.find((entry) => entry.agent === meta.agent)?.schedules ?? [], now),
  }));
}

export async function getCrewStatus(now: Date = new Date()): Promise<CrewMemberStatus[]> {
  try {
    return await readCrewStatus(now);
  } catch (error) {
    console.error("Crew status could not be read", error);
    return unknownCrew(now);
  }
}

async function readCrewStatus(now: Date): Promise<CrewMemberStatus[]> {
  const registry = agentRegistry();
  const [activeSteps, activeRunsRow, todayRows, feed, lastRows] = await Promise.all([
    sql`
      SELECT s.agent_name, s.step_key, s.title, s.status, r.state_code
        FROM agent_run_steps s
        JOIN agent_runs r ON r.id = s.agent_run_id
       WHERE r.status IN ('queued', 'running')
         AND s.status IN ('queued', 'running')
    `,
    sql`
      SELECT COUNT(*)::int AS active
        FROM agent_runs
       WHERE status IN ('queued', 'running')
    `,
    sql`
      SELECT COALESCE(s.agent_name, r.agent_name) AS agent,
             COUNT(*) FILTER (WHERE e.event_type = 'step.finished')::int AS finished,
             COUNT(*) FILTER (WHERE e.event_type IN ('step.failed', 'step.dead'))::int AS failed
        FROM agent_run_events e
        JOIN agent_runs r ON r.id = e.agent_run_id
        LEFT JOIN agent_run_steps s ON s.id = e.step_id
       WHERE e.created_at >= date_trunc('day', NOW())
          OR (e.event_type IN ('step.failed', 'step.dead') AND e.created_at >= NOW() - INTERVAL '24 hours')
       GROUP BY 1
    `,
    getCrewFeed({ limit: 200 }),
    sql`
      SELECT agent_name,
             MAX(started_at) AS last_attempt_at,
             MAX(completed_at) FILTER (WHERE status = 'completed') AS last_success_at
        FROM agent_run_steps
       WHERE updated_at > NOW() - INTERVAL '30 days'
       GROUP BY agent_name
    `,
  ]);
  const iso = (value: unknown) => (value ? new Date(value as string | Date).toISOString() : null);
  const activeRuns = Number(activeRunsRow[0]?.active ?? 0);

  return CREW.map((meta) => {
    const mine = activeSteps.filter((row) => asAgent(row.agent_name, String(row.step_key)) === meta.agent);
    const running = mine.find((row) => row.status === "running");
    const today = todayRows.find((row) => String(row.agent) === meta.agent);
    const lastItem = feed.find((item) => item.agent === meta.agent) ?? null;
    const last = lastRows.find((row) => String(row.agent_name) === meta.agent);
    return deriveCrewMember(meta, {
      lastAttemptAt: iso(last?.last_attempt_at),
      lastSuccessAt: iso(last?.last_success_at),
      nextRunAt: nextRunFor(registry.find((entry) => entry.agent === meta.agent)?.schedules ?? [], now),
      runningStep: running
        ? { title: String(running.title), stateCode: running.state_code ? String(running.state_code) : null }
        : null,
      queuedSteps: mine.filter((row) => row.status === "queued").length,
      activeRuns,
      lastItem,
      failedRecently: Number(today?.failed ?? 0) > 0 && lastItem?.tone === "error",
      doneToday: Number(today?.finished ?? 0),
    });
  });
}
