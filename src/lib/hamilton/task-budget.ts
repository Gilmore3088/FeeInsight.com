/**
 * Hamilton task budgets (#1921, V5 item O1).
 *
 * A Hamilton task is one reader request that may make several paid model calls: an Ask
 * (written answer or memo), a report, a Simulate read, a chat turn, a briefing. Each task
 * kind has a cap on provider calls, tokens and estimated cost, and each reader has a cap per
 * UTC day across every Hamilton task. Both are checked before every provider call, inside
 * `guardProviderCall` (src/lib/ai-provider-usage.ts), after the global provider stop, the
 * credit circuit and the database budget policies, none of which change. A call over a cap is
 * refused (fail closed), recorded as a `blocked` row in `ai_api_usage_events` like every other
 * budget block, and, when the task has a run, as a `budget.blocked` event on that run.
 *
 * The caps are code constants, not settings: no environment variable or table row changes
 * them. They sit above the averages the V5 plan targets (Ask <= $0.25, board brief <= $3) and
 * above the largest single calls seen in the 60 days to 2026-10-25 (written answer $0.67 and
 * 148k tokens; report section $0.18 and 23k tokens; chat $0.39), so normal work is not stopped.
 *
 * Work outside a task scope (admin evals, public report runs, pipeline agents) is not
 * changed: with no scope this module does nothing.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "@/lib/data-store/connection";
import { ProviderBudgetBlockedError } from "@/lib/api-hardening/budget";
import { incurredProviderUsageSql } from "@/lib/provider-usage-accounting";

export type HamiltonTaskKind = "ask" | "report" | "simulate" | "chat" | "briefing";

export interface HamiltonTaskCaps {
  /** Provider calls that reached the model (completed, or failed with observed usage). */
  calls: number;
  /** Input + output + cache-write tokens. Cache reads are left out: they are billed in cost. */
  tokens: number;
  /** Estimated cost in micro-USD, from the list prices in ai-provider.ts. */
  costMicrousd: number;
}

/** Per-task caps. A report allows 3 sections x (draft + figure redraft) x one retry, plus the partner rewrite. */
export const HAMILTON_TASK_BUDGETS: Readonly<Record<HamiltonTaskKind, HamiltonTaskCaps>> = Object.freeze({
  ask: { calls: 6, tokens: 400_000, costMicrousd: 2_000_000 },
  report: { calls: 16, tokens: 400_000, costMicrousd: 4_000_000 },
  simulate: { calls: 3, tokens: 60_000, costMicrousd: 500_000 },
  chat: { calls: 2, tokens: 250_000, costMicrousd: 1_500_000 },
  // No paid briefing call exists today (the briefing is built without a model); the cap is
  // here so one that is added is capped from its first call.
  briefing: { calls: 3, tokens: 120_000, costMicrousd: 1_000_000 },
});

/**
 * One reader's cap per UTC day across all Hamilton provider work. Kept below the Hamilton-wide
 * daily policy ($20, `agent:hamilton` in api_budget_policies on 2026-10-25), so one reader can
 * never use the whole day's Hamilton budget.
 */
export const HAMILTON_READER_DAILY_BUDGET: Readonly<HamiltonTaskCaps> = Object.freeze({
  calls: 120,
  tokens: 3_000_000,
  costMicrousd: 10_000_000,
});

/** What a reader sees when a single task reaches its cap. */
export const HAMILTON_TASK_CAP_MESSAGE =
  "Hamilton stopped this request because it reached the limit for a single request. Try a narrower question, or a report with fewer sections.";

/** What a reader sees when their day's Hamilton work reaches its cap. */
export const HAMILTON_READER_DAILY_CAP_MESSAGE =
  "You've reached today's limit for Hamilton's written work. It resets at midnight UTC. Everything else on Fee Insight still works.";

/** What a reader sees when the day's usage cannot be read: the call is refused, not guessed. */
export const HAMILTON_BUDGET_UNREADABLE_MESSAGE =
  "Hamilton could not check today's usage, so it did not start this request. Please try again in a minute.";

export type HamiltonBudgetScope = "task" | "reader_daily" | "unreadable";
export type HamiltonBudgetMeasure = keyof HamiltonTaskCaps;

/** A refused call. A ProviderBudgetBlockedError, so every existing budget handler treats it as one. */
export class HamiltonTaskBudgetError extends ProviderBudgetBlockedError {
  constructor(
    readonly scope: HamiltonBudgetScope,
    readonly measure: HamiltonBudgetMeasure | null,
    readonly used: number | null,
    readonly cap: number | null,
    readonly taskKind: HamiltonTaskKind,
  ) {
    super(
      scope === "task" ? "budget_task_cap_exhausted" : scope === "reader_daily" ? "budget_reader_daily_exhausted" : "budget_lookup_failed",
      scope === "task" ? HAMILTON_TASK_CAP_MESSAGE : scope === "reader_daily" ? HAMILTON_READER_DAILY_CAP_MESSAGE : HAMILTON_BUDGET_UNREADABLE_MESSAGE,
      null,
    );
    this.name = "HamiltonTaskBudgetError";
  }
}

export interface HamiltonTaskUsage {
  calls: number;
  tokens: number;
  costMicrousd: number;
}

export interface HamiltonTaskScope {
  kind: HamiltonTaskKind;
  /** Stable id for logs and ledger metadata. */
  taskId: string;
  userId: number | null;
  /** The run this task writes to; set once a durable run is open. */
  agentRunId: number | null;
  caps: HamiltonTaskCaps;
  readerCaps: HamiltonTaskCaps;
  /** Incurred usage in this process. A resumed run also counts the run's earlier calls (`priorUsage`). */
  used: HamiltonTaskUsage;
  /** Usage a resumed run already incurred in earlier attempts, read from the ledger when it opened. */
  priorUsage: HamiltonTaskUsage;
  blocked: Array<{ scope: HamiltonBudgetScope; measure: HamiltonBudgetMeasure | null; used: number | null; cap: number | null; operation: string }>;
}

const storage = new AsyncLocalStorage<HamiltonTaskScope>();

function emptyUsage(): HamiltonTaskUsage {
  return { calls: 0, tokens: 0, costMicrousd: 0 };
}

let taskCounter = 0;

/**
 * Run `work` as one Hamilton task. Every provider call made inside it (including stream
 * callbacks created inside it) is checked against the task's caps and the reader's day.
 * A nested call keeps the outer task: one request is one task.
 */
export function runHamiltonTask<T>(
  kind: HamiltonTaskKind,
  options: { userId?: number | null; agentRunId?: number | null; caps?: HamiltonTaskCaps; readerCaps?: HamiltonTaskCaps },
  work: (scope: HamiltonTaskScope) => T,
): T {
  const outer = storage.getStore();
  if (outer) {
    if (options.userId != null && outer.userId == null) outer.userId = options.userId;
    if (options.agentRunId != null && outer.agentRunId == null) outer.agentRunId = options.agentRunId;
    return work(outer);
  }
  const scope: HamiltonTaskScope = {
    kind,
    taskId: `${kind}-${Date.now().toString(36)}-${(taskCounter++).toString(36)}`,
    userId: options.userId ?? null,
    agentRunId: options.agentRunId ?? null,
    caps: options.caps ?? HAMILTON_TASK_BUDGETS[kind],
    readerCaps: options.readerCaps ?? HAMILTON_READER_DAILY_BUDGET,
    used: emptyUsage(),
    priorUsage: emptyUsage(),
    blocked: [],
  };
  return storage.run(scope, () => work(scope));
}

/** Wrap a route handler so each request is one Hamilton task. */
export function withHamiltonTask<TArgs extends unknown[], R>(kind: HamiltonTaskKind, handler: (...args: TArgs) => R): (...args: TArgs) => R {
  return (...args: TArgs) => runHamiltonTask(kind, {}, () => handler(...args));
}

export function currentHamiltonTask(): HamiltonTaskScope | null {
  return storage.getStore() ?? null;
}

/** Name the reader once the route has signed them in. */
export function bindHamiltonTaskReader(userId: number | null | undefined): void {
  const scope = storage.getStore();
  if (scope && userId != null && scope.userId == null) scope.userId = userId;
}

function total(scope: HamiltonTaskScope): HamiltonTaskUsage {
  return {
    calls: scope.used.calls + scope.priorUsage.calls,
    tokens: scope.used.tokens + scope.priorUsage.tokens,
    costMicrousd: scope.used.costMicrousd + scope.priorUsage.costMicrousd,
  };
}

/** The first measure at or over its cap, or null. */
export function overCap(used: HamiltonTaskUsage, caps: HamiltonTaskCaps): { measure: HamiltonBudgetMeasure; used: number; cap: number } | null {
  for (const measure of ["calls", "tokens", "costMicrousd"] as const) {
    if (used[measure] >= caps[measure]) return { measure, used: used[measure], cap: caps[measure] };
  }
  return null;
}

/** The reader's incurred Hamilton usage since 00:00 UTC, from the provider usage ledger. */
export async function readReaderDailyUsage(userId: number, now: Date = new Date()): Promise<HamiltonTaskUsage> {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const [row] = await sql`
    SELECT COALESCE(SUM(request_count), 0)::bigint AS calls,
           COALESCE(SUM(input_tokens + output_tokens + cache_creation_input_tokens), 0)::bigint AS tokens,
           COALESCE(SUM(COALESCE(estimated_cost_microusd, 0)), 0)::bigint AS microusd
      FROM public.ai_api_usage_events
     WHERE ${incurredProviderUsageSql(sql)}
       AND agent_name = 'hamilton'
       AND user_id = ${userId}
       AND created_at >= ${since}
  `;
  return { calls: Number(row?.calls ?? 0), tokens: Number(row?.tokens ?? 0), costMicrousd: Number(row?.microusd ?? 0) };
}

/** A run's incurred Hamilton usage across all its attempts, for a resumed report run. */
export async function readRunUsage(agentRunId: number): Promise<HamiltonTaskUsage> {
  const [row] = await sql`
    SELECT COALESCE(SUM(request_count), 0)::bigint AS calls,
           COALESCE(SUM(input_tokens + output_tokens + cache_creation_input_tokens), 0)::bigint AS tokens,
           COALESCE(SUM(COALESCE(estimated_cost_microusd, 0)), 0)::bigint AS microusd
      FROM public.ai_api_usage_events
     WHERE ${incurredProviderUsageSql(sql)}
       AND agent_name = 'hamilton'
       AND agent_run_id = ${agentRunId}
  `;
  return { calls: Number(row?.calls ?? 0), tokens: Number(row?.tokens ?? 0), costMicrousd: Number(row?.microusd ?? 0) };
}

interface TaskCallContext {
  agent: string;
  operation: string;
  agentRunId?: number;
  userId?: number | null;
  metadata?: Record<string, unknown>;
}

/**
 * Tag a provider call with its task before any check runs: the reader and the run, so the
 * usage row it writes counts toward the reader's day and the run's ledger.
 */
export function attachHamiltonTask(context: TaskCallContext): HamiltonTaskScope | null {
  const scope = storage.getStore();
  if (!scope || context.agent !== "hamilton") return null;
  if (context.userId == null && scope.userId != null) context.userId = scope.userId;
  if (context.userId != null && scope.userId == null) scope.userId = context.userId;
  if (context.agentRunId == null && scope.agentRunId != null) context.agentRunId = scope.agentRunId;
  context.metadata = { ...(context.metadata ?? {}), hamilton_task: scope.kind, hamilton_task_id: scope.taskId };
  return scope;
}

async function recordBlockedOnRun(scope: HamiltonTaskScope, error: HamiltonTaskBudgetError, operation: string): Promise<void> {
  if (!scope.agentRunId) return;
  try {
    await sql`
      INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
      VALUES (${scope.agentRunId}, 'budget.blocked', 'blocked', ${error.message},
              ${JSON.stringify({ scope: error.scope, measure: error.measure, used: error.used, cap: error.cap, task: scope.kind, operation })}::jsonb)
    `;
  } catch (writeError) {
    console.error("[hamilton-task-budget] could not record the block on the run", writeError);
  }
}

/**
 * Refuse the call when the task or the reader's day is at a cap. Throws HamiltonTaskBudgetError;
 * the caller (guardProviderCall) records the blocked usage row. A day that cannot be read is
 * refused too: no paid call is made on a guess.
 */
export async function assertHamiltonTaskBudget(context: TaskCallContext, now: Date = new Date()): Promise<void> {
  const scope = attachHamiltonTask(context);
  if (!scope) return;
  const refuse = async (error: HamiltonTaskBudgetError): Promise<never> => {
    scope.blocked.push({ scope: error.scope, measure: error.measure, used: error.used, cap: error.cap, operation: context.operation });
    context.metadata = { ...(context.metadata ?? {}), budget_reason_code: error.reasonCode, hamilton_budget_scope: error.scope, hamilton_budget_measure: error.measure };
    await recordBlockedOnRun(scope, error, context.operation);
    throw error;
  };
  const task = overCap(total(scope), scope.caps);
  if (task) await refuse(new HamiltonTaskBudgetError("task", task.measure, task.used, task.cap, scope.kind));
  const userId = context.userId ?? scope.userId;
  if (userId == null) return;
  let day: HamiltonTaskUsage;
  try {
    day = await readReaderDailyUsage(userId, now);
  } catch {
    return refuse(new HamiltonTaskBudgetError("unreadable", null, null, null, scope.kind));
  }
  const daily = overCap(day, scope.readerCaps);
  if (daily) await refuse(new HamiltonTaskBudgetError("reader_daily", daily.measure, daily.used, daily.cap, scope.kind));
}

/** Count one recorded provider call toward its task. Called by recordProviderUsage. */
export function noteHamiltonTaskUsage(
  context: { agent: string; requestCount?: number },
  incurred: boolean,
  usage: { inputTokens?: number; outputTokens?: number; cacheCreationInputTokens?: number },
  estimatedCostMicrousd: number | null,
): void {
  const scope = storage.getStore();
  if (!scope || context.agent !== "hamilton" || !incurred) return;
  scope.used.calls += context.requestCount ?? 1;
  scope.used.tokens += (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) + (usage.cacheCreationInputTokens ?? 0);
  scope.used.costMicrousd += estimatedCostMicrousd ?? 0;
}

/** For the run ledger: what the task used against its caps. */
export function hamiltonTaskBudgetDetail(scope: HamiltonTaskScope | null): Record<string, unknown> | null {
  if (!scope) return null;
  return {
    kind: scope.kind,
    task_id: scope.taskId,
    used: total(scope),
    caps: scope.caps,
    reader_daily_caps: scope.readerCaps,
    blocked: scope.blocked,
  };
}

/**
 * Tie the current task to its run once the run is open. A resumed run also counts what its
 * earlier attempts already used, so a replay cannot spend past the task's cap.
 */
export async function bindHamiltonTaskRun(agentRunId: number, options: { resumed: boolean }): Promise<void> {
  const scope = storage.getStore();
  if (!scope) return;
  scope.agentRunId = agentRunId;
  if (!options.resumed) return;
  try {
    scope.priorUsage = await readRunUsage(agentRunId);
  } catch {
    // Unknown earlier usage: fail closed by treating the task as spent.
    scope.priorUsage = { ...scope.caps };
  }
}
