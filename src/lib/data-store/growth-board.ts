/**
 * Reads for the growth approval page (`/admin/growth`, growth-os BUILD-PLAN 1.9): growth's
 * recent steps from the run ledger, which marketing agent each belongs to, and the
 * `agent:growth` budget row. Read-only; nothing here writes, sends or posts.
 */

import { sql } from "./connection";
import { isGrowthAgent, type GrowthAgent } from "@/lib/agents/growth/roster";

type SqlTag = typeof sql;

export interface GrowthStep {
  stepId: number;
  runId: number;
  stepKey: string;
  title: string;
  status: string;
  summary: string | null;
  errorSummary: string | null;
  runTitle: string;
  runStatus: string;
  /** When the step started, else when it was queued. */
  at: string | null;
  completedAt: string | null;
  /** The marketing agent the step worked for, or null for team work no single agent owns. */
  agent: GrowthAgent | null;
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * Which marketing agent a growth step worked for. An intake filing names its agent (the run's
 * params and the step's item); the weekly LinkedIn steps (`content-*`) are MURROW's
 * (`growth-os/agents/murrow.md`). The monthly email and the weekly scoring are team work with
 * no single owner yet, so they return null rather than a guess.
 */
export function growthAgentForStep(stepKey: string, runParams: unknown, stepInput: unknown): GrowthAgent | null {
  const params = record(runParams);
  if (isGrowthAgent(params.agent)) return params.agent;
  const item = record(record(stepInput).item);
  if (isGrowthAgent(item.agent)) return item.agent;
  if (stepKey === "content-od-by-state") return "ernest";
  if (stepKey === "growth-contacts" || stepKey === "growth-contact-picks") return "nielsen";
  if (stepKey === "growth-outreach" || stepKey === "growth-quote") return "carnegie";
  if (stepKey === "growth-learning") return "draper";
  if (stepKey === "growth-intel") return "sherlock";
  if (stepKey === "growth-conversion") return "norman";
  if (stepKey === "growth-tools") return "edison";
  if (stepKey === "growth-press") return "bernays";
  if (stepKey.startsWith("content-")) return "murrow";
  return null;
}

/** Growth's newest steps, newest first, with the agent each worked for. */
export async function listGrowthSteps(limit = 60, db: SqlTag = sql): Promise<GrowthStep[]> {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 200);
  const rows = await db`
    SELECT s.id, s.agent_run_id, s.step_key, s.title, s.status, s.summary, s.error_summary,
           s.input_payload, s.queued_at, s.started_at, s.completed_at,
           r.title AS run_title, r.status AS run_status, r.params_json
      FROM agent_run_steps s
      JOIN agent_runs r ON r.id = s.agent_run_id
     WHERE r.agent_name = 'growth'
     ORDER BY COALESCE(s.started_at, s.queued_at) DESC NULLS LAST, s.id DESC
     LIMIT ${safeLimit}
  `;
  return rows.map((row) => ({
    stepId: Number(row.id),
    runId: Number(row.agent_run_id),
    stepKey: String(row.step_key),
    title: String(row.title ?? row.step_key),
    status: String(row.status),
    summary: row.summary ? String(row.summary) : null,
    errorSummary: row.error_summary ? String(row.error_summary) : null,
    runTitle: String(row.run_title ?? ""),
    runStatus: String(row.run_status ?? ""),
    at: iso(row.started_at) ?? iso(row.queued_at),
    completedAt: iso(row.completed_at),
    agent: growthAgentForStep(String(row.step_key), row.params_json, row.input_payload),
  }));
}

export interface GrowthBudgetState {
  /** `missing`: no `agent:growth` row; `off`: the row exists and is disabled. */
  state: "enabled" | "off" | "missing";
  dailyCapUsd: number | null;
  monthlyCapUsd: number | null;
}

function dollars(microusd: unknown): number | null {
  if (microusd === null || microusd === undefined) return null;
  const value = Number(microusd);
  return Number.isFinite(value) ? value / 1_000_000 : null;
}

/** The `agent:growth` budget row as it stands: enabled or off, and its caps. */
export async function readGrowthBudget(db: SqlTag = sql): Promise<GrowthBudgetState> {
  const [row] = await db`
    SELECT enabled, hard_daily_microusd, hard_monthly_microusd
      FROM public.api_budget_policies
     WHERE policy_key = 'agent:growth'
     LIMIT 1
  `;
  if (!row) return { state: "missing", dailyCapUsd: null, monthlyCapUsd: null };
  return {
    state: row.enabled === true ? "enabled" : "off",
    dailyCapUsd: dollars(row.hard_daily_microusd),
    monthlyCapUsd: dollars(row.hard_monthly_microusd),
  };
}
