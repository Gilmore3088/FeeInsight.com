import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import {
  streamText,
  generateText,
  convertToModelMessages,
  stepCountIs,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from "ai";
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
  isProviderLimitError,
  MISSING_ANTHROPIC_API_KEY_MESSAGE,
} from "@/lib/ai-provider";
import { HAMILTON_PAUSED_MESSAGE } from "@/lib/hamilton/provider-paused";
import { viewAsCustomerFromCookieHeader } from "@/lib/hamilton/view-as";
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
import { trackFirstHamiltonUse } from "@/lib/analytics-server";
import { cacheLatestMessage, cachedSystem, ledgerUsage } from "@/lib/research/tool-output";
import { SAVED_ANALYSIS_ID_KEY, questionOnly, writtenAnswerResponse } from "@/lib/hamilton/answer-save";
import { insertSavedAnalysis } from "@/lib/data-store/hamilton-analyses";
import { normalizeCanonicalInstitutionId } from "@/lib/hamilton/context-link";
import { withHamiltonAccountContext } from "@/lib/hamilton/account-context-store";
import { accountIdentitySnapshot } from "@/lib/hamilton/account-context";
import { getInstitutionById } from "@/lib/data-store";

export const maxDuration = 300;

// Cost per 1M tokens (in cents) for estimation
/** Cents for the research_usage log, from the shared price map. */
function estimateCostCents(model: string, inputTokens: number, outputTokens: number): number {
  return Math.round((estimateAnthropicCostMicrousd(model, { inputTokens, outputTokens }) ?? 0) / 10_000);
}

const PRO_SCREEN_MODES = new Set(["analyze", "monitor"]);

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
        message: "Public Hamilton AI is disabled. Sign in with Fee Insight Pro to run provider-backed analysis.",
      },
      { status: 401 },
    );
  }

  if (user) {
    if (user.role === "admin" || user.role === "analyst") {
      // "View as customer" answers with the Pro prompt a customer gets.
      role = viewAsCustomerFromCookieHeader(request.headers.get("cookie")) ? "pro" : "admin";
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
        message: "Public Hamilton AI is disabled. Use deterministic institution evidence publicly or sign in with Fee Insight Pro.",
      },
      { status: 403 },
    );
  }

  if (!hasAnthropicApiKey("hamilton")) {
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
    // Analyze and Monitor are Pro screens: an admin there sees the answer a Pro
    // customer gets, not operator diagnostics.
    if (role === "admin" && PRO_SCREEN_MODES.has(contract.mode ?? "")) {
      role = "pro";
      contract = { ...contract, audience: "pro" };
    }
    messages = contract.messages;
    mode = contract.mode;
    analysisFocus = contract.analysisFocus;
    institutionId = contract.institutionId;
    gateCitations = contract.gateCitations;
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Account identity is read from this authenticated user's memberships, not the
  // browser body, selected institution, or saved research preference.
  const requestedInstitutionId = contract.institutionId;
  const enrichedContract = await withHamiltonAccountContext(contract, user);
  contract = enrichedContract;
  institutionId = enrichedContract.institutionId;
  const subject = institutionId === null ? null : await getInstitutionById(institutionId).catch(() => null);
  const identityContext = accountIdentitySnapshot(institutionId, enrichedContract.serverAccountContext, {
    researchInstitutionName: subject?.institution_name ?? null,
    researchSelectionSource: requestedInstitutionId !== null ? "authenticated request" : institutionId !== null ? "linked account default" : "unscoped",
    peerBaselineLabel: null,
    peerBaselineSource: null,
    peerBaselineFallbackReason: "The written answer did not capture a named peer cohort. Its original figures remain unchanged; no current peer selection is substituted.",
  });

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
  const homeId = enrichedContract.serverAccountContext.institution?.id;
  if (homeId && homeId !== institutionId && /\b(us|our|ours|we)\b/i.test(lastUserText)) {
    const homeBriefing = await buildHamiltonInstitutionBriefing({ ...contract, institutionId: homeId }, { contextRole: "account_evidence" }).catch(() => null);
    systemPrompt += homeBriefing
      ? `\nACCOUNT INSTITUTION EVIDENCE (${homeId}). This is the account/home institution for comparisons with us; the research subject remains ${institutionId ?? "unselected"}.\n${homeBriefing}\nEND ACCOUNT INSTITUTION EVIDENCE.\n`
      : "\nAccount institution evidence could not be loaded. State that limitation; do not substitute research-subject or peer data for our institution.\n";
  }

  // Analyze mode: override output structure with structured analysis sections (ARCH-05)
  // VALID_FOCUS guards against prompt injection — only known tab values reach the system prompt.
  let focus = "Pricing";
  if (mode === "analyze") {
    const VALID_FOCUS = new Set(["Pricing", "Risk", "Peer Position", "Trend"]);
    focus = VALID_FOCUS.has(analysisFocus ?? "") ? (analysisFocus as string) : "Pricing";
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
          model: getAnthropicLanguageModel(agent.model, "hamilton"),
          system: cachedSystem(systemPrompt),
          messages: await convertToModelMessages(messages),
          prepareStep: ({ messages: stepMessages }) => ({ messages: cacheLatestMessage(stepMessages) }),
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
        if (user) await trackFirstHamiltonUse(user.id, "question");
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
        identityContext,
      });
    }

    providerStartedAt = await guardProviderCall(providerContext);
    let resolveSaved: (id: string | null) => void = () => {};
    const savedId = new Promise<string | null>((resolve) => { resolveSaved = resolve; });
    const result = streamText({
      model: getAnthropicLanguageModel(agent.model, "hamilton"),
      // Tools and system are identical on every step, and each step re-sends the earlier
      // tool results: cache both so later steps read them instead of paying full input.
      system: cachedSystem(systemPrompt),
      messages: await convertToModelMessages(messages),
      prepareStep: ({ messages: stepMessages }) => ({ messages: cacheLatestMessage(stepMessages) }),
      tools: agent.tools,
      maxOutputTokens: agent.maxTokens,
      stopWhen: stepCountIs(agent.maxSteps),
      onFinish: async ({ totalUsage, text, steps }) => {
        // The Analyze screen's answer is saved here, not only from the browser, so a closed
        // tab or a failed browser call never loses it.
        if (mode === "analyze" && text.trim()) {
          const response = {
            ...writtenAnswerResponse(
              text,
              steps.flatMap((step) => step.toolResults.map((result) => result.output)),
            ),
            // Historical reference metadata only; never a future access grant.
            identityContext,
          };
          const prompt = questionOnly(lastUserText);
          try {
            resolveSaved(await insertSavedAnalysis({
              userId: user.id,
              institutionId: normalizeCanonicalInstitutionId(institutionId) ?? "",
              title: response.title || prompt.slice(0, 60).trim(),
              analysisFocus: focus,
              prompt,
              response,
            }));
          } catch (error) {
            console.error("[hamilton] saving the written answer failed", error);
            resolveSaved(null);
          }
        } else {
          resolveSaved(null);
        }
        try {
          // totalUsage spans every tool step; usage is only the last step.
          const usage = ledgerUsage(totalUsage);
          const inputTokens = totalUsage?.inputTokens ?? 0;
          const outputTokens = totalUsage?.outputTokens ?? 0;
          const costCents = Math.round((estimateAnthropicCostMicrousd(agent.model, usage) ?? 0) / 10_000);
          if (!providerFailed && providerStartedAt !== null) {
            await recordProviderUsage(
              providerContext,
              "completed",
              usage,
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
          if (user) await trackFirstHamiltonUse(user.id, "question");
        } catch {
          // Non-critical — don't fail the response
        }
      },
      onAbort: () => resolveSaved(null),
      onError: async ({ error }) => {
        resolveSaved(null);
        providerFailed = true;
        await recordProviderUsage(providerContext, "failed", {}, {
          latencyMs: providerStartedAt === null ? undefined : Date.now() - providerStartedAt,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    });

    // Run to the end even if the reader's browser drops the stream, so onFinish saves the answer.
    void result.consumeStream();

    // The saved row's id follows the answer as message metadata, after the text has streamed.
    return createUIMessageStreamResponse({
      stream: createUIMessageStream({
        execute: async ({ writer }) => {
          // A provider refusal happens inside the stream, past the catch below: send the
          // reader the paused line for a usage/billing limit, never the provider's text.
          writer.merge(result.toUIMessageStream({
            onError: (error) => (isProviderLimitError(error) ? HAMILTON_PAUSED_MESSAGE : "Hamilton couldn't finish this answer."),
          }));
          const id = await savedId;
          writer.write({ type: "message-metadata", messageMetadata: { ...(id ? { [SAVED_ANALYSIS_ID_KEY]: id } : {}), hamiltonIdentity: identityContext } });
        },
      }),
    });
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

    if (isProviderLimitError(err)) {
      return Response.json({ error: HAMILTON_PAUSED_MESSAGE, code: "provider_paused" }, { status: 503 });
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
