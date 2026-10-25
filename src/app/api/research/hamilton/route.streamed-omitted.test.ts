/**
 * #1077 follow-up: a held streamed Analyze answer never sends the browser the text of a sentence
 * its binding left out, in the metadata or in the text stream. The whole SSE body is read, through
 * the real UI message stream helpers; only the provider's `streamText` is a fake.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  stream: vi.fn(), briefing: vi.fn(), save: vi.fn(), usage: vi.fn(),
  held: { message: null as string | null },
  viewHeld: false,
}));
vi.mock("@/lib/hamilton/output-gate-shadow-store", () => ({ scheduleGateShadow: () => {}, GATE_SHADOW_DETAIL_KEY: "gate_shadow" }));
vi.mock("@/lib/api-hardening/route-wrapper", () => ({ withApiRoutePolicy: (_id: string, _method: string, handler: unknown) => handler }));
vi.mock("@/lib/api-hardening/audit", () => ({ getRequestSubjectKey: () => "synthetic-user" }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => ({ id: 7, role: "premium" }) }));
vi.mock("@/lib/access", () => ({ canAccessPremium: () => true }));
vi.mock("@/lib/hamilton/institution-membership", () => ({ getUserInstitutionMemberships: async () => [] }));
vi.mock("@/lib/hamilton/institution-briefing", () => ({ buildHamiltonInstitutionBriefingSnapshot: mocks.briefing }));
vi.mock("@/lib/data-store", () => ({ getInstitutionById: async (id: number) => ({ id, institution_name: `Synthetic Subject ${id}` }) }));
vi.mock("@/lib/hamilton/quota", () => ({ checkProAiQuota: async () => ({ allowed: true }), quotaExceededMessage: () => "quota" }));
vi.mock("@/lib/research/history", () => ({ logUsage: async () => {} }));
vi.mock("@/lib/analytics-server", () => ({ trackFirstHamiltonUse: async () => {} }));
vi.mock("@/lib/data-store/hamilton-analyses", () => ({ insertSavedAnalysis: mocks.save }));
vi.mock("@/lib/ai-provider", () => ({
  getAnthropicLanguageModel: () => ({}), hasAnthropicApiKey: () => true,
  isProviderLimitError: () => false, MISSING_ANTHROPIC_API_KEY_MESSAGE: "missing",
}));
vi.mock("@/lib/ai-provider-usage", async () => ({
  observedProviderUsage: (await vi.importActual<typeof import("@/lib/ai-provider-usage")>("@/lib/ai-provider-usage")).observedProviderUsage,
  ProviderBudgetBlockedError: class extends Error {}, ProviderCircuitOpenError: class extends Error {},
  guardProviderCall: async () => Date.now(), recordProviderUsage: mocks.usage, estimateAnthropicCostMicrousd: () => 0,
  trackAnthropicRequest: async (_context: unknown, call: () => Promise<unknown>) => call(),
}));
vi.mock("@/lib/research/agents", () => ({
  getHamilton: async () => ({ systemPrompt: "Hamilton base.", model: "test-model", tools: {}, maxTokens: 100, maxSteps: 1 }),
  buildAnalyzeModeSuffix: () => "", buildMonitorModeSuffix: () => "", buildSavedPeerSetPrompt: () => "", savedPeerSetUsed: () => false,
}));
vi.mock("@/lib/hamilton/active-peer-set", () => ({ getActivePeerSet: async () => null }));
vi.mock("@/lib/research/skills", () => ({
  detectSkill: () => null, buildSkillInjection: () => "", buildSkillExecution: () => "", isSkillOptIn: () => false, findOfferedSkill: () => null,
}));
vi.mock("@/lib/research/tool-output", () => ({
  cachedSystem: (text: string) => text, cacheLatestMessage: (messages: unknown) => messages, ledgerUsage: () => ({}), trackerUsage: () => ({}),
}));
vi.mock("@/lib/hamilton/answer-gate", async () => {
  const actual = await vi.importActual<typeof import("@/lib/hamilton/answer-gate")>("@/lib/hamilton/answer-gate");
  return { ...actual, get HELD_ANSWER_MESSAGE() { return mocks.held.message; } };
});
// The real view, unless a test needs one that cannot be built (its fail-closed reasons are tested in output-gate-repair.test.ts).
vi.mock("@/lib/hamilton/output-gate-repair", async () => {
  const actual = await vi.importActual<typeof import("@/lib/hamilton/output-gate-repair")>("@/lib/hamilton/output-gate-repair");
  return {
    ...actual,
    bindingAnswerView: (...args: Parameters<typeof actual.bindingAnswerView>) => (mocks.viewHeld
      ? { status: "held", text: null, lead: null, corrections: [], leftOut: 0, heldBy: "cut_not_found" }
      : actual.bindingAnswerView(...args)),
  };
});
vi.mock("ai", async () => ({
  ...(await vi.importActual<typeof import("ai")>("ai")),
  streamText: mocks.stream, convertToModelMessages: async (messages: unknown) => messages, stepCountIs: () => ({}),
}));
import { writtenAnswerBinding } from "@/lib/hamilton/answer-save";
import { applyNarrativeBinding, readSentNarrativeBinding } from "@/lib/hamilton/written-answer-binding";
import { parseAnalyzeResponse } from "@/components/hamilton/analyze/parse-response";
import { POST } from "./route";

// Invented banks: the profile lookup returns Synthetic Bank A's $10 overdraft fee as a catalog row.
const PROFILE = {
  identity: { id: 9001, name: "Synthetic Bank A" },
  fees: { verified: [{ fee_name: "Overdraft", fee_category: "overdraft", amount: 10, frequency: "per item", status: "verified", record_id: 1, source_document_id: 101 }], provisional: [] },
};
const OTHER = { identity: { id: 9002, name: "Synthetic Bank B" }, fees: { verified: [{ fee_name: "Overdraft", fee_category: "overdraft", amount: 35, frequency: "per item", status: "verified", record_id: 2, source_document_id: 102 }], provisional: [] } };
const TOOL_OUTPUT = { fee: 35, peer_median: 29 };
const OUTPUTS = [PROFILE, OTHER, TOOL_OUTPUT];
const KEPT = "Synthetic Bank A charges $10 for an overdraft.";
const LEFT_OUT = "Synthetic Bank A charges $35 for an overdraft.";
const READING = "Synthetic Bank B charges $35, near the $29 peer median.";
const BOUND = `## Hamilton's View\n${KEPT} ${LEFT_OUT}\n\n${READING}\n\n## Evidence\n- **Overdraft:** $10, per the fee schedule`;
const QUESTION = "How does our overdraft fee compare?";

const request = (mode: string | null = "analyze") => new Request("https://example.test/api/research/hamilton", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text: QUESTION }] }], ...(mode ? { mode } : {}), institutionId: 202 }),
});

type Chunk = Record<string, unknown> & { type: string };

/** The provider's UI stream for a draft: a tool read, reasoning that restates the draft, then the text in two deltas. */
function providerChunks(text: string, start: Chunk = { type: "start" }): Chunk[] {
  const half = Math.floor(text.length / 2);
  return [
    start,
    { type: "start-step" },
    { type: "tool-input-available", toolCallId: "call-1", toolName: "getInstitution", input: {} },
    { type: "tool-output-available", toolCallId: "call-1", output: PROFILE },
    { type: "reasoning-start", id: "r1" },
    { type: "reasoning-delta", id: "r1", delta: `Drafting: ${text}` },
    { type: "reasoning-end", id: "r1" },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: text.slice(0, half) },
    { type: "text-delta", id: "t1", delta: text.slice(half) },
    { type: "text-end", id: "t1" },
    { type: "finish-step" },
    { type: "finish", finishReason: "stop" },
  ];
}

function answers(text: string) {
  mocks.stream.mockImplementation((options) => ({
    consumeStream: async () => options.onFinish({ finishReason: "stop", totalUsage: { inputTokens: 1, outputTokens: 1 }, text,
      steps: [{ toolResults: OUTPUTS.map((output) => ({ toolName: "getInstitution", input: {}, output })) }] }),
    toUIMessageStream: (streamOptions: { messageMetadata?: (input: { part: Chunk }) => unknown }) => {
      const chunks = providerChunks(text).map((chunk) => {
        const messageMetadata = streamOptions.messageMetadata?.({ part: chunk });
        return messageMetadata === undefined ? chunk : { ...chunk, messageMetadata };
      });
      return new ReadableStream({ start(c) { for (const chunk of chunks) c.enqueue(chunk); c.close(); } });
    },
  }));
}

async function sse(response: Response): Promise<{ raw: string; chunks: Chunk[] }> {
  const raw = await response.text();
  const chunks = raw.split("\n\n").map((event) => event.replace(/^data: /, "").trim())
    .filter((data) => data && data !== "[DONE]").map((data) => JSON.parse(data) as Chunk);
  return { raw, chunks };
}
// The final metadata is written once the saved id resolves; a fake provider finishes at once, so it
// can land before the merged replay. Order is compared without it, and without the random message
// id the UI stream helper gives the start chunk.
const replayed = (chunks: Chunk[]) => chunks.filter((c) => c.type !== "message-metadata")
  .map(({ messageId: _id, ...chunk }) => chunk as Chunk);
const textOf = (chunks: Chunk[]) => chunks.filter((c) => c.type === "text-delta").map((c) => c.delta).join("");
const finalMetadata = (chunks: Chunk[]) => chunks.filter((c) => c.type === "message-metadata").at(-1)?.messageMetadata as Record<string, unknown> | undefined;
const fullBinding = (text: string) => writtenAnswerBinding(text, OUTPUTS, QUESTION,
  { toolResults: OUTPUTS.map((output) => ({ toolName: "getInstitution", input: {}, output })), institutionId: 202, accountInstitutionId: null });

beforeEach(() => {
  mocks.held.message = "Synthetic held line.";
  mocks.viewHeld = false;
  mocks.stream.mockReset();
  mocks.usage.mockReset();
  mocks.briefing.mockReset().mockResolvedValue({ prompt: "Research evidence.", evidence: [] });
  mocks.save.mockReset().mockResolvedValue("saved-1");
});

describe("a held streamed Analyze answer whose binding left a sentence out", () => {
  it("never sends the left-out sentence's text: not in the start binding, the text, the reasoning or the final metadata", async () => {
    answers(BOUND);
    const { raw, chunks } = await sse(await POST(request()));
    expect(raw).not.toContain(LEFT_OUT);
    expect(raw).not.toContain("$35 for an overdraft");
    const text = textOf(chunks);
    expect(text).toContain(KEPT);
    expect(text).toContain(READING);
    // Evidence is dropped beside a left-out claim (gatedAnswerView), and the draft's reasoning never goes.
    expect(text).not.toContain("## Evidence");
    expect(chunks.some((c) => c.type.startsWith("reasoning"))).toBe(false);
    // Tool parts and the finish stay as the provider sent them; the shown text is written before the finish.
    expect(replayed(chunks).map((c) => c.type)).toEqual(["start", "start-step", "tool-input-available", "tool-output-available", "finish-step",
      "text-start", "text-delta", "text-end", "finish"]);
    const start = replayed(chunks)[0].messageMetadata as { narrativeBinding: { omitted: unknown[]; interpretation: string[] } };
    expect(start.narrativeBinding.omitted).toEqual([{ reason: "wrong_institution" }]);
    expect(start.narrativeBinding.interpretation).toEqual([READING]);
    expect(finalMetadata(chunks)).toMatchObject({ savedAnalysisId: "saved-1", answerEvidence: { passed: true, held: false },
      narrativeBinding: start.narrativeBinding });
    // The Analyze screen reads the sent binding and the shown text as before: the supported sentence
    // in the view, the reading sentence under its label, the left-out count kept.
    const sent = readSentNarrativeBinding(start.narrativeBinding);
    expect(sent?.omitted).toHaveLength(1);
    const bound = applyNarrativeBinding(parseAnalyzeResponse(text), sent);
    expect(bound.sections.hamiltonView.trim()).toBe(KEPT);
    expect(bound.reading).toEqual([READING]);
  });

  it("saves the answer with its full binding, as before", async () => {
    answers(BOUND);
    await sse(await POST(request()));
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls[0][0].response.narrativeBinding.omitted).toEqual([{ text: LEFT_OUT, reason: "wrong_institution" }]);
  });

  it("fails closed when the view cannot be built: the held line shows and nothing is saved", async () => {
    mocks.viewHeld = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    answers(BOUND);
    const { raw, chunks } = await sse(await POST(request()));
    expect(textOf(chunks)).toBe("Synthetic held line.");
    expect(raw).not.toContain(LEFT_OUT);
    expect(raw).not.toContain(KEPT);
    expect(mocks.save).not.toHaveBeenCalled();
    const meta = finalMetadata(chunks);
    expect(meta).toMatchObject({ answerEvidence: { passed: true, held: true } });
    expect(meta).not.toHaveProperty("narrativeBinding");
    expect(meta).not.toHaveProperty("savedAnalysisId");
    warn.mockRestore();
  });
});

describe("unchanged streams", () => {
  it("a held answer that left nothing out replays the provider's stream as before, its binding byte for byte", async () => {
    const text = `## Hamilton's View\n${KEPT}\n\n${READING}`;
    const binding = fullBinding(text);
    expect(binding?.omitted).toEqual([]);
    answers(text);
    const { raw, chunks } = await sse(await POST(request()));
    const expected = providerChunks(text, { type: "start", messageMetadata: { narrativeBinding: binding } });
    expect(replayed(chunks)).toEqual(expected);
    expect(raw).toContain(`"messageMetadata":{"narrativeBinding":${JSON.stringify(binding)}}`);
    expect(JSON.stringify(finalMetadata(chunks)?.narrativeBinding)).toBe(JSON.stringify(binding));
  });

  it("with no held line, the draft streams whole with the full binding, as before (the open case)", async () => {
    mocks.held.message = null;
    answers(BOUND);
    const { chunks } = await sse(await POST(request()));
    expect(textOf(chunks)).toBe(BOUND);
    expect(replayed(chunks)).toEqual(providerChunks(BOUND));
    expect((finalMetadata(chunks)?.narrativeBinding as { omitted: unknown[] }).omitted).toEqual([{ text: LEFT_OUT, reason: "wrong_institution" }]);
  });

  it("an admin chat with no mode streams whole and ungated, as before", async () => {
    answers(BOUND);
    const { chunks } = await sse(await POST(request(null)));
    expect(textOf(chunks)).toBe(BOUND);
    expect(finalMetadata(chunks)).not.toHaveProperty("narrativeBinding");
    expect(mocks.save).not.toHaveBeenCalled();
  });
});

describe("with HAMILTON_ANSWER_GATE_ENFORCE on (#1077 T4), the real gate", () => {
  beforeEach(() => { vi.stubEnv("HAMILTON_ANSWER_GATE_ENFORCE", "true"); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("still shows a left-out answer in part, never the left-out sentence", async () => {
    answers(BOUND);
    const { raw, chunks } = await sse(await POST(request()));
    expect(raw).not.toContain(LEFT_OUT);
    expect(textOf(chunks)).toContain(KEPT);
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });

  it("holds the admin chat's draft, which streamed whole before, rather than send its left-out sentence", async () => {
    answers(BOUND);
    const { raw, chunks } = await sse(await POST(request(null)));
    expect(raw).not.toContain(LEFT_OUT);
    expect(textOf(chunks)).toBe("Synthetic held line.");
  });
});
