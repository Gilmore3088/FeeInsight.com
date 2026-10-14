/**
 * The streamed written answer passes the shared evidence gate (answer-gate.ts, #981).
 * While no held line is approved, a failing answer streams as before and its verdict is
 * saved; with one, a failing answer is never shown or saved and a passing one still is.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  stream: vi.fn(), save: vi.fn(), write: vi.fn(), merge: vi.fn(),
  held: { message: null as string | null },
}));
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
vi.mock("@/lib/ai-provider-usage", () => ({
  ProviderBudgetBlockedError: class extends Error {}, ProviderCircuitOpenError: class extends Error {},
  guardProviderCall: async () => Date.now(), recordProviderUsage: async () => {}, estimateAnthropicCostMicrousd: () => 0,
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
  cachedSystem: (text: string) => text, cacheLatestMessage: (messages: unknown) => messages, ledgerUsage: () => ({}),
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
import { POST } from "./route";

const TOOL_OUTPUT = { fee: 35, peer_median: 29 };
const PASSING = "## Hamilton's View\nThe overdraft fee of $35 sits above the peer median of $29.";
const UNTRACED = "## Hamilton's View\nThe overdraft fee of $35 sits above the peer median of $27.";
const ADVICE = "## Hamilton's View\nThe overdraft fee of $35 sits above the peer median of $29, so the bank should lower the fee.";

const request = () => new Request("https://example.test/api/research/hamilton", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text: "How does our overdraft fee compare?" }] }], mode: "analyze", institutionId: 202 }),
});

function answers(text: string) {
  mocks.stream.mockImplementation((options) => ({
    consumeStream: async () => options.onFinish({
      totalUsage: { inputTokens: 1, outputTokens: 1 },
      text,
      steps: [{ toolResults: [{ output: TOOL_OUTPUT }] }],
    }),
    toUIMessageStream: () => ({ synthetic: "answer stream" }),
  }));
}

function metadata() {
  return mocks.write.mock.calls.map(([chunk]) => chunk).find((chunk) => chunk.type === "message-metadata")?.messageMetadata;
}

beforeEach(() => {
  mocks.held.message = null;
  mocks.stream.mockReset();
  mocks.save.mockReset().mockResolvedValue("saved-1");
  mocks.write.mockReset();
  mocks.merge.mockReset();
});

describe("written answer evidence gate", () => {
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

  it("still shows and saves a passing answer once the held line is approved", async () => {
    mocks.held.message = "Synthetic held line.";
    answers(PASSING);
    await POST(request());
    expect(mocks.merge).toHaveBeenCalledTimes(1);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.write.mock.calls.some(([chunk]) => chunk.type === "text-delta")).toBe(false);
    expect(metadata()).toMatchObject({ savedAnalysisId: "saved-1", answerEvidence: { passed: true, held: false } });
  });
});
