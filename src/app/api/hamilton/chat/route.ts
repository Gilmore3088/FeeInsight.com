import { ProviderResponseOperation, AI_PROVIDER_TIMEOUT_MS, assertCompletedProviderFinish, requireCompletedProviderUIStream } from "@/lib/ai-response-budget";
import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
/**
 * POST /api/hamilton/chat
 *
 * Hamilton unified research chat endpoint.
 * Streaming AI SDK response — follows the same auth + rate-limit + cost-breaker
 * pattern as /api/research/[agentId]/route.ts.
 *
 * Auth: analyst or admin role required (T-17-02)
 * Memory: optional conversation_id for session continuity (T-17-04, T-17-05)
 * Cost guard: daily circuit breaker at $50 (shared with research agents)
 * Tool loop cap: stepCountIs(10) (T-17-03)
 */

import { streamText, convertToModelMessages, stepCountIs, createUIMessageStreamResponse, type UIMessage } from "ai";
import { guardProviderCall, recordProviderUsage, observedProviderUsage, type ProviderUsage, estimateAnthropicCostMicrousd } from "@/lib/ai-provider-usage";
import {
  getAnthropicLanguageModel,
  getHamiltonModel,
  hasAnthropicApiKey,
  MISSING_ANTHROPIC_API_KEY_MESSAGE,
} from "@/lib/ai-provider";
import { getCurrentUser } from "@/lib/auth";
import { checkProAiQuota, quotaExceededMessage } from "@/lib/hamilton/quota";
import { logUsage } from "@/lib/research/history";
import { buildHamiltonTools, buildHamiltonSystemPrompt } from "@/lib/hamilton/hamilton-agent";
import { loadConversationHistory, appendMessage } from "@/lib/hamilton/chat-memory";
import { buildHamiltonInstitutionBriefing } from "@/lib/hamilton/institution-briefing";
import {
  buildHamiltonRequestContractPrompt,
  parseHamiltonRequestContract,
  type HamiltonRequestContract,
} from "@/lib/hamilton/request-contract";
import { getRequestSubjectKey } from "@/lib/api-hardening/audit";

export const maxDuration = 300;

const HAMILTON_MODEL = getHamiltonModel();

/** Cents for the research_usage log, from the shared price map. */
function estimateCostCents(model: string, inputTokens: number, outputTokens: number): number {
  return Math.round((estimateAnthropicCostMicrousd(model, { inputTokens, outputTokens }) ?? 0) / 10_000);
}


// Cost per 1M tokens (in cents)
async function handlePOST(request: Request) {
  // Check API key
  if (!hasAnthropicApiKey("hamilton")) {
    return Response.json(
      { error: MISSING_ANTHROPIC_API_KEY_MESSAGE },
      { status: 503 }
    );
  }

  // Auth check: analyst or admin only (T-17-02)
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  if (user.role !== "analyst" && user.role !== "admin") {
    return Response.json(
      { error: "Hamilton requires analyst or admin role" },
      { status: 403 }
    );
  }

  // Per-user daily quota, counted in Postgres across instances
  const quota = await checkProAiQuota(user);
  if (!quota.allowed) {
    return Response.json(
      { error: quotaExceededMessage(quota), resetAt: quota.resetsAt },
      { status: 429 }
    );
  }

  // Parse request body
  let messages: UIMessage[];
  let conversationId: string | undefined;
  let contract: HamiltonRequestContract;

  try {
    const body = await request.json();
    const parsed = parseHamiltonRequestContract(body, {
      audience: "admin",
      defaultIntent: "admin-chat",
      allowConversationId: true,
    });
    if (!parsed.ok) {
      return Response.json({ error: parsed.error }, { status: parsed.status });
    }
    contract = parsed.contract;
    messages = contract.messages;
    conversationId = contract.conversationId;
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Prepend conversation history for session continuity (T-17-04: user_id scoped)
  if (conversationId) {
    try {
      const history = await loadConversationHistory(
        conversationId,
        user.id,
        20
      );
      // Inject prior turns as UIMessage objects before the new messages
      if (history.length > 0) {
        const priorMessages: UIMessage[] = history.map((h, i) => ({
          id: `history-${i}`,
          role: h.role,
          parts: [{ type: "text" as const, text: h.content }],
        }));
        messages = [...priorMessages, ...messages];
      }
    } catch {
      // Non-critical — continue without history if load fails
    }
  }

  let systemPrompt = buildHamiltonSystemPrompt();
  systemPrompt += buildHamiltonRequestContractPrompt(contract);
  if (contract.institutionId !== null) {
    const selectedInstitutionContext = await buildHamiltonInstitutionBriefing(contract);
    if (!selectedInstitutionContext) {
      return Response.json({ error: "Institution not found" }, { status: 404 });
    }
    systemPrompt += selectedInstitutionContext;
  }

  const providerContext = {
    provider: "anthropic" as const,
    model: HAMILTON_MODEL,
    agent: "hamilton",
    operation: "chat",
    routeId: "api.hamilton.chat",
    userId: user.id,
    subjectKey: getRequestSubjectKey(request),
  };
  let providerStartedAt: number;
  try {
    providerStartedAt = await guardProviderCall(providerContext);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Automation is stopped" },
      { status: 423 },
    );
  }

  let providerFailed = false;
  let failureRecorded = false;
  let terminalFailure: unknown;
  let failureUsage: ProviderUsage | undefined;
  const scope = new ProviderResponseOperation({ timeoutMs: AI_PROVIDER_TIMEOUT_MS });
  const failProvider = async (error: unknown, observed?: ProviderUsage) => {
    scope.dispose();
    if (observed) failureUsage = observed;
    if (!providerFailed) terminalFailure = error;
    providerFailed = true;
  };
  const flushProviderFailure = async () => {
    if (!providerFailed || failureRecorded) return;
    failureRecorded = true;
    const failure = scope.error ?? terminalFailure;
    await recordProviderUsage(providerContext, "failed", failureUsage ?? {}, {
      latencyMs: Date.now() - providerStartedAt, error: failure instanceof Error ? failure.message : String(failure),
      usageObservation: failureUsage ? "observed" : "unknown",
    });
  };
  try {
    const result = streamText({
      model: getAnthropicLanguageModel(HAMILTON_MODEL, "hamilton", scope),
      abortSignal: scope.signal,
      system: systemPrompt,
      messages: await convertToModelMessages(messages),
      tools: buildHamiltonTools(),
      maxOutputTokens: 3000,
      stopWhen: stepCountIs(10),
      onFinish: async ({ totalUsage: usage, text, finishReason }) => {
        if (providerFailed) { await failProvider(terminalFailure, observedProviderUsage(usage)); return; }
        try { scope.assertHealthy(); assertCompletedProviderFinish(finishReason); }
        catch (error) { await failProvider(error, observedProviderUsage(usage)); return; }
        scope.dispose();
        try {
          const inputTokens = usage?.inputTokens ?? 0;
          const outputTokens = usage?.outputTokens ?? 0;
          const costCents = estimateCostCents(HAMILTON_MODEL, inputTokens, outputTokens);

          if (!providerFailed) {
            await recordProviderUsage(
              providerContext,
              "completed",
              { inputTokens, outputTokens },
              { latencyMs: Date.now() - providerStartedAt },
            );
          }
          await logUsage(user.id, null, "hamilton-chat", inputTokens, outputTokens, costCents);

          // Persist messages to conversation if conversation_id provided
          if (conversationId) {
            // Find the latest user message to persist
            const lastUserMsg = [...messages]
              .reverse()
              .find((m) => m.role === "user");
            const userText = lastUserMsg?.parts
              ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
              .map((p) => p.text)
              .join(" ") ?? "";

            if (userText) {
              await appendMessage(conversationId, user.id, "user", userText).catch(() => {});
            }
            if (text) {
              await appendMessage(conversationId, user.id, "assistant", text, outputTokens).catch(() => {});
            }
          }
        } catch {
          // Non-critical — don't fail the stream
        }
      },
      onAbort: async () => { scope.abort("cancelled"); await failProvider(scope.error); },
      onError: async ({ error }) => { await failProvider(error); },
    });

    // Drain the SDK observer to retain terminal usage; outgoing cancellation still aborts this scope.
    const observeFailure = (error: unknown) => { void failProvider(error); };
    // consumeStream swallows reader failures unless its public onError observer is supplied.
    void Promise.resolve(result.consumeStream({ onError: observeFailure })).catch(observeFailure).finally(async () => { scope.dispose(); await flushProviderFailure(); });
    return scope.wrapOutgoingResponse(createUIMessageStreamResponse({ stream: requireCompletedProviderUIStream(result.toUIMessageStream()) }), () => failProvider(scope.error));
  } catch (err) {
    await failProvider(err);
    await flushProviderFailure();

    const message = err instanceof Error ? err.message : "An unexpected error occurred";
    const stack = err instanceof Error ? err.stack : "";
    console.error("[hamilton/chat] Error:", message, "\nStack:", stack);

    if (message.includes("authentication") || message.includes("API key")) {
      return Response.json(
        { error: "AI service authentication failed. Check API key." },
        { status: 503 }
      );
    }
    if (message.includes("rate") || message.includes("429")) {
      return Response.json(
        { error: "AI service rate limited. Please try again in a moment." },
        { status: 429 }
      );
    }

    return Response.json(
      { error: `Hamilton error: ${message}` },
      { status: 500 }
    );
  }
}

export const POST = withApiRoutePolicy("api.hamilton.chat", "POST", handlePOST);
