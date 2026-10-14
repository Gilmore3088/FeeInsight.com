import { getAnthropicMessagesClient, type Anthropic, type ProviderAgent } from "@/lib/ai-provider";
import type { sql } from "@/lib/data-store/connection";
import { estimateAnthropicCostMicrousd, trackAnthropicRequest, WEB_SEARCH_COST_MICROUSD } from "@/lib/ai-provider-usage";

export { WEB_SEARCH_COST_MICROUSD };

/**
 * Pass 3, the paid last pass. Free methods (pass 1) and heavier free methods (pass 2)
 * run inside the normal steps; whatever they leave goes to the `*-paid` steps, which
 * are PROVIDER_STEP_KEYS. Every call goes through trackAnthropicRequest, so it is
 * budget-checked first (global, cron-tick and per-agent policies, hard monthly caps)
 * and logged to ai_api_usage_events with its estimated cost. A blocked budget skips
 * the step; it never stalls the state run.
 */

/**
 * The agent a call is logged and budgeted under (`agent:<name>` in api_budget_policies). `wire`
 * is the Regulatory Wire's research notes: its own $25 a month policy (James, 2026-10-12, #1149),
 * so a month's fetching cannot spend the summaries' budget or the other way round. It bills to
 * Magellan's API key (`keyAgent`).
 */
export type PaidPassAgent = "magellan" | "rosetta" | "knox" | "darwin" | "hamilton" | "growth" | "wire";

/** Models per paid job; override per environment. */
export const PAID_PASS_MODELS = {
  find: () => process.env.PIPELINE_PAID_FIND_MODEL?.trim() || "claude-haiku-4-5-20251001",
  read: () => process.env.PIPELINE_PAID_READ_MODEL?.trim() || "claude-sonnet-5-5",
  extract: () => process.env.PIPELINE_PAID_EXTRACT_MODEL?.trim() || "claude-sonnet-5-5",
  verify: () => process.env.PIPELINE_PAID_VERIFY_MODEL?.trim() || "claude-haiku-4-5-20251001",
} as const;

/** Items one paid step may send to the model per run. Keeps a single run's spend small. */
export const PAID_PASS_ITEMS_PER_RUN = 10;

export interface PaidCallResult {
  message: Anthropic.Message;
  costMicrousd: number;
}

type MessageParams = Anthropic.MessageCreateParamsNonStreaming;

export type PaidMessageCreator = (params: MessageParams) => PromiseLike<Anthropic.Message>;

/**
 * One budget-checked, logged model call. Throws ProviderBudgetBlockedError (or the
 * automation stop) before any money is spent when a cap or stop applies.
 */
export async function paidModelCall({
  agent,
  operation,
  runId,
  params,
  create,
  metadata,
  keyAgent,
}: {
  agent: PaidPassAgent;
  /** The agent whose API key pays, when it is not `agent` (the Wire bills to Magellan's key). */
  keyAgent?: ProviderAgent;
  operation: string;
  runId: number;
  params: MessageParams;
  /** Test seam; defaults to the Anthropic Messages API. */
  create?: PaidMessageCreator;
  metadata?: Record<string, unknown>;
}): Promise<PaidCallResult> {
  const billTo: ProviderAgent | undefined = keyAgent ?? (agent === "wire" ? "magellan" : agent);
  const send: PaidMessageCreator = create ?? ((body) => getAnthropicMessagesClient(`${agent} ${operation}`, billTo).messages.create(body));
  const searchSettings = webSearchSettings(params.tools);
  const message = await trackAnthropicRequest(
    { model: params.model, agent, operation, agentRunId: runId, metadata: searchSettings ? { ...metadata, ...searchSettings } : metadata },
    () => send(params),
  );
  return { message, costMicrousd: paidCallCostMicrousd(params.model, message) };
}

/**
 * What a request's web search tool allowed, logged with the call so a search setting's cost and
 * hit rate can be compared before and after it changes (#1035), with the sites a limited search
 * ran on (#1251; null for the open web). Null without a web search tool.
 */
export function webSearchSettings(
  tools: unknown,
): { web_search_max_uses: number | null; web_search_own_site: boolean; web_search_domains: string[] | null } | null {
  if (!Array.isArray(tools)) return null;
  const tool = tools.find((entry): entry is { name: string; max_uses?: number | null; allowed_domains?: string[] | null } =>
    Boolean(entry) && typeof entry === "object" && (entry as { name?: unknown }).name === "web_search");
  if (!tool) return null;
  const domains = Array.isArray(tool.allowed_domains) && tool.allowed_domains.length > 0 ? [...tool.allowed_domains] : null;
  return {
    web_search_max_uses: tool.max_uses ?? null,
    web_search_own_site: domains != null,
    web_search_domains: domains,
  };
}

/**
 * Token cost plus server-tool charges (web search) for one response: the same estimate
 * trackAnthropicRequest writes to ai_api_usage_events, so the attempt log and the ledger
 * the budget caps read agree.
 */
export function paidCallCostMicrousd(model: string, message: Pick<Anthropic.Message, "usage">): number {
  const usage = message.usage;
  return estimateAnthropicCostMicrousd(model, {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadInputTokens: usage?.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: usage?.cache_creation_input_tokens ?? 0,
    webSearchRequests: usage?.server_tool_use?.web_search_requests ?? 0,
  }) ?? 0;
}

/** Text of a model response, joined across text blocks. */
export function paidResponseText(message: Pick<Anthropic.Message, "content">): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/** The first JSON object or array in a model response, or null. */
export function paidResponseJson<T>(message: Pick<Anthropic.Message, "content">): T | null {
  const text = paidResponseText(message);
  const start = text.search(/[[{]/);
  if (start < 0) return null;
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  const end = text.lastIndexOf(close);
  if (end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

/** Options every paid step takes from the run ledger. */
export interface PaidStepOptions {
  runId: number;
  stepId?: number | null;
  dryRun?: boolean;
  limit?: number;
  stateCode?: string;
  db?: typeof sql;
}

/** Shared result shape for the three paid steps. */
export interface PaidPassResult {
  selected: number;
  processed: number;
  succeeded: number;
  failed: number;
  /** True when a budget cap or the automation stop ended the step early. */
  budgetStopped: boolean;
  budgetReason: string | null;
  costMicrousd: number;
  dryRun: boolean;
  results: Array<Record<string, unknown>>;
}

export function emptyPaidPassResult(dryRun = false): PaidPassResult {
  return {
    selected: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
    budgetStopped: false,
    budgetReason: null,
    costMicrousd: 0,
    dryRun,
    results: [],
  };
}
