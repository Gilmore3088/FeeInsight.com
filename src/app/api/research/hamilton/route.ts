import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { streamText, generateText, convertToModelMessages, stepCountIs, type UIMessage } from "ai";
import {
  guardProviderCall,
  ProviderBudgetBlockedError,
  ProviderCircuitOpenError,
  recordProviderUsage,
  trackAnthropicRequest,
  estimateAnthropicCostMicrousd,
} from "@/lib/ai-provider-usage";
import {
  getAnthropicLanguageModel,
  hasAnthropicApiKey,
  MISSING_ANTHROPIC_API_KEY_MESSAGE,
} from "@/lib/ai-provider";
import { getHamilton, buildAnalyzeModeSuffix, buildMonitorModeSuffix, type HamiltonRole } from "@/lib/research/agents";
import { evaluateCitationDensity } from "@/lib/hamilton/citation-gate";
import { getCurrentUser, type User } from "@/lib/auth";
import { checkProAiQuota, quotaExceededMessage } from "@/lib/hamilton/quota";
import { logUsage } from "@/lib/research/history";
import {
  detectSkill,
  buildSkillInjection,
  buildSkillExecution,
  isSkillOptIn,
  findOfferedSkill,
} from "@/lib/research/skills";
import { canAccessPremium } from "@/lib/access";
import { buildHamiltonInstitutionBriefing } from "@/lib/hamilton/institution-briefing";
import {
  buildHamiltonRequestContractPrompt,
  parseHamiltonRequestContract,
  type HamiltonAudience,
  type HamiltonRequestContract,
} from "@/lib/hamilton/request-contract";
import { getRequestSubjectKey } from "@/lib/api-hardening/audit";

export const maxDuration = 300;

// Cost per 1M tokens (in cents) for estimation
/** Cents for the research_usage log, from the shared price map. */
function estimateCostCents(model: string, inputTokens: number, outputTokens: number): number {
  return Math.round((estimateAnthropicCostMicrousd(model, { inputTokens, outputTokens }) ?? 0) / 10_000);
}

async function handlePOST(request: Request) {
  // Resolve role from session
  let user: User | null = null;
  const subjectKey = getRequestSubjectKey(request);
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  let role: HamiltonRole = "consumer";

  user = await getCurrentUser();
  if (!user) {
    return Response.json(
      {
        error: "Authentication required",
        code: "public_ai_disabled",
        message: "Public Hamilton AI is disabled. Sign in with a Seat License to run provider-backed analysis.",
      },
      { status: 401 },
    );
  }

  if (user) {
    if (user.role === "admin" || user.role === "analyst") {
      role = "admin";
    } else if (user.role === "premium" || canAccessPremium(user)) {
      // Subscription state decides Pro access, not the role label.
      role = "pro";
    } else {
      role = "consumer";
    }
  }

  // Auth enforcement based on resolved role, then the per-user daily quota (Postgres).
  if (role === "pro" && !canAccessPremium(user)) {
    return Response.json({ error: "Active subscription required" }, { status: 403 });
  }
  if (role === "admin" || role === "pro") {
    const quota = await checkProAiQuota(user!);
    if (!quota.allowed) {
      return Response.json(
        { error: quotaExceededMessage(quota), resetAt: quota.resetsAt, used: quota.used, limit: quota.limit },
        { status: 429 }
      );
    }
  } else {
    return Response.json(
      {
        error: "Active subscription required",
        code: "public_ai_disabled",
        message: "Public Hamilton AI is disabled. Use deterministic institution evidence publicly or sign in with a Seat License.",
      },
      { status: 403 },
    );
  }

  if (!hasAnthropicApiKey()) {
    return Response.json(
      { error: MISSING_ANTHROPIC_API_KEY_MESSAGE },
      { status: 503 }
    );
  }

  let messages: UIMessage[];
  let mode: string | undefined;
  let analysisFocus: string | undefined;
  let institutionId: number | null = null;
  // Opt-in citation-density gate. Default false preserves the streaming chat
  // UX (useChat); callers that need a vetted report (report runner, export)
  // set `gate_citations: true` and receive a buffered JSON response that can
  // be `{ status: "ok" }` or `{ status: "refused", reason: "insufficient_citations" }`.
  let gateCitations = false;
  const audience: HamiltonAudience = role;
  let contract: HamiltonRequestContract;
  try {
    const body = await request.json();
    const parsed = parseHamiltonRequestContract(body, {
      audience,
      defaultIntent: "analyze",
      allowGateCitations: true,
    });
    if (!parsed.ok) {
      return Response.json({ error: parsed.error }, { status: parsed.status });
    }
    contract = parsed.contract;
    messages = contract.messages;
    mode = contract.mode;
    analysisFocus = contract.analysisFocus;
    institutionId = contract.institutionId;
    gateCitations = contract.gateCitations;
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const agent = await getHamilton(role);

  // Auto-detect and inject domain skill based on the user's latest message
  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
  const lastUserText =
    lastUserMessage?.parts
      ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join(" ") || "";

  let systemPrompt = agent.systemPrompt;
  systemPrompt += buildHamiltonRequestContractPrompt(contract);

  if (institutionId !== null) {
    const selectedInstitutionContext = await buildHamiltonInstitutionBriefing(contract);
    if (!selectedInstitutionContext) {
      return Response.json({ error: "Institution not found" }, { status: 404 });
    }
    systemPrompt += selectedInstitutionContext;
  }

  // Inject the authenticated user's institution context so Hamilton doesn't
  // ask "what's your institution?" for every analysis (the screenshot showed
  // the user as Space Coast FCU in the left rail but Hamilton requesting
  // identification in the response). Only injected when we actually have it
  // — for anonymous/public users this block is omitted, preserving the
  // model's current generic-mode behavior.
  if (institutionId === null && user && (user.institution_name || user.display_name)) {
    const inst = user.institution_name?.trim() || user.display_name;
    const tier = user.asset_tier ? ` (asset tier ${user.asset_tier})` : "";
    const charter = user.institution_type ? `, ${user.institution_type.replace(/_/g, " ")}` : "";
    const district = user.fed_district ? `, Fed district ${user.fed_district}` : "";
    const state = user.state_code ? `, ${user.state_code}` : "";
    systemPrompt += `\n\nUSER INSTITUTION CONTEXT (do not ask the user to identify themselves — already known):
- Institution: ${inst}${charter}${tier}${district}${state}
- Use this institution as the implicit subject of any benchmarking, peer comparison, or positioning analysis unless the user names a different one.\n`;
  }

  // Analyze mode: override output structure with structured analysis sections (ARCH-05)
  // VALID_FOCUS guards against prompt injection — only known tab values reach the system prompt.
  if (mode === "analyze") {
    const VALID_FOCUS = new Set(["Pricing", "Risk", "Peer Position", "Trend"]);
    const focus = VALID_FOCUS.has(analysisFocus ?? "") ? (analysisFocus as string) : "Pricing";
    systemPrompt += buildAnalyzeModeSuffix(focus);
  }

  // Monitor mode: concise surveillance-oriented responses (Phase 46)
  if (mode === "monitor") {
    systemPrompt += buildMonitorModeSuffix();
  }

  // Check if user is opting in to a previously offered skill deliverable
  if (lastUserText && isSkillOptIn(lastUserText)) {
    const assistantTexts = messages
      .filter((m) => m.role === "assistant")
      .flatMap((m) =>
        (m.parts ?? [])
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => ({ text: p.text }))
      );
    const offeredSkill = findOfferedSkill(assistantTexts);
    if (offeredSkill) {
      systemPrompt += buildSkillExecution(offeredSkill);
    }
  } else {
    // Detect skill match and offer it (without injecting the full template)
    const matchedSkill = lastUserText ? detectSkill(lastUserText) : null;
    if (matchedSkill) {
      systemPrompt += buildSkillInjection(matchedSkill);
    }
  }

  const providerContext = {
    provider: "anthropic" as const,
    model: agent.model,
    agent: "hamilton",
    operation: gateCitations ? "research_with_citation_gate" : "research_stream",
    routeId: "api.research.hamilton",
    userId: user.id,
    subjectKey,
  };
  let providerStartedAt: number | null = null;
  let providerFailed = false;

  try {
    // Buffered (gated) path: for report-generation callers. Trades off
    // streaming UX for a deterministic post-generation citation check. If
    // the gate refuses, we return the structured empty-state shape instead
    // of a partial report. Tokens are still logged via logUsage so cost
    // attribution is unchanged.
    if (gateCitations) {
      const result = await trackAnthropicRequest(
        providerContext,
        async () => generateText({
          model: getAnthropicLanguageModel(agent.model),
          system: systemPrompt,
          messages: await convertToModelMessages(messages),
          tools: agent.tools,
          maxOutputTokens: agent.maxTokens,
          stopWhen: stepCountIs(agent.maxSteps),
        }),
      );

      // totalUsage spans every tool step; usage is only the last step.
      const inputTokens = result.totalUsage?.inputTokens ?? 0;
      const outputTokens = result.totalUsage?.outputTokens ?? 0;
      const costCents = estimateCostCents(agent.model, inputTokens, outputTokens);
      try {
        await logUsage(
          user?.id ?? null,
          user ? null : ip,
          "hamilton",
          inputTokens,
          outputTokens,
          costCents,
        );
      } catch {
        // Non-critical — don't fail the response
      }

      const gate = evaluateCitationDensity(result.text ?? "");
      if (gate.status === "refused") {
        return Response.json(
          {
            status: "refused",
            reason: gate.reason,
            metrics: gate.metrics,
            suggestion: gate.suggestion,
            claims_without_citations: gate.claims_without_citations,
          },
          { status: 200 },
        );
      }

      return Response.json({
        status: "ok",
        text: result.text,
        metrics: gate.metrics,
      });
    }

    providerStartedAt = await guardProviderCall(providerContext);
    const result = streamText({
      model: getAnthropicLanguageModel(agent.model),
      system: systemPrompt,
      messages: await convertToModelMessages(messages),
      tools: agent.tools,
      maxOutputTokens: agent.maxTokens,
      stopWhen: stepCountIs(agent.maxSteps),
      onFinish: async ({ totalUsage }) => {
        try {
          // totalUsage spans every tool step; usage is only the last step.
          const inputTokens = totalUsage?.inputTokens ?? 0;
          const outputTokens = totalUsage?.outputTokens ?? 0;
          const costCents = estimateCostCents(agent.model, inputTokens, outputTokens);
          if (!providerFailed && providerStartedAt !== null) {
            await recordProviderUsage(
              providerContext,
              "completed",
              { inputTokens, outputTokens },
              { latencyMs: Date.now() - providerStartedAt },
            );
          }
          await logUsage(
            user?.id ?? null,
            user ? null : ip,
            "hamilton",
            inputTokens,
            outputTokens,
            costCents
          );
        } catch {
          // Non-critical — don't fail the response
        }
      },
      onError: async ({ error }) => {
        providerFailed = true;
        await recordProviderUsage(providerContext, "failed", {}, {
          latencyMs: providerStartedAt === null ? undefined : Date.now() - providerStartedAt,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "An unexpected error occurred";

    if (providerStartedAt !== null && !providerFailed) {
      providerFailed = true;
      await recordProviderUsage(providerContext, "failed", {}, {
        latencyMs: Date.now() - providerStartedAt,
        error: message,
      });
    }

    if (
      err instanceof ProviderCircuitOpenError
      || err instanceof ProviderBudgetBlockedError
      || message.includes("Emergency stop")
    ) {
      return Response.json({ error: message }, { status: 423 });
    }

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
      { error: "Failed to process your question. Please try again." },
      { status: 500 }
    );
  }
}

export const POST = withApiRoutePolicy("api.research.hamilton", "POST", handlePOST);
