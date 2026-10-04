import { sql } from "./data-store/connection";
import { anthropicPriceFor } from "@/lib/ai-provider";
import {
  assertAutomationEnabled,
  EmergencyStopActiveError,
  engageEmergencyStop,
  findOpenProviderCreditFailure,
  PROVIDER_CREDIT_ERROR_MARKERS,
} from "./automation-control";
import {
  assertProviderBudgetAllowed,
  ProviderBudgetBlockedError,
  providerBudgetDecisionToError,
} from "./api-hardening/budget";
import { getApiRoutePolicy } from "./api-hardening/policies";
import { recordApiRouteAuditEvent } from "./api-hardening/audit";

export { ProviderBudgetBlockedError } from "./api-hardening/budget";

type ProviderStatus = "completed" | "failed" | "blocked";

export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

export interface ProviderCallContext {
  provider: "anthropic" | string;
  model: string;
  agent: string;
  operation: string;
  routeId?: string;
  agentRunId?: number;
  userId?: number | null;
  subjectKey?: string | null;
  budgetPolicyId?: number | null;
  requestCount?: number;
  metadata?: Record<string, unknown>;
}

export class ProviderCircuitOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderCircuitOpenError";
  }
}

interface AnthropicUsageShape {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
}

function nonNegative(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

function normalizeUsage(usage: AnthropicUsageShape | null | undefined): ProviderUsage {
  return {
    inputTokens: nonNegative(usage?.input_tokens ?? usage?.inputTokens),
    outputTokens: nonNegative(usage?.output_tokens ?? usage?.outputTokens),
    cacheReadInputTokens: nonNegative(usage?.cache_read_input_tokens),
    cacheCreationInputTokens: nonNegative(usage?.cache_creation_input_tokens),
  };
}

function providerErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isProviderCreditError(error: unknown): boolean {
  const message = providerErrorMessage(error).toLowerCase();
  return PROVIDER_CREDIT_ERROR_MARKERS.some((marker) => message.includes(marker));
}

async function engageProviderCreditStop(context: ProviderCallContext): Promise<void> {
  try {
    await engageEmergencyStop(
      "provider-guard",
      `Anthropic API credit balance is too low; automation paused after ${context.agent} ${context.operation}`,
    );
  } catch (stopError) {
    console.error("Failed to engage emergency stop after provider credit error", stopError);
  }
}

async function maybeEngageProviderCreditStop(
  context: ProviderCallContext,
  status: ProviderStatus,
  error: string | undefined,
): Promise<void> {
  if (status !== "failed") return;
  if (context.provider !== "anthropic") return;
  if (!error || !isProviderCreditError(error)) return;
  await engageProviderCreditStop(context);
}

async function recordProviderRouteAudit(
  context: ProviderCallContext,
  status: ProviderStatus,
  options: { latencyMs?: number; error?: string } = {},
): Promise<void> {
  if (!context.routeId) return;
  try {
    const policy = getApiRoutePolicy(context.routeId);
    const reasonCode = typeof context.metadata?.budget_reason_code === "string"
      ? context.metadata.budget_reason_code
      : status === "blocked"
        ? "provider_guard_blocked"
        : status === "failed"
          ? "provider_call_failed"
          : null;
    await recordApiRouteAuditEvent({
      policy,
      method: "POST",
      path: policy.routeTemplate,
      statusCode: status === "completed" ? 200 : status === "blocked" ? 423 : 500,
      outcome: status === "completed" ? "success" : status === "blocked" ? "blocked" : "error",
      latencyMs: options.latencyMs,
      userId: context.userId ?? null,
      subjectKey: context.subjectKey ?? null,
      budgetPolicyId: context.budgetPolicyId ?? null,
      provider: context.provider,
      model: context.model,
      agentName: context.agent,
      operation: context.operation,
      reasonCode,
      metadata: {
        error: options.error?.slice(0, 1000) ?? null,
        ...(context.metadata ?? {}),
      },
    });
  } catch (error) {
    console.error("Provider route audit write failed", error);
  }
}

async function assertProviderCircuitHealthy(context: ProviderCallContext): Promise<void> {
  if (context.provider !== "anthropic") return;

  const failure = await findOpenProviderCreditFailure(context.provider);
  if (!failure) return;

  const seenAt = failure.createdAt;
  const failedAgent = failure.agentName;
  const failedOperation = failure.operation;
  await engageProviderCreditStop(context);
  throw new ProviderCircuitOpenError(
    `Provider circuit is open: latest Anthropic credit-balance failure was ${seenAt} on ${failedAgent}.${failedOperation}. Fix provider billing or move this route off Anthropic before retrying.`,
  );
}

export function estimateAnthropicCostMicrousd(
  model: string,
  usage: ProviderUsage,
): number | null {
  // USD per million tokens equals micro-USD per token.
  const rate = anthropicPriceFor(model);
  if (!rate) return null;
  const input = nonNegative(usage.inputTokens);
  const output = nonNegative(usage.outputTokens);
  const cacheRead = nonNegative(usage.cacheReadInputTokens);
  const cacheCreate = nonNegative(usage.cacheCreationInputTokens);
  return Math.round(
    (input * rate.input)
    + (output * rate.output)
    + (cacheRead * rate.input * 0.1)
    + (cacheCreate * rate.input * 1.25),
  );
}

export async function recordProviderUsage(
  context: ProviderCallContext,
  status: ProviderStatus,
  usage: ProviderUsage = {},
  options: { latencyMs?: number; error?: string } = {},
): Promise<void> {
  const estimatedCost = context.provider === "anthropic"
    ? estimateAnthropicCostMicrousd(context.model, usage)
    : null;
  try {
    await sql`
      INSERT INTO ai_api_usage_events
        (provider, model, agent_name, operation, status, request_count,
         input_tokens, output_tokens, cache_read_input_tokens,
         cache_creation_input_tokens, estimated_cost_microusd, latency_ms,
         agent_run_id, route_id, budget_policy_id, user_id, subject_key,
         error_summary, metadata)
      VALUES
        (${context.provider}, ${context.model}, ${context.agent}, ${context.operation},
         ${status}, ${context.requestCount ?? 1}, ${nonNegative(usage.inputTokens)},
         ${nonNegative(usage.outputTokens)}, ${nonNegative(usage.cacheReadInputTokens)},
         ${nonNegative(usage.cacheCreationInputTokens)}, ${estimatedCost},
         ${options.latencyMs ?? null}, ${context.agentRunId ?? null},
         ${context.routeId ?? null}, ${context.budgetPolicyId ?? null},
         ${context.userId ?? null}, ${context.subjectKey ?? null},
         ${options.error?.slice(0, 1000) ?? null},
         ${JSON.stringify({
           ...(context.metadata ?? {}),
           route_id: context.routeId ?? null,
           budget_policy_id: context.budgetPolicyId ?? null,
           user_id: context.userId ?? null,
           subject_key: context.subjectKey ?? null,
         })}::jsonb)
    `;
  } catch (error) {
    console.error("AI provider usage write failed", error);
  }
  if (context.agentRunId && status === "completed") {
    try {
      await sql`
        UPDATE agent_runs
           SET actual_provider_calls = actual_provider_calls + ${context.requestCount ?? 1},
               actual_estimated_cost_microusd = actual_estimated_cost_microusd + ${estimatedCost ?? 0},
               updated_at = NOW()
         WHERE id = ${context.agentRunId}
      `;
    } catch (error) {
      console.error("AI provider run budget metadata update failed", error);
    }
  }
  await recordProviderRouteAudit(context, status, options);
  await maybeEngageProviderCreditStop(context, status, options.error);
}

export async function guardProviderCall(
  context: ProviderCallContext,
): Promise<number> {
  const startedAt = Date.now();
  try {
    await assertAutomationEnabled(`${context.agent} ${context.operation}`);
    await assertProviderCircuitHealthy(context);
    const budgetDecision = await assertProviderBudgetAllowed(context);
    if (!budgetDecision.allowed) {
      context.budgetPolicyId = budgetDecision.policyId ?? context.budgetPolicyId;
      context.metadata = {
        ...(context.metadata ?? {}),
        budget_reason_code: budgetDecision.reasonCode ?? "budget_lookup_failed",
        budget_policy_key: budgetDecision.policyKey ?? null,
      };
      throw providerBudgetDecisionToError(budgetDecision);
    }
    context.budgetPolicyId = budgetDecision.policyId ?? context.budgetPolicyId;
    return startedAt;
  } catch (error) {
    if (
      error instanceof EmergencyStopActiveError
      || error instanceof ProviderCircuitOpenError
      || error instanceof ProviderBudgetBlockedError
    ) {
      await recordProviderUsage(context, "blocked", {}, { error: error.message });
    }
    throw error;
  }
}

export async function trackAnthropicRequest<T>(
  context: Omit<ProviderCallContext, "provider">,
  request: () => PromiseLike<T>,
): Promise<T> {
  const fullContext: ProviderCallContext = { ...context, provider: "anthropic" };
  const startedAt = await guardProviderCall(fullContext);

  try {
    const response = await request();
    const usage = (response as { usage?: AnthropicUsageShape }).usage;
    await recordProviderUsage(
      fullContext,
      "completed",
      normalizeUsage(usage),
      { latencyMs: Date.now() - startedAt },
    );
    return response;
  } catch (error) {
    const message = providerErrorMessage(error);
    await recordProviderUsage(fullContext, "failed", {}, {
      latencyMs: Date.now() - startedAt,
      error: message,
    });
    throw error;
  }
}
