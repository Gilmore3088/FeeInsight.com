/**
 * The streamed written answer passes the shared evidence gate (answer-gate.ts, #981).
 * With no held line, a failing answer streams as before and its verdict is saved; with
 * one (the shipped default), a failing answer is never shown or saved and a passing one still is.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  stream: vi.fn(), save: vi.fn(), write: vi.fn(), merge: vi.fn(), usage: vi.fn(),
  held: { message: null as string | null },
  gateThrows: false,
}));
vi.mock("@/lib/hamilton/answer-save", async () => {
  const actual = await vi.importActual<typeof import("@/lib/hamilton/answer-save")>("@/lib/hamilton/answer-save");
  return {
    ...actual,
    writtenAnswerCheck: (...args: Parameters<typeof actual.writtenAnswerCheck>) => {
      if (mocks.gateThrows) throw new Error("synthetic gate failure");
      return actual.writtenAnswerCheck(...args);
    },
  };
});
vi.mock("@/lib/api-hardening/route-wrapper", () => ({ withApiRoutePolicy: (_id: string, _method: string, handler: unknown) => handler }));
vi.mock("@/lib/api-hardening/audit", () => ({ getRequestSubjectKey: () => "synthetic-user" }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => ({ id: 7, role: "premium" }) }));
vi.mock("@/lib/access", () => ({ canAccessPremium: () => true }));
vi.mock("@/lib/hamilton/institution-membership", () => ({ getUserInstitutionMemberships: async () => [] }));
vi.mock("@/lib/hamilton/institution-briefing", () => ({ buildHamiltonInstitutionBriefing: async () => "Research evidence." }));
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
  return {
    ...actual,
    get HELD_ANSWER_MESSAGE() {
      return mocks.held.message;
    },
  };
});
vi.mock("ai", () => ({
  generateText: vi.fn(), streamText: mocks.stream, convertToModelMessages: async (messages: unknown) => messages, stepCountIs: () => ({}),
  createUIMessageStream: ({ execute }: { execute: (input: unknown) => Promise<void> }) => execute({ writer: { merge: mocks.merge, write: mocks.write } }),
  createUIMessageStreamResponse: async ({ stream }: { stream: Promise<void> }) => { await stream; return new Response("synthetic stream"); },
}));
import { withConversationContext } from "@/lib/hamilton/conversation-context";
import { POST } from "./route";

const TOOL_OUTPUT = { fee: 35, peer_median: 29 };
const PASSING = "## Hamilton's View\nThe overdraft fee of $35 sits above the peer median of $29.";
const UNTRACED = "## Hamilton's View\nThe overdraft fee of $35 sits above the peer median of $27.";
const ADVICE = "## Hamilton's View\nThe overdraft fee of $35 sits above the peer median of $29, so the bank should lower the fee.";

const request = (text = "How does our overdraft fee compare?") => new Request("https://example.test/api/research/hamilton", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text }] }], mode: "analyze", institutionId: 202 }),
});

function answers(text: string) {
  mocks.stream.mockImplementation((options) => ({
    consumeStream: async () => options.onFinish({
      finishReason: "stop",
      totalUsage: { inputTokens: 1, outputTokens: 1 },
      text,
      steps: [{ toolResults: [{ output: TOOL_OUTPUT }] }],
    }),
    toUIMessageStream: () => new ReadableStream({ start(c) { c.enqueue({ type: "finish", finishReason: "stop" }); c.close(); } }),
  }));
}

function metadata() {
  return mocks.write.mock.calls.map(([chunk]) => chunk).find((chunk) => chunk.type === "message-metadata")?.messageMetadata;
}

beforeEach(() => {
  mocks.held.message = null;
  mocks.gateThrows = false;
  mocks.usage.mockReset();
  mocks.stream.mockReset();
  mocks.save.mockReset().mockResolvedValue("saved-1");
  mocks.write.mockReset();
  mocks.merge.mockReset();
});

describe("written answer evidence gate", () => {
  it.each(["error", "length", "content-filter", "tool-calls", "other"])("does not save a terminal %s stream as a completed answer", async (finishReason) => {
    mocks.stream.mockImplementation((options) => ({
      consumeStream: async () => {
        if (finishReason === "error") await options.onError({ error: new Error("synthetic response failure") });
        await options.onFinish({ totalUsage: { inputTokens: 1, outputTokens: 1 }, text: PASSING, finishReason,
          steps: [{ toolResults: [{ output: TOOL_OUTPUT }] }] });
      },
      toUIMessageStream: () => new ReadableStream({ start(c) { c.enqueue({ type: "finish", finishReason: "error" }); c.close(); } }),
    }));
    await POST(request());
    expect(mocks.save).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(mocks.usage.mock.calls.filter((call) => call[1] === "failed")).toHaveLength(1));
    expect(mocks.usage.mock.calls.some((call) => call[1] === "completed")).toBe(false);
    expect(metadata()).not.toHaveProperty("savedAnalysisId");
  });

  it("saves a passing answer with its verdict and streams it", async () => {
    answers(PASSING);
    expect((await POST(request())).status).toBe(200);
    expect(mocks.merge).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls[0][0].response.answerEvidence).toEqual({ passed: true, problems: [] });
    expect(metadata()).toMatchObject({ savedAnalysisId: "saved-1", answerEvidence: { passed: true, held: false } });
  });

  it("records an untraced figure while no held line is approved, and still shows the answer", async () => {
    answers(UNTRACED);
    await POST(request());
    expect(mocks.merge).toHaveBeenCalledTimes(1);
    const saved = mocks.save.mock.calls[0][0].response;
    expect(saved.answerEvidence.passed).toBe(false);
    expect(saved.answerEvidence.problems.join(" ")).toContain("$27");
    expect(saved.confidence.level).toBe("low");
    expect(metadata()).toMatchObject({ answerEvidence: { passed: false, held: false } });
  });

  it("counts a figure the reader typed as traced, but not one from the appended earlier question (#1425)", async () => {
    answers(UNTRACED);
    await POST(request("Would a $27 overdraft fee sit below peers?"));
    expect(mocks.save.mock.calls[0][0].response.answerEvidence).toEqual({ passed: true, problems: [] });
    mocks.save.mockClear();
    await POST(request(withConversationContext("How does our overdraft fee compare?", [{ question: "Is $27 a normal overdraft fee?", lead: null }])));
    expect(mocks.save.mock.calls[0][0].response.answerEvidence.passed).toBe(false);
  });

  it("records advice the memo gate would refuse", async () => {
    answers(ADVICE);
    await POST(request());
    expect(mocks.save.mock.calls[0][0].response.answerEvidence.problems.join(" ")).toContain('"should"');
  });

  it("holds a failing answer once the held line is approved: never shown, never saved", async () => {
    mocks.held.message = "Synthetic held line.";
    answers(UNTRACED);
    await POST(request());
    expect(mocks.merge).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    const text = mocks.write.mock.calls.map(([chunk]) => chunk).filter((chunk) => chunk.type === "text-delta").map((chunk) => chunk.delta).join("");
    expect(text).toBe("Synthetic held line.");
    expect(text).not.toContain("$27");
    expect(metadata()).toEqual(expect.objectContaining({ answerEvidence: { passed: false, held: true } }));
    expect(metadata()).not.toHaveProperty("savedAnalysisId");
  });

  it("holds the answer when the gate itself cannot run, so the reader is never left waiting", async () => {
    mocks.held.message = "Synthetic held line.";
    mocks.gateThrows = true;
    answers(PASSING);
    await POST(request());
    expect(mocks.merge).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(metadata()).toEqual(expect.objectContaining({ answerEvidence: { passed: false, held: true } }));
    // The paid call still finishes its ledger row.
    expect(mocks.usage).toHaveBeenCalledWith(expect.anything(), "completed", expect.anything(), expect.anything());
  });

  it("still shows and saves a passing answer once the held line is approved", async () => {
    mocks.held.message = "Synthetic held line.";
    answers(PASSING);
    await POST(request());
    expect(mocks.merge).toHaveBeenCalledTimes(1);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.write.mock.calls.some(([chunk]) => chunk.type === "text-delta")).toBe(false);
    expect(metadata()).toMatchObject({ savedAnalysisId: "saved-1", answerEvidence: { passed: true, held: false } });
  });

  it("matches a repeat on the full request, so the same follow-up after different questions saves twice (#1274)", async () => {
    answers(PASSING);
    const followUp = "How does that compare to peers?";
    await POST(request(withConversationContext(followUp, [{ question: "What is our overdraft fee?", lead: null }])));
    await POST(request(withConversationContext(followUp, [{ question: "What is our NSF fee?", lead: null }])));
    const [first, second] = mocks.save.mock.calls.map(([input]) => input);
    // The saved prompt is the reader's words only; the request matched on carries the earlier turns.
    expect(first.prompt).toBe(followUp);
    expect(second.prompt).toBe(followUp);
    expect(first.replaceRecentDuplicate.request).toContain("overdraft");
    expect(second.replaceRecentDuplicate.request).toContain("NSF");
    expect(first.replaceRecentDuplicate.request).not.toBe(second.replaceRecentDuplicate.request);
    // A written answer is never matched against an engine storyline row.
    expect(first.replaceRecentDuplicate.request.startsWith("written\n")).toBe(true);
  });
});

describe("written answer sentence binding (#981, H06-T06)", () => {
  // Invented banks: the profile lookup returns Synthetic Bank A's $10 overdraft fee as a catalog row.
  const PROFILE = {
    identity: { id: 9001, name: "Synthetic Bank A" },
    fees: { verified: [{ fee_name: "Overdraft", fee_category: "overdraft", amount: 10, frequency: "per item", status: "verified", record_id: 1, source_document_id: 101 }], provisional: [] },
  };
  const OTHER = { identity: { id: 9002, name: "Synthetic Bank B" }, fees: { verified: [{ fee_name: "Overdraft", fee_category: "overdraft", amount: 35, frequency: "per item", status: "verified", record_id: 2, source_document_id: 102 }], provisional: [] } };
  const BOUND = "## Hamilton's View\nSynthetic Bank A charges $10 for an overdraft. Synthetic Bank A charges $35 for an overdraft.\n\nSynthetic Bank B charges $35, near the $29 peer median.";
  let streamOptions: Array<{ messageMetadata?: (input: { part: { type: string } }) => unknown }> = [];

  function answersFrom(text: string, outputs: unknown[]) {
    streamOptions = [];
    mocks.stream.mockImplementation((options) => ({
      consumeStream: async () => options.onFinish({
        finishReason: "stop",
        totalUsage: { inputTokens: 1, outputTokens: 1 },
        text,
        steps: [{ toolResults: outputs.map((output) => ({ output })) }],
      }),
      toUIMessageStream: (streamOptionsIn: (typeof streamOptions)[number]) => {
        streamOptions.push(streamOptionsIn);
        return new ReadableStream({ start(c) { c.enqueue({ type: "finish", finishReason: "stop" }); c.close(); } });
      },
    }));
  }

  it("saves the binding with the answer, leaves the contradicted sentence out of the saved text, and sends the binding", async () => {
    answersFrom(BOUND, [PROFILE, OTHER, TOOL_OUTPUT]);
    await POST(request());
    const saved = mocks.save.mock.calls[0][0].response;
    expect(saved.hamiltonView).not.toContain("Synthetic Bank A charges $35");
    expect(saved.hamiltonView).toContain("Synthetic Bank A charges $10 for an overdraft.");
    expect(saved.narrativeBinding.omitted).toEqual([{ text: "Synthetic Bank A charges $35 for an overdraft.", reason: "wrong_institution" }]);
    expect(saved.narrativeBinding.supported[0]).toEqual({ text: "Synthetic Bank A charges $10 for an overdraft.", factIds: ["fee:published:1"] });
    expect(saved.narrativeBinding.interpretation).toEqual(["Synthetic Bank B charges $35, near the $29 peer median."]);
    expect(metadata()).toMatchObject({ narrativeBinding: saved.narrativeBinding, answerEvidence: { passed: true, held: false } });
  });

  it("makes no binding when the tools returned no fee record, so the answer saves as before", async () => {
    answersFrom(PASSING, [TOOL_OUTPUT]);
    await POST(request());
    expect(mocks.save.mock.calls[0][0].response).not.toHaveProperty("narrativeBinding");
    expect(metadata()).not.toHaveProperty("narrativeBinding");
  });

  it("with the held line on, sends the binding on the first chunk so a left-out sentence never shows", async () => {
    mocks.held.message = "Synthetic held line.";
    answersFrom(BOUND, [PROFILE, OTHER, TOOL_OUTPUT]);
    await POST(request());
    expect(mocks.merge).toHaveBeenCalledTimes(1);
    const start = streamOptions[0].messageMetadata?.({ part: { type: "start" } }) as { narrativeBinding: { omitted: unknown[] } };
    expect(start.narrativeBinding.omitted).toHaveLength(1);
    expect(streamOptions[0].messageMetadata?.({ part: { type: "finish" } })).toBeUndefined();
  });

  it("holds an answer that has nothing left once the contradicted sentences go", async () => {
    mocks.held.message = "Synthetic held line.";
    answersFrom("## Hamilton's View\nSynthetic Bank A charges $35 for an overdraft.", [PROFILE, OTHER]);
    await POST(request());
    expect(mocks.merge).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(metadata()).toEqual(expect.objectContaining({ answerEvidence: { passed: true, held: true } }));
    expect(metadata()).not.toHaveProperty("narrativeBinding");
  });
});
