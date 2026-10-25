import { ProviderResponseOperation, AI_PROVIDER_TIMEOUT_MS, assertCompletedProviderFinish, withProviderResponseOperation, requireCompletedProviderUIStream } from "@/lib/ai-response-budget";
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
  observedProviderUsage,
  type ProviderUsage,
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
import { getHamilton, savedPeerSetUsed, type AnswerStep, type HamiltonRole } from "@/lib/research/agents";
import { getActivePeerSet } from "@/lib/hamilton/active-peer-set";
import { evaluateCitationDensity } from "@/lib/hamilton/citation-gate";
import { getCurrentUser, type User } from "@/lib/auth";
import { checkProAiQuota, quotaExceededMessage } from "@/lib/hamilton/quota";
import { logUsage } from "@/lib/research/history";
import { canAccessPremium } from "@/lib/access";
import { buildWrittenAnswerSystemPrompt, lastUserTextOf, WRITTEN_ANSWER_ROUTE_ID } from "@/lib/hamilton/written-answer-read";
import {
  parseHamiltonRequestContract,
  type HamiltonAudience,
  type HamiltonRequestContract,
} from "@/lib/hamilton/request-contract";
import { getRequestSubjectKey } from "@/lib/api-hardening/audit";
import { trackFirstHamiltonUse } from "@/lib/analytics-server";
import { cacheLatestMessage, cachedSystem, ledgerUsage, trackerUsage } from "@/lib/research/tool-output";
import { SAVED_ANALYSIS_ID_KEY, questionOnly, writtenAnswerBinding, writtenAnswerCheck, writtenAnswerResponse } from "@/lib/hamilton/answer-save";
import { bindingLeavesNothing } from "@/lib/hamilton/written-answer-binding";
import type { NarrativeBinding } from "@/lib/hamilton/narrative-bound";
import { parseAnalyzeResponse } from "@/components/hamilton/analyze/parse-response";
import { messageBoundsError } from "@/lib/hamilton/conversation-context";
import { HELD_ANSWER_MESSAGE } from "@/lib/hamilton/answer-gate";
import { insertSavedAnalysis } from "@/lib/data-store/hamilton-analyses";
import { collectFeeRefs } from "@/lib/saved-output-corrections";
import { normalizeCanonicalInstitutionId } from "@/lib/hamilton/context-link";
import { withHamiltonAccountContext } from "@/lib/hamilton/account-context-store";
import { accountIdentitySnapshot } from "@/lib/hamilton/account-context";
import { getInstitutionById } from "@/lib/data-store";
import { writtenAnswerStepSystemPrompt, type AnswerToolEvidence } from "@/lib/hamilton/written-answer-evidence";
import { shadowGate, type ShadowPath, type TodayDecision } from "@/lib/hamilton/output-gate-shadow";
import { scheduleGateShadow } from "@/lib/hamilton/output-gate-shadow-store";
import { gateAnswer, type GateInput } from "@/lib/hamilton/output-gate";
import { gatedAnswerView, isGateRepairEnabled, runGatedAnswer } from "@/lib/hamilton/output-gate-repair";

/** research_usage agent id for a gate rewrite; the "hamilton" prefix counts it in the Pro quota (quota.ts). */
const GATE_REPAIR_USAGE_AGENT_ID = "hamilton-repair";

export const maxDuration = 300;

// Cost per 1M tokens (in cents) for estimation
/** Cents for the research_usage log, from the shared price map. */
function estimateCostCents(model: string, inputTokens: number, outputTokens: number): number {
  return Math.round((estimateAnthropicCostMicrousd(model, { inputTokens, outputTokens }) ?? 0) / 10_000);
}

const PRO_SCREEN_MODES = new Set(["analyze", "monitor"]);

/** The evidence gate's verdict on a written answer, sent with it as message metadata (#981). */
interface AnswerVerdict {
  passed: boolean;
  held: boolean;
  /** The sentence binding (#981, H06-T06); sent on its own metadata key, not with the verdict. */
  binding?: NarrativeBinding | null;
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
        message: "Public Hamilton AI is disabled. Sign in with a Hamilton subscription to run provider-backed analysis.",
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
        message: "Public Hamilton AI is disabled. Use deterministic institution evidence publicly or sign in with a Hamilton subscription.",
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
  let institutionId: number | null = null;
  // Opt-in buffered path. Default false preserves the streaming chat UX (useChat). No screen
  // sends `gate_citations: true` today (2026-10-25 question trace); a caller that does
  // receives a JSON response: `{ status: "ok" }`, or `{ status: "refused" }` with reason
  // "insufficient_citations" or "evidence_check_failed" (the shared gate, answer-gate.ts).
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
    // The screens bound what they send; the server bounds what any client sends (#1273).
    const boundsError = messageBoundsError(contract.messages);
    if (boundsError) {
      return Response.json({ error: boundsError }, { status: 400 });
    }
    // Analyze and Monitor are Pro screens: an admin there sees the answer a Pro
    // customer gets, not operator diagnostics.
    if (role === "admin" && PRO_SCREEN_MODES.has(contract.mode ?? "")) {
      role = "pro";
      contract = { ...contract, audience: "pro" };
    }
    messages = contract.messages;
    mode = contract.mode;
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
  // The reader's saved default peer set for the research subject (its workspace's when they are
  // a member, else their own), so "peers" in the written answer means the group they chose
  // (#1084), and the same group Ask, Reports and the workspace bar name. A failed read is no set.
  const peerSet = await getActivePeerSet({ userId: user.id, institutionId }).catch(() => null);
  const homeId = enrichedContract.serverAccountContext.institution?.id;
  // The saved set is the answer's peer baseline only when a tool call in this answer used it
  // (the peers view with the set's filters); otherwise no current peer selection is substituted.
  const identityFor = (steps: readonly AnswerStep[] | undefined) => accountIdentitySnapshot(institutionId, enrichedContract.serverAccountContext, {
    researchInstitutionName: subject?.institution_name ?? null,
    researchSelectionSource: requestedInstitutionId !== null ? "authenticated request" : institutionId !== null ? "linked account default" : "unscoped",
    ...(peerSet && savedPeerSetUsed(peerSet, steps)
      ? { peerSetId: peerSet.id, peerBaselineLabel: peerSet.label, peerBaselineSource: "saved-peer-set", peerBaselineFallbackReason: null }
      : {
        peerBaselineLabel: null,
        peerBaselineSource: null,
        peerBaselineFallbackReason: "The written answer did not capture a named peer cohort. Its original figures remain unchanged; no current peer selection is substituted.",
      }),
  });
  let identityContext = identityFor(undefined);

  const agent = await getHamilton(role);

  // The reader's latest message, earlier turns' context included (the saved row's request key).
  const lastUserText = lastUserTextOf(messages);

  // The same prompt the paid answer eval writes from (written-answer-read.ts, #1079).
  const prompt = await buildWrittenAnswerSystemPrompt({ agent, contract, peerSet, homeId });
  if (prompt.status === "institution_not_found") {
    return Response.json({ error: "Institution not found" }, { status: 404 });
  }
  const { systemPrompt, focus, briefingEvidence } = prompt;

  // The one output gate in shadow (#1077, claim contract step 4): it runs for every mode, the admin
  // chats' included, and is recorded beside what today's gates decided. It never decides itself:
  // `today` is the decision already made, and a shadow that fails changes nothing. It is computed
  // and written after the response (scheduleGateShadow): nothing here awaits it. Every input is
  // captured now, since `identityContext` changes later.
  const shadowWrittenAnswer = (text: string, reads: readonly AnswerToolEvidence[], today: TodayDecision, path: ShadowPath): void => {
    try {
      if (!text.trim()) return;
      const input: GateInput = {
        surface: "written_answer",
        text,
        evidence: { kind: "tool_reads", toolOutputs: reads.map((read) => read.output), reads, briefingEvidence },
        identity: { researchInstitutionId: institutionId, accountInstitutionId: homeId ?? null, accountInstitutionName: identityContext.accountInstitutionName ?? null },
        question: questionOnly(lastUserText),
      };
      const context = { path, mode: mode ?? null };
      scheduleGateShadow(() => shadowGate(input, today, context), { userId: user.id, researchInstitutionId: institutionId });
    } catch (error) {
      console.error("[hamilton] the shadow output gate could not be scheduled", error);
    }
  };

  const providerContext = {
    provider: "anthropic" as const,
    model: agent.model,
    agent: "hamilton",
    operation: gateCitations ? "research_with_citation_gate" : "research_stream",
    routeId: WRITTEN_ANSWER_ROUTE_ID,
    userId: user.id,
    subjectKey,
  };
  let providerStartedAt: number | null = null;
  let providerFailed = false;
  let failureRecorded = false;
  let terminalFailure: unknown;
  let failureUsage: ProviderUsage | undefined;
  let responseOperation: ProviderResponseOperation | undefined;
  const failProvider = async (error: unknown, observed?: ProviderUsage) => {
    responseOperation?.dispose();
    if (observed) failureUsage = observed;
    if (!providerFailed) terminalFailure = error;
    providerFailed = true;
  };
  const flushProviderFailure = async () => {
    if (!providerFailed || failureRecorded || providerStartedAt === null) return;
    failureRecorded = true;
    const failure = responseOperation?.error ?? terminalFailure;
    await recordProviderUsage(providerContext, "failed", failureUsage ?? {}, {
      latencyMs: Date.now() - providerStartedAt, error: failure instanceof Error ? failure.message : String(failure),
      usageObservation: failureUsage ? "observed" : "unknown",
    });
  };

  try {
    // Buffered (gated) path: for report-generation callers. Trades off
    // streaming UX for a deterministic post-generation citation check. If
    // the gate refuses, we return the structured empty-state shape instead
    // of a partial report. Tokens are still logged via logUsage so cost
    // attribution is unchanged.
    if (gateCitations) {
      const { generated: result } = await trackAnthropicRequest(
        providerContext,
        () => withProviderResponseOperation(AI_PROVIDER_TIMEOUT_MS, async (scope) => {
          const generated = await generateText({
            model: getAnthropicLanguageModel(agent.model, "hamilton", scope),
            system: cachedSystem(systemPrompt),
            messages: await convertToModelMessages(messages),
            prepareStep: ({ messages: stepMessages, steps }) => ({
              messages: cacheLatestMessage(stepMessages),
              system: cachedSystem(writtenAnswerStepSystemPrompt(systemPrompt, steps)),
            }),
            tools: agent.tools,
            maxOutputTokens: agent.maxTokens,
            stopWhen: stepCountIs(agent.maxSteps),
            abortSignal: scope.signal,
          });
          assertCompletedProviderFinish(generated.finishReason, observedProviderUsage(generated.totalUsage));
          // The ledger records `usage`: every tool step's tokens and cache reads and writes (#1418).
          return { generated, usage: trackerUsage(generated.totalUsage) };
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

      const bufferedReads: AnswerToolEvidence[] = (result.steps ?? []).flatMap((step) => step.toolResults.map((toolResult) => ({
        toolName: toolResult.toolName, input: toolResult.input, output: toolResult.output,
      })));
      const gate = evaluateCitationDensity(result.text ?? "");
      if (gate.status === "refused") {
        shadowWrittenAnswer(result.text ?? "", bufferedReads, "held", "written_buffered");
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

      // Claim contract step 5 (#1077), only while HAMILTON_GATE_REPAIR is on: the one output gate
      // decides, one rewrite is asked for when the draft fails, and a partial answer shows its
      // supported sentences. Off (the default), today's gates below decide and no rewrite is made.
      if (isGateRepairEnabled()) {
        const gateDraft = (draft: { text: string }) => gateAnswer({
          surface: "written_answer",
          text: draft.text,
          evidence: { kind: "tool_reads", toolOutputs: bufferedReads.map((read) => read.output), reads: bufferedReads, briefingEvidence },
          identity: { researchInstitutionId: institutionId, accountInstitutionId: homeId ?? null, accountInstitutionName: identityContext.accountInstitutionName ?? null },
          question: questionOnly(lastUserText),
        });
        const gated = await runGatedAnswer({
          draft: { text: result.text ?? "" },
          gate: gateDraft,
          // One more paid call only within the reader's daily quota; the provider budget is checked by trackAnthropicRequest.
          allowRepair: async () => (await checkProAiQuota(user!)).allowed,
          repair: async (feedback) => {
            const { generated: rewrite } = await trackAnthropicRequest(
              { ...providerContext, operation: "research_gate_repair" },
              () => withProviderResponseOperation(AI_PROVIDER_TIMEOUT_MS, async (scope) => {
                const generated = await generateText({
                  model: getAnthropicLanguageModel(agent.model, "hamilton", scope),
                  system: cachedSystem(writtenAnswerStepSystemPrompt(systemPrompt, result.steps ?? [])),
                  // The same reads, no new ones: the rewrite is gated against what the first draft read.
                  messages: [
                    ...(await convertToModelMessages(messages)),
                    ...(result.response?.messages ?? []),
                    { role: "user" as const, content: feedback },
                  ],
                  tools: agent.tools,
                  toolChoice: "none",
                  maxOutputTokens: agent.maxTokens,
                  stopWhen: stepCountIs(1),
                  abortSignal: scope.signal,
                });
                assertCompletedProviderFinish(generated.finishReason, observedProviderUsage(generated.totalUsage));
                return { generated, usage: trackerUsage(generated.totalUsage) };
              }),
            );
            const repairIn = rewrite.totalUsage?.inputTokens ?? 0;
            const repairOut = rewrite.totalUsage?.outputTokens ?? 0;
            try {
              // Its own research_usage row, so the rewrite counts in the Pro quota like a memo retry (quota.ts).
              await logUsage(user?.id ?? null, null, GATE_REPAIR_USAGE_AGENT_ID, repairIn, repairOut, estimateCostCents(agent.model, repairIn, repairOut));
            } catch {
              // Non-critical, as above.
            }
            return { text: rewrite.text ?? "" };
          },
        });
        const finalText = gated.draft.text;
        const view = gatedAnswerView(finalText, gated.verdict);
        const repairNote = { status: gated.verdict.status, repair: gated.repair, firstStatus: gated.first.status };
        if (gated.repair === "used" && view.text !== null) {
          const rewriteGate = evaluateCitationDensity(finalText);
          if (rewriteGate.status === "refused") {
            shadowWrittenAnswer(finalText, bufferedReads, "held", "written_buffered");
            return Response.json(
              { status: "refused", reason: rewriteGate.reason, metrics: rewriteGate.metrics, suggestion: rewriteGate.suggestion,
                claims_without_citations: rewriteGate.claims_without_citations, gate: repairNote },
              { status: 200 },
            );
          }
        }
        if (view.text === null) {
          shadowWrittenAnswer(finalText, bufferedReads, "held", "written_buffered");
          return Response.json(
            { status: "refused", reason: "evidence_check_failed", problems: gated.verdict.failures.map((f) => f.message), metrics: gate.metrics, gate: repairNote },
            { status: 200 },
          );
        }
        shadowWrittenAnswer(finalText, bufferedReads, view.leftOut > 0 ? "shown_partial" : "shown", "written_buffered");
        return Response.json({
          status: "ok",
          text: view.text,
          metrics: gate.metrics,
          identityContext: identityFor(result.steps),
          gate: { ...repairNote, lead: view.lead, corrections: view.corrections, leftOut: view.leftOut },
          ...(gated.verdict.binding ? { narrativeBinding: gated.verdict.binding } : {}),
        });
      }

      // The same evidence gate a memo passes, against the tool outputs the model saw (#981).
      const evidence = writtenAnswerCheck(
        result.text ?? "",
        (result.steps ?? []).flatMap((step) => step.toolResults.map((toolResult) => toolResult.output)),
        questionOnly(lastUserText),
        { briefingEvidence, toolResults: bufferedReads, institutionId },
      );
      if (!evidence.passed) {
        shadowWrittenAnswer(result.text ?? "", bufferedReads, "held", "written_buffered");
        return Response.json(
          { status: "refused", reason: "evidence_check_failed", problems: evidence.problems, metrics: gate.metrics },
          { status: 200 },
        );
      }
      // A report is never printed with a sentence its fee records contradict (#981, H06-T06).
      const binding = writtenAnswerBinding(
        result.text ?? "",
        (result.steps ?? []).flatMap((step) => step.toolResults.map((toolResult) => toolResult.output)),
        questionOnly(lastUserText),
        { toolResults: bufferedReads, institutionId, accountInstitutionId: homeId ?? null },
      );
      if (binding && binding.omitted.length > 0) {
        shadowWrittenAnswer(result.text ?? "", bufferedReads, "held", "written_buffered");
        return Response.json(
          {
            status: "refused",
            reason: "evidence_check_failed",
            problems: binding.omitted.map((omitted) => `Left out (${omitted.reason}): "${omitted.text}"`),
            metrics: gate.metrics,
          },
          { status: 200 },
        );
      }

      shadowWrittenAnswer(result.text ?? "", bufferedReads, "shown", "written_buffered");
      return Response.json({
        status: "ok",
        text: result.text,
        metrics: gate.metrics,
        identityContext: identityFor(result.steps),
        ...(binding ? { narrativeBinding: binding } : {}),
      });
    }

    providerStartedAt = await guardProviderCall(providerContext);
    let resolveSaved: (id: string | null) => void = () => {};
    const savedId = new Promise<string | null>((resolve) => { resolveSaved = resolve; });
    // A written answer passes the shared evidence gate when it finishes (#981). While the held
    // line (HELD_ANSWER_MESSAGE) is set, the answer is held until then and is never shown, or
    // saved, when it fails; with it null, a failing answer streams as before and the verdict
    // is saved with it.
    const holdsAnswers = mode === "analyze" && HELD_ANSWER_MESSAGE !== null;
    let resolveVerdict: (verdict: AnswerVerdict | null) => void = () => {};
    const verdict = new Promise<AnswerVerdict | null>((resolve) => { resolveVerdict = resolve; });
    const scope = responseOperation = new ProviderResponseOperation({ timeoutMs: AI_PROVIDER_TIMEOUT_MS });
    const result = streamText({
      model: getAnthropicLanguageModel(agent.model, "hamilton", scope),
      abortSignal: scope.signal,
      // Tools and system are identical on every step, and each step re-sends the earlier
      // tool results: cache both so later steps read them instead of paying full input.
      system: cachedSystem(systemPrompt),
      messages: await convertToModelMessages(messages),
      prepareStep: ({ messages: stepMessages, steps }) => ({
        messages: cacheLatestMessage(stepMessages),
        system: cachedSystem(writtenAnswerStepSystemPrompt(systemPrompt, steps)),
      }),
      tools: agent.tools,
      maxOutputTokens: agent.maxTokens,
      stopWhen: stepCountIs(agent.maxSteps),
      onFinish: async ({ totalUsage, text, steps, finishReason }) => {
        if (providerFailed) { resolveVerdict(null); resolveSaved(null); await failProvider(terminalFailure, observedProviderUsage(totalUsage)); return; }
        try { scope.assertHealthy(); assertCompletedProviderFinish(finishReason); }
        catch (error) { resolveVerdict(null); resolveSaved(null); await failProvider(error, observedProviderUsage(totalUsage)); return; }
        scope.dispose();
        identityContext = identityFor(steps);
        const reads: AnswerToolEvidence[] = steps.flatMap((step) => step.toolResults.map((toolResult) => ({
          toolName: toolResult.toolName, input: toolResult.input, output: toolResult.output,
        })));
        // What today's gates decided, for the shadow gate below: an answer outside Analyze is shown ungated.
        let today: TodayDecision = "shown_ungated";
        // The Analyze screen's answer is saved here, not only from the browser, so a closed
        // tab or a failed browser call never loses it.
        if (mode === "analyze" && text.trim()) {
          const toolOutputs = steps.flatMap((step) => step.toolResults.map((result) => result.output));
          // A gate or response build that throws fails closed: the verdict and saved id still
          // resolve (a promise keeps its first value), so the reader is never left waiting and
          // the usage below is still recorded.
          try {
            const check = writtenAnswerCheck(text, toolOutputs, questionOnly(lastUserText), { briefingEvidence, toolResults: reads, institutionId });
            // Each sentence bound to the fee records and filings the tools returned (#981 H06-T06,
            // #1077). An answer with nothing left once the contradicted sentences go is held like a failing one.
            const binding = writtenAnswerBinding(text, toolOutputs, questionOnly(lastUserText), { toolResults: reads, institutionId, accountInstitutionId: homeId ?? null });
            const held = holdsAnswers && (!check.passed || bindingLeavesNothing(parseAnalyzeResponse(text), binding));
            resolveVerdict({ passed: check.passed, held, binding });
            today = held ? "held" : binding && binding.omitted.length > 0 ? "shown_partial" : "shown";
            const response = {
              ...writtenAnswerResponse(text, toolOutputs, check, binding),
              // Historical reference metadata only; never a future access grant.
              identityContext,
            };
            const prompt = questionOnly(lastUserText);
            if (held) {
              console.warn("[hamilton] written answer held by the evidence gate", check.problems);
              resolveSaved(null);
            } else {
              try {
                resolveSaved(await insertSavedAnalysis({
                  userId: user.id,
                  institutionId: normalizeCanonicalInstitutionId(institutionId) ?? "",
                  title: response.title || prompt.slice(0, 60).trim(),
                  analysisFocus: focus,
                  prompt,
                  response,
                  // A second request for the same question (double submit, Try again after a
                  // dropped stream) updates this row instead of adding a duplicate. The match is on
                  // the full text answered, earlier turns included, so the same follow-up words in
                  // another conversation are saved as their own row.
                  replaceRecentDuplicate: { request: `written\n${focus}\n${lastUserText}` },
                  // H03-T09: the fee rows the answer's tools read, so a later correction finds it.
                  feeRefs: collectFeeRefs(toolOutputs, response),
                }));
              } catch (error) {
                console.error("[hamilton] saving the written answer failed", error);
                resolveSaved(null);
              }
            }
          } catch (error) {
            console.error("[hamilton] the evidence gate or its response could not run", error);
            resolveVerdict({ passed: false, held: holdsAnswers });
            resolveSaved(null);
            today = holdsAnswers ? "held" : "shown";
          }
        } else {
          resolveVerdict(null);
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
        // Scheduled, not awaited: onFinish runs inside the stream's flush, so awaiting here would hold the stream open.
        shadowWrittenAnswer(text, reads, today, "written_streaming");
      },
      onAbort: async () => {
        resolveVerdict(null); resolveSaved(null);
        scope.abort("cancelled");
        await failProvider(scope.error);
      },
      onError: async ({ error }) => {
        resolveVerdict(null); resolveSaved(null);
        await failProvider(error);
      },
    });

    // Run to the end even if the reader's browser drops the stream, so onFinish saves the answer.
    const observeFailure = (error: unknown) => {
      resolveVerdict(null); resolveSaved(null);
      void failProvider(error); // Captures synchronously; never waits for consumer/final accounting.
    };
    // The public observer is essential: consumeStream catches reader errors and otherwise resolves.
    void Promise.resolve(result.consumeStream({ onError: observeFailure })).catch(observeFailure).finally(async () => { scope.dispose(); await flushProviderFailure(); });

    // The saved row's id follows the answer as message metadata, after the text has streamed.
    return createUIMessageStreamResponse({
      stream: createUIMessageStream({
        execute: async ({ writer }) => {
          // A held answer waits for the gate. The result's stream replays from its start, so
          // an answer that passes still reaches the reader whole.
          const heldVerdict = holdsAnswers ? await verdict : null;
          if (heldVerdict?.held && HELD_ANSWER_MESSAGE !== null) {
            writer.write({ type: "start" });
            writer.write({ type: "text-start", id: "held" });
            writer.write({ type: "text-delta", id: "held", delta: HELD_ANSWER_MESSAGE });
            writer.write({ type: "text-end", id: "held" });
          } else {
            // A provider refusal happens inside the stream, past the catch below: send the
            // reader the paused line for a usage/billing limit, never the provider's text.
            // A held answer's binding is known before its text replays, so it rides on the start
            // and a left-out sentence never shows while the text arrives.
            const startBinding = heldVerdict?.binding ?? null;
            writer.merge(requireCompletedProviderUIStream(result.toUIMessageStream({
              onError: (error) => (isProviderLimitError(error) ? HAMILTON_PAUSED_MESSAGE : "Hamilton couldn't finish this answer."),
              ...(startBinding
                ? { messageMetadata: ({ part }: { part: { type: string } }) => (part.type === "start" ? { narrativeBinding: startBinding } : undefined) }
                : {}),
            })));
          }
          const id = await savedId;
          const verdictNow = heldVerdict ?? (await verdict);
          const answerEvidence = verdictNow ? { passed: verdictNow.passed, held: verdictNow.held } : null;
          const narrativeBinding = verdictNow && !verdictNow.held ? verdictNow.binding ?? null : null;
          writer.write({
            type: "message-metadata",
            messageMetadata: {
              ...(id ? { [SAVED_ANALYSIS_ID_KEY]: id } : {}),
              hamiltonIdentity: identityContext,
              ...(answerEvidence ? { answerEvidence } : {}),
              ...(narrativeBinding ? { narrativeBinding } : {}),
            },
          });
        },
      }),
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "An unexpected error occurred";

    await failProvider(err);
    await flushProviderFailure();

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
