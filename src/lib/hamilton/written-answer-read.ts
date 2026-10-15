/**
 * Hamilton's written answer (the Analyze screen): the system prompt is assembled here so the live
 * route (`/api/research/hamilton`, streamed) and the paid answer eval (#1079, buffered) write from
 * the same words, and the eval scores the answer a Pro reader gets.
 *
 * Form is the shared evidence gate the route applies (`writtenAnswerCheck`): every figure traces to
 * the tool outputs the model saw, and no line tells the bank what to do. Server only.
 */

import { generateText, convertToModelMessages, stepCountIs, type UIMessage } from "ai";
import { getAnthropicLanguageModel, hasAnthropicApiKey, isProviderLimitError } from "@/lib/ai-provider";
import { trackAnthropicRequest } from "@/lib/ai-provider-usage";
import { getHamilton, buildAnalyzeModeSuffix, buildMonitorModeSuffix, buildSavedPeerSetPrompt, type AgentConfig } from "@/lib/research/agents";
import { detectSkill, buildSkillInjection, buildSkillExecution, isSkillOptIn, findOfferedSkill } from "@/lib/research/skills";
import { cacheLatestMessage, cachedSystem } from "@/lib/research/tool-output";
import type { AnswerEvidenceCheck } from "./answer-gate";
import { questionOnly, writtenAnswerCheck } from "./answer-save";
import type { ActivePeerSet } from "./active-peer-set";
import { buildHamiltonInstitutionBriefing } from "./institution-briefing";
import { HAMILTON_PAUSED_MESSAGE } from "./provider-paused";
import { buildHamiltonRequestContractPrompt, type HamiltonRequestContract } from "./request-contract";

export const WRITTEN_ANSWER_ROUTE_ID = "api.research.hamilton";
const VALID_FOCUS = new Set(["Pricing", "Risk", "Peer Position", "Trend"]);

export type WrittenAnswerPrompt =
  | { status: "ok"; systemPrompt: string; focus: string }
  | { status: "institution_not_found" };

/** The text of the reader's latest message, earlier turns' context included. */
export function lastUserTextOf(messages: readonly UIMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === "user");
  return last?.parts
    ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join(" ") || "";
}

/**
 * The written answer's system prompt: the agent's own, the request contract, the saved peer set,
 * the research subject's briefing (and the account institution's when the reader says "us"), the
 * screen's mode and any domain skill the typed question matches.
 */
export async function buildWrittenAnswerSystemPrompt(input: {
  agent: Pick<AgentConfig, "systemPrompt">;
  contract: HamiltonRequestContract;
  peerSet: Pick<ActivePeerSet, "id" | "label" | "filters"> | null;
  /** The account (home) institution, when the reader has one. */
  homeId?: number | null;
}): Promise<WrittenAnswerPrompt> {
  const { agent, contract, peerSet, homeId } = input;
  const { messages, mode, analysisFocus, institutionId } = contract;
  const lastUserText = lastUserTextOf(messages);

  let systemPrompt = agent.systemPrompt;
  systemPrompt += buildHamiltonRequestContractPrompt(contract);
  systemPrompt += buildSavedPeerSetPrompt(peerSet);

  if (institutionId !== null) {
    const selectedInstitutionContext = await buildHamiltonInstitutionBriefing(contract);
    if (!selectedInstitutionContext) return { status: "institution_not_found" };
    systemPrompt += selectedInstitutionContext;
  }
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
    focus = VALID_FOCUS.has(analysisFocus ?? "") ? (analysisFocus as string) : "Pricing";
    systemPrompt += buildAnalyzeModeSuffix(focus);
  }

  // Monitor mode: concise surveillance-oriented responses (Phase 46)
  if (mode === "monitor") {
    systemPrompt += buildMonitorModeSuffix();
  }

  // The skill checks read only what the reader typed: earlier questions and answers carried in
  // the conversation block must not opt in to a skill or hide the real question (#1273). The
  // home-institution check above reads the block on purpose, so "us" carries forward.
  const typedQuestion = questionOnly(lastUserText);

  // Check if user is opting in to a previously offered skill deliverable
  if (typedQuestion && isSkillOptIn(typedQuestion)) {
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
    const matchedSkill = typedQuestion ? detectSkill(typedQuestion) : null;
    if (matchedSkill) {
      systemPrompt += buildSkillInjection(matchedSkill);
    }
  }

  return { status: "ok", systemPrompt, focus };
}

export type WrittenAnswerResult =
  | { status: "written"; text: string; toolOutputs: unknown[]; check: AnswerEvidenceCheck }
  | { status: "unavailable"; reason: string };

/** One written answer as a buffered call: what the Analyze screen streams, for the eval. */
export type WrittenAnswerWriter = (input: {
  institutionId: number;
  institutionName: string;
  question: string;
  tracking: { operation: string; subjectKey: string; agentRunId?: number };
}) => Promise<WrittenAnswerResult>;

/** The model call's own cap, so a slow answer leaves the eval's 300 s function time to finish. */
const WRITTEN_ANSWER_TIMEOUT_MS = 180_000;

/**
 * The Pro written answer on the Analyze screen (Pricing focus) for the institution as the reader's
 * own: the same prompt, tools, output cap and step limit as the route, buffered and checked with
 * the route's evidence gate.
 */
export const writeWrittenAnswer: WrittenAnswerWriter = async ({ institutionId, institutionName, question, tracking }) => {
  if (!hasAnthropicApiKey("hamilton")) return { status: "unavailable", reason: "Hamilton's writer is not configured." };
  const agent = await getHamilton("pro");
  const contract: HamiltonRequestContract = {
    messages: [{ id: "paid-eval", role: "user", parts: [{ type: "text", text: question }] }],
    audience: "pro",
    institutionId,
    intent: "analyze",
    evidencePolicy: "provisional-first",
    mode: "analyze",
    analysisFocus: "Pricing",
    gateCitations: false,
    // The sampled institution stands as the reader's own, as for a Pro reader asking about their bank.
    serverAccountContext: { status: "identified", institution: { id: institutionId, name: institutionName }, profileLabel: null },
  };
  const prompt = await buildWrittenAnswerSystemPrompt({ agent, contract, peerSet: null, homeId: institutionId });
  if (prompt.status !== "ok") return { status: "unavailable", reason: "The institution's briefing could not be read." };
  try {
    const result = await trackAnthropicRequest(
      {
        model: agent.model,
        agent: "hamilton",
        operation: tracking.operation,
        routeId: WRITTEN_ANSWER_ROUTE_ID,
        subjectKey: tracking.subjectKey,
        ...(tracking.agentRunId ? { agentRunId: tracking.agentRunId } : {}),
        metadata: { institution_id: institutionId },
      },
      async () => generateText({
        model: getAnthropicLanguageModel(agent.model, "hamilton"),
        system: cachedSystem(prompt.systemPrompt),
        messages: await convertToModelMessages(contract.messages),
        prepareStep: ({ messages: stepMessages }) => ({ messages: cacheLatestMessage(stepMessages) }),
        tools: agent.tools,
        maxOutputTokens: agent.maxTokens,
        stopWhen: stepCountIs(agent.maxSteps),
        abortSignal: AbortSignal.timeout(WRITTEN_ANSWER_TIMEOUT_MS),
      }),
    );
    const text = (result.text ?? "").trim();
    if (!text) return { status: "unavailable", reason: "Hamilton wrote no answer within its steps." };
    const toolOutputs = (result.steps ?? []).flatMap((step) => step.toolResults.map((r) => r.output));
    return { status: "written", text, toolOutputs, check: writtenAnswerCheck(text, toolOutputs) };
  } catch (error) {
    if (isProviderLimitError(error)) return { status: "unavailable", reason: HAMILTON_PAUSED_MESSAGE };
    const message = error instanceof Error ? error.message : String(error);
    return { status: "unavailable", reason: /budget|usage limit/i.test(message) ? "Hamilton's writing budget for today is used up." : "Hamilton's writer could not be reached." };
  }
};
