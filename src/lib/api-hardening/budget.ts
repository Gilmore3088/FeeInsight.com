import { sql } from "@/lib/data-store/connection";
import { getApiRoutePolicy } from "./policies";
import { recordApiRouteAuditEvent } from "./audit";

export type BudgetBlockReason =
  | "budget_policy_missing"
  | "budget_policy_disabled"
  | "budget_caps_missing"
  | "budget_lookup_failed"
  | "budget_daily_exhausted"
  | "budget_monthly_exhausted"
  | "budget_run_cap_exhausted"
  | "budget_tick_cap_exhausted";

interface BudgetPolicyRow {
  id: number;
  policy_key: string;
  scope: string;
  route_id: string | null;
  agent_name: string | null;
  enabled: boolean;
  hard_daily_microusd: number | string | null;
  hard_monthly_microusd: number | string | null;
  max_provider_calls_per_window: number | null;
  max_provider_calls_per_run: number | null;
  max_provider_calls_per_tick: number | null;
  max_estimated_cost_per_run_microusd: number | string | null;
  max_estimated_cost_per_tick_microusd: number | string | null;
  fail_closed: boolean;
}

export interface ProviderBudgetContext {
  provider: string;
  model: string;
  agent: string;
  operation: string;
  routeId?: string;
  agentRunId?: number;
  userId?: number | null;
  subjectKey?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ProviderBudgetDecision {
  allowed: boolean;
  reasonCode?: BudgetBlockReason;
  policyId?: number;
  policyKey?: string;
  message?: string;
}

export interface CronTickBudgetRequest {
  routeId: string;
  requestedRunLimit: number;
  requestedMaxStepsPerRun: number;
  requestedStateLaneLimit: number;
  triggeredBy: string;
}

export interface CronTickBudgetDecision {
  allowed: boolean;
  reasonCode?: BudgetBlockReason;
  policyId?: number;
  message?: string;
  /** Runs this tick that may take paid steps (each up to maxStepsPerRun of them). */
  maxRuns?: number;
  maxStepsPerRun?: number;
  maxProviderCalls?: number;
  maxEstimatedMicrousd?: number;
}

export class ProviderBudgetBlockedError extends Error {
  reasonCode: BudgetBlockReason;
  policyId?: number;
  policyKey?: string;

  constructor(reasonCode: BudgetBlockReason, message: string, policy?: BudgetPolicyRow | null) {
    super(message);
    this.name = "ProviderBudgetBlockedError";
    this.reasonCode = reasonCode;
    this.policyId = policy?.id;
    this.policyKey = policy?.policy_key;
  }
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function usd(microusd: number): string {
  return `$${(microusd / 1_000_000).toFixed(2)}`;
}

/**
 * Names the cap a block hit: its kind, the policy key and its scope, so a stop message
 * says which cap ended the work ("Daily cap agent:magellan (agent magellan)").
 */
function capLabel(policy: BudgetPolicyRow, kind: string): string {
  const scope = policy.scope === "agent" && policy.agent_name
    ? `agent ${policy.agent_name}`
    : policy.scope === "route" && policy.route_id
      ? `route ${policy.route_id}`
      : "all agents";
  return `${kind.charAt(0).toUpperCase()}${kind.slice(1)} cap ${policy.policy_key} (${scope})`;
}

function runScope(policy: BudgetPolicyRow): string {
  return policy.scope === "agent" && policy.agent_name ? ` by ${policy.agent_name} in this run` : " in this run";
}

function monthStart(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function dayStart(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

function routePolicyKey(routeId: string | undefined): string | null {
  return routeId ? `route:${routeId}` : null;
}

function agentPolicyKey(agent: string): string {
  return `agent:${agent.toLowerCase()}`;
}

async function loadPolicies(policyKeys: string[]): Promise<Map<string, BudgetPolicyRow>> {
  const rows = await sql`
    SELECT id, policy_key, scope, route_id, agent_name, enabled,
           hard_daily_microusd, hard_monthly_microusd,
           max_provider_calls_per_window, max_provider_calls_per_run,
           max_provider_calls_per_tick,
           max_estimated_cost_per_run_microusd,
           max_estimated_cost_per_tick_microusd,
           fail_closed
      FROM public.api_budget_policies
     WHERE policy_key = ANY(${policyKeys})
  `;
  return new Map(rows.map((row) => [String(row.policy_key), row as unknown as BudgetPolicyRow]));
}

function ensurePolicyConfigured(policy: BudgetPolicyRow | undefined, key: string): BudgetPolicyRow {
  if (!policy) {
    throw new ProviderBudgetBlockedError(
      "budget_policy_missing",
      `Provider budget policy ${key} is missing; provider calls are fail-closed until caps are configured.`,
      null,
    );
  }
  if (!policy.enabled) {
    throw new ProviderBudgetBlockedError(
      "budget_policy_disabled",
      `Provider budget policy ${key} is disabled; configure explicit caps before provider calls can run.`,
      policy,
    );
  }
  const daily = toNumber(policy.hard_daily_microusd);
  const monthly = toNumber(policy.hard_monthly_microusd);
  const runCalls = policy.max_provider_calls_per_run;
  const tickCalls = policy.max_provider_calls_per_tick;
  const runCost = toNumber(policy.max_estimated_cost_per_run_microusd);
  const tickCost = toNumber(policy.max_estimated_cost_per_tick_microusd);
  if (
    daily === null
    && monthly === null
    && runCalls === null
    && tickCalls === null
    && runCost === null
    && tickCost === null
  ) {
    throw new ProviderBudgetBlockedError(
      "budget_caps_missing",
      `Provider budget policy ${key} has no explicit caps; provider calls are fail-closed.`,
      policy,
    );
  }
  return policy;
}

async function currentSpendMicrousd(policy: BudgetPolicyRow, sinceIso: string): Promise<number> {
  let rows;
  if (policy.scope === "route" && policy.route_id) {
    rows = await sql`
      SELECT COALESCE(SUM(COALESCE(estimated_cost_microusd, 0)), 0)::bigint AS microusd
        FROM public.ai_api_usage_events
       WHERE status = 'completed'
         AND route_id = ${policy.route_id}
         AND created_at >= ${sinceIso}
    `;
  } else if (policy.scope === "agent" && policy.agent_name) {
    rows = await sql`
      SELECT COALESCE(SUM(COALESCE(estimated_cost_microusd, 0)), 0)::bigint AS microusd
        FROM public.ai_api_usage_events
       WHERE status = 'completed'
         AND agent_name = ${policy.agent_name}
         AND created_at >= ${sinceIso}
    `;
  } else {
    rows = await sql`
      SELECT COALESCE(SUM(COALESCE(estimated_cost_microusd, 0)), 0)::bigint AS microusd
        FROM public.ai_api_usage_events
       WHERE status = 'completed'
         AND created_at >= ${sinceIso}
    `;
  }
  return toNumber(rows[0]?.microusd) ?? 0;
}

async function assertWindowSpend(policy: BudgetPolicyRow): Promise<void> {
  const dailyCap = toNumber(policy.hard_daily_microusd);
  if (dailyCap !== null) {
    const dailySpend = await currentSpendMicrousd(policy, dayStart());
    if (dailySpend >= dailyCap) {
      throw new ProviderBudgetBlockedError(
        "budget_daily_exhausted",
        `${capLabel(policy, "daily")}: ${usd(dailySpend)} used of ${usd(dailyCap)}; resets 00:00 UTC.`,
        policy,
      );
    }
  }

  const monthlyCap = toNumber(policy.hard_monthly_microusd);
  if (monthlyCap !== null) {
    const monthlySpend = await currentSpendMicrousd(policy, monthStart());
    if (monthlySpend >= monthlyCap) {
      throw new ProviderBudgetBlockedError(
        "budget_monthly_exhausted",
        `${capLabel(policy, "monthly")}: ${usd(monthlySpend)} used of ${usd(monthlyCap)}; resets the 1st at 00:00 UTC.`,
        policy,
      );
    }
  }
}

async function agentRunUsage(
  agentRunId: number,
  agentName: string,
): Promise<{ actualCalls: number; actualCost: number }> {
  const [row] = await sql`
    SELECT COALESCE(SUM(request_count), 0)::bigint AS calls,
           COALESCE(SUM(COALESCE(estimated_cost_microusd, 0)), 0)::bigint AS microusd
      FROM public.ai_api_usage_events
     WHERE status = 'completed'
       AND agent_run_id = ${agentRunId}
       AND agent_name = ${agentName}
  `;
  return { actualCalls: Number(row?.calls ?? 0), actualCost: Number(row?.microusd ?? 0) };
}

async function assertRunCaps(
  context: ProviderBudgetContext,
  policies: readonly BudgetPolicyRow[],
): Promise<void> {
  if (!context.agentRunId) return;
  const [run] = await sql`
    SELECT actual_provider_calls, actual_estimated_cost_microusd
      FROM public.agent_runs
     WHERE id = ${context.agentRunId}
     LIMIT 1
  `;
  const runCalls = Number(run?.actual_provider_calls ?? 0);
  const runCost = Number(run?.actual_estimated_cost_microusd ?? 0);

  for (const policy of policies) {
    // An agent's per-run cap counts only that agent's calls in the run. One state run holds
    // several agents' paid steps, and counting the whole run let earlier agents use up a
    // later agent's cap before it made a single call.
    const { actualCalls, actualCost } = policy.scope === "agent" && policy.agent_name
      ? await agentRunUsage(context.agentRunId, policy.agent_name)
      : { actualCalls: runCalls, actualCost: runCost };
    const callCap = policy.max_provider_calls_per_run;
    if (callCap !== null && actualCalls >= callCap) {
      throw new ProviderBudgetBlockedError(
        "budget_run_cap_exhausted",
        `${capLabel(policy, "per-run call")} reached in run ${context.agentRunId}: ${actualCalls} of ${callCap} calls${runScope(policy)}; a new run starts at 0.`,
        policy,
      );
    }
    const costCap = toNumber(policy.max_estimated_cost_per_run_microusd);
    if (costCap !== null && actualCost >= costCap) {
      throw new ProviderBudgetBlockedError(
        "budget_run_cap_exhausted",
        `${capLabel(policy, "per-run spend")} reached in run ${context.agentRunId}: ${usd(actualCost)} used of ${usd(costCap)}${runScope(policy)}; a new run starts at $0.`,
        policy,
      );
    }
  }
}

export async function recordBudgetBlockedAttempt(
  context: ProviderBudgetContext,
  error: ProviderBudgetBlockedError,
): Promise<void> {
  if (!context.routeId) return;
  try {
    const policy = getApiRoutePolicy(context.routeId);
    await recordApiRouteAuditEvent({
      policy,
      statusCode: 423,
      outcome: "blocked",
      userId: context.userId ?? null,
      subjectKey: context.subjectKey ?? null,
      budgetPolicyId: error.policyId ?? null,
      provider: context.provider,
      model: context.model,
      agentName: context.agent,
      operation: context.operation,
      reasonCode: error.reasonCode,
      metadata: {
        policy_key: error.policyKey ?? null,
        message: error.message,
        ...(context.metadata ?? {}),
      },
    });
  } catch (auditError) {
    console.error("Provider budget block audit failed", auditError);
  }
}

export async function assertProviderBudgetAllowed(
  context: ProviderBudgetContext,
): Promise<ProviderBudgetDecision> {
  const keys = [
    "global:provider:default",
    routePolicyKey(context.routeId),
    agentPolicyKey(context.agent),
  ].filter((key): key is string => Boolean(key));

  try {
    const policyMap = await loadPolicies(keys);
    const policies = keys.map((key) => ensurePolicyConfigured(policyMap.get(key), key));

    for (const policy of policies) {
      await assertWindowSpend(policy);
    }
    await assertRunCaps(context, policies);

    return {
      allowed: true,
      policyId: policies[0]?.id,
      policyKey: policies[0]?.policy_key,
    };
  } catch (error) {
    if (error instanceof ProviderBudgetBlockedError) {
      return {
        allowed: false,
        reasonCode: error.reasonCode,
        policyId: error.policyId,
        policyKey: error.policyKey,
        message: error.message,
      };
    }

    const lookupError = new ProviderBudgetBlockedError(
      "budget_lookup_failed",
      `Provider budget lookup failed; provider calls are fail-closed. ${error instanceof Error ? error.message : String(error)}`,
      null,
    );
    return {
      allowed: false,
      reasonCode: lookupError.reasonCode,
      message: lookupError.message,
    };
  }
}

export function providerBudgetDecisionToError(
  decision: ProviderBudgetDecision,
): ProviderBudgetBlockedError {
  return new ProviderBudgetBlockedError(
    decision.reasonCode ?? "budget_lookup_failed",
    decision.message ?? "Provider budget guard blocked this call.",
    decision.policyId
      ? ({
          id: decision.policyId,
          policy_key: decision.policyKey ?? "unknown",
        } as BudgetPolicyRow)
      : null,
  );
}

function defaultProviderStepEstimateMicrousd(): number {
  const parsed = Number(process.env.PROVIDER_ESTIMATE_MICROUSD_PER_AGENT_STEP ?? 100_000);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 100_000;
}

export async function assertCronTickBudgetAllowed(
  request: CronTickBudgetRequest,
): Promise<CronTickBudgetDecision> {
  const key = `route:${request.routeId}`;
  try {
    const policies = await loadPolicies([key]);
    const policy = ensurePolicyConfigured(policies.get(key), key);
    const callCap = policy.max_provider_calls_per_tick;
    if (callCap === null) {
      throw new ProviderBudgetBlockedError(
        "budget_caps_missing",
        `Cron tick policy ${key} must set max_provider_calls_per_tick before agent drains can run.`,
        policy,
      );
    }
    const costCap = toNumber(policy.max_estimated_cost_per_tick_microusd);
    if (costCap === null) {
      throw new ProviderBudgetBlockedError(
        "budget_caps_missing",
        `Cron tick policy ${key} must set max_estimated_cost_per_tick_microusd before agent drains can run.`,
        policy,
      );
    }

    // A tick may ask for more runs than the caps cover; only that many runs get to take
    // paid steps (each run takes at most maxStepsPerRun of them). Refusing the whole
    // tick instead skipped every queued paid pass whenever runs x steps exceeded the cap.
    const steps = Math.max(request.requestedMaxStepsPerRun, 1);
    const stepEstimate = defaultProviderStepEstimateMicrousd();
    const providerRuns = Math.min(
      request.requestedRunLimit,
      Math.floor(callCap / steps),
      stepEstimate > 0 ? Math.floor(costCap / (steps * stepEstimate)) : request.requestedRunLimit,
    );
    if (providerRuns < 1) {
      throw new ProviderBudgetBlockedError(
        "budget_tick_cap_exhausted",
        `Cron tick needs room for ${steps} provider calls (${steps * stepEstimate} microusd) per run; caps are ${callCap} calls and ${costCap} microusd.`,
        policy,
      );
    }

    await assertWindowSpend(policy);

    return {
      allowed: true,
      policyId: policy.id,
      maxRuns: providerRuns,
      maxStepsPerRun: request.requestedMaxStepsPerRun,
      maxProviderCalls: callCap,
      maxEstimatedMicrousd: costCap,
    };
  } catch (error) {
    if (error instanceof ProviderBudgetBlockedError) {
      const routePolicy = getApiRoutePolicy(request.routeId);
      await recordApiRouteAuditEvent({
        policy: routePolicy,
        method: "GET",
        path: routePolicy.routeTemplate,
        statusCode: 423,
        outcome: "blocked",
        budgetPolicyId: error.policyId ?? null,
        reasonCode: error.reasonCode,
        metadata: {
          triggered_by: request.triggeredBy,
          requested_run_limit: request.requestedRunLimit,
          requested_max_steps_per_run: request.requestedMaxStepsPerRun,
          requested_state_lane_limit: request.requestedStateLaneLimit,
          policy_key: error.policyKey ?? null,
          message: error.message,
        },
      });
      return {
        allowed: false,
        reasonCode: error.reasonCode,
        policyId: error.policyId,
        message: error.message,
      };
    }

    const message = error instanceof Error ? error.message : String(error);
    return {
      allowed: false,
      reasonCode: "budget_lookup_failed",
      message: `Cron tick budget lookup failed; agent drains are fail-closed. ${message}`,
    };
  }
}
