/**
 * #1077 follow-up (claim contract step 5 review): a buffered reader-facing reply never carries the
 * text of a sentence the reader's view left out. The binding's omitted sentences keep their reason
 * and count; a refused reply names a left-out sentence by its reason only. The streamed answer is
 * unchanged: its replayed text holds the left-out sentences, and the screen hides them by the
 * binding's text, so stripping that text there would put them on screen.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  stream: vi.fn(), generate: vi.fn(), briefing: vi.fn(), save: vi.fn(), write: vi.fn(), merge: vi.fn(), usage: vi.fn(), shadow: vi.fn(),
  logUsage: vi.fn(), tracked: vi.fn(), density: vi.fn(),
  held: { message: null as string | null },
  quotaAllowed: true,
}));
// The shadow is computed at once here, so each test reads the record it would write after the response.
vi.mock("@/lib/hamilton/output-gate-shadow-store", () => ({
  scheduleGateShadow: (compute: () => unknown, context: unknown) => { mocks.shadow(compute(), context); },
  GATE_SHADOW_DETAIL_KEY: "gate_shadow",
}));
vi.mock("@/lib/api-hardening/route-wrapper", () => ({ withApiRoutePolicy: (_id: string, _method: string, handler: unknown) => handler }));
vi.mock("@/lib/api-hardening/audit", () => ({ getRequestSubjectKey: () => "synthetic-user" }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => ({ id: 7, role: "premium" }) }));
vi.mock("@/lib/access", () => ({ canAccessPremium: () => true }));
vi.mock("@/lib/hamilton/institution-membership", () => ({ getUserInstitutionMemberships: async () => [] }));
vi.mock("@/lib/hamilton/institution-briefing", () => ({ buildHamiltonInstitutionBriefingSnapshot: mocks.briefing }));
vi.mock("@/lib/data-store", () => ({ getInstitutionById: async (id: number) => ({ id, institution_name: `Synthetic Subject ${id}` }) }));
// The first quota check (before the first call) always passes; the rewrite's reads `quotaAllowed`.
let quotaChecks = 0;
vi.mock("@/lib/hamilton/quota", () => ({
  checkProAiQuota: async () => ({ allowed: quotaChecks++ === 0 ? true : mocks.quotaAllowed }),
  quotaExceededMessage: () => "quota",
}));
vi.mock("@/lib/research/history", () => ({ logUsage: mocks.logUsage }));
vi.mock("@/lib/analytics-server", () => ({ trackFirstHamiltonUse: async () => {} }));
vi.mock("@/lib/data-store/hamilton-analyses", () => ({ insertSavedAnalysis: mocks.save }));
vi.mock("@/lib/ai-provider", () => ({
  getAnthropicLanguageModel: () => ({}), hasAnthropicApiKey: () => true,
  isProviderLimitError: (error: unknown) => error instanceof Error && error.message === "synthetic provider stop",
  MISSING_ANTHROPIC_API_KEY_MESSAGE: "missing",
}));
vi.mock("@/lib/ai-provider-usage", async () => ({
  observedProviderUsage: (await vi.importActual<typeof import("@/lib/ai-provider-usage")>("@/lib/ai-provider-usage")).observedProviderUsage,
  ProviderBudgetBlockedError: class extends Error {}, ProviderCircuitOpenError: class extends Error {},
  guardProviderCall: async () => Date.now(), recordProviderUsage: mocks.usage, estimateAnthropicCostMicrousd: () => 0,
  trackAnthropicRequest: async (context: unknown, call: () => Promise<unknown>) => { mocks.tracked(context); return call(); },
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
// The citation-density gate is not what these tests are about: every draft passes it.
vi.mock("@/lib/hamilton/citation-gate", async () => ({
  ...(await vi.importActual<typeof import("@/lib/hamilton/citation-gate")>("@/lib/hamilton/citation-gate")),
  evaluateCitationDensity: (text: string) => mocks.density(text),
}));
vi.mock("ai", () => ({
  generateText: mocks.generate, streamText: mocks.stream, convertToModelMessages: async (messages: unknown) => messages, stepCountIs: () => ({}),
  createUIMessageStream: ({ execute }: { execute: (input: unknown) => Promise<void> }) => execute({ writer: { merge: mocks.merge, write: mocks.write } }),
  createUIMessageStreamResponse: async ({ stream }: { stream: Promise<void> }) => { await stream; return new Response("synthetic stream"); },
}));
import { POST } from "./route";

// Invented banks: the profile lookup returns Synthetic Bank A's $10 overdraft fee as a catalog row.
const PROFILE = {
  identity: { id: 9001, name: "Synthetic Bank A" },
  fees: { verified: [{ fee_name: "Overdraft", fee_category: "overdraft", amount: 10, frequency: "per item", status: "verified", record_id: 1, source_document_id: 101 }], provisional: [] },
};
const OTHER = { identity: { id: 9002, name: "Synthetic Bank B" }, fees: { verified: [{ fee_name: "Overdraft", fee_category: "overdraft", amount: 35, frequency: "per item", status: "verified", record_id: 2, source_document_id: 102 }], provisional: [] } };
const TOOL_OUTPUT = { fee: 35, peer_median: 29 };
const KEPT = "Synthetic Bank A charges $10 for an overdraft.";
const LEFT_OUT = "Synthetic Bank A charges $35 for an overdraft.";
const BOUND = `## Hamilton's View\n${KEPT} ${LEFT_OUT}\n\nSynthetic Bank B charges $35, near the $29 peer median.`;
const ONLY_LEFT_OUT = `## Hamilton's View\n${LEFT_OUT}`;
const OUTPUTS = [PROFILE, OTHER, TOOL_OUTPUT];
const QUESTION = "How does our overdraft fee compare?";

const requestFor = (extra: Record<string, unknown>) => new Request("https://example.test/api/research/hamilton", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text: QUESTION }] }], mode: "analyze", institutionId: 202, ...extra }),
});
const buffered = () => requestFor({ gate_citations: true });
const draft = (text: string, outputs: unknown[] = OUTPUTS) => ({ text, finishReason: "stop",
  steps: [{ toolResults: outputs.map((output) => ({ toolName: "getInstitution", input: {}, output })) }],
  totalUsage: { inputTokens: 10, outputTokens: 5 }, response: { messages: [{ role: "assistant", content: text }] } });
const rewrite = (text: string) => ({ text, finishReason: "stop", steps: [], totalUsage: { inputTokens: 20, outputTokens: 6 } });

beforeEach(() => {
  mocks.held.message = "Synthetic held line.";
  mocks.quotaAllowed = true;
  quotaChecks = 0;
  for (const mock of [mocks.stream, mocks.generate, mocks.usage, mocks.write, mocks.merge, mocks.logUsage, mocks.tracked]) mock.mockReset();
  mocks.briefing.mockReset().mockResolvedValue({ prompt: "Research evidence.", evidence: [] });
  mocks.save.mockReset().mockResolvedValue("saved-1");
  mocks.shadow.mockReset().mockResolvedValue(null);
  mocks.logUsage.mockResolvedValue(undefined);
  mocks.density.mockReset().mockImplementation((text: string) => ({ status: "ok", metrics: { chars: text.length } }));
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("buffered written answer with HAMILTON_GATE_REPAIR on", () => {
  beforeEach(() => { vi.stubEnv("HAMILTON_GATE_REPAIR", "true"); });

  it("ok, ready_partial: the binding keeps the reason and count of a left-out sentence, never its text", async () => {
    mocks.generate.mockResolvedValueOnce(draft(BOUND)).mockResolvedValueOnce(rewrite(BOUND));
    const body = await (await POST(buffered())).json();
    expect(body).toMatchObject({ status: "ok", gate: { status: "ready_partial", leftOut: 1 } });
    expect(body.text).toContain(KEPT);
    expect(body.narrativeBinding.omitted).toEqual([{ reason: "wrong_institution" }]);
    expect(body.narrativeBinding.supported.map((s: { text: string }) => s.text)).toEqual([KEPT]);
    expect(JSON.stringify(body)).not.toContain(LEFT_OUT);
  });

  it("refused: names a left-out sentence by its reason, never quotes it", async () => {
    mocks.generate.mockResolvedValueOnce(draft(ONLY_LEFT_OUT)).mockResolvedValueOnce(rewrite(ONLY_LEFT_OUT));
    const body = await (await POST(buffered())).json();
    expect(body).toMatchObject({ status: "refused", reason: "evidence_check_failed", gate: { status: "held" } });
    expect(body.problems).toContain("Left out (wrong_institution).");
    expect(body).not.toHaveProperty("narrativeBinding");
    expect(JSON.stringify(body)).not.toContain(LEFT_OUT);
  });
});

describe("buffered written answer with HAMILTON_GATE_REPAIR off (the default)", () => {
  it("refused: names a left-out sentence by its reason, never quotes it, with one call", async () => {
    mocks.generate.mockResolvedValueOnce(draft(BOUND));
    const body = await (await POST(buffered())).json();
    expect(body).toMatchObject({ status: "refused", reason: "evidence_check_failed", problems: ["Left out (wrong_institution)."] });
    expect(JSON.stringify(body)).not.toContain(LEFT_OUT);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  });

  it("ok with a binding that left nothing out: text and binding as before", async () => {
    const text = `## Hamilton's View\n${KEPT}`;
    mocks.generate.mockResolvedValueOnce(draft(text));
    const body = await (await POST(buffered())).json();
    expect(body).toMatchObject({ status: "ok", text });
    expect(body.narrativeBinding).toMatchObject({ omitted: [], supported: [{ text: KEPT, factIds: ["fee:published:1"] }] });
  });
});

describe("streamed written answer (unchanged, switch on or off)", () => {
  let streamOptions: Array<{ messageMetadata?: (input: { part: { type: string } }) => unknown }> = [];
  beforeEach(() => {
    streamOptions = [];
    mocks.stream.mockImplementation((options) => ({
      consumeStream: async () => options.onFinish({ finishReason: "stop", totalUsage: { inputTokens: 1, outputTokens: 1 }, text: BOUND,
        steps: [{ toolResults: OUTPUTS.map((output) => ({ output })) }] }),
      toUIMessageStream: (streamOptionsIn: (typeof streamOptions)[number]) => {
        streamOptions.push(streamOptionsIn);
        return new ReadableStream({ start(c) { c.enqueue({ type: "finish", finishReason: "stop" }); c.close(); } });
      },
    }));
  });
  const finalMetadata = () => mocks.write.mock.calls.map(([chunk]) => chunk).find((chunk) => chunk.type === "message-metadata")?.messageMetadata;

  for (const value of ["", "true"]) {
    it(`keeps the left-out sentence's text on the start chunk, the final metadata and the saved row, so the screen can hide it (switch ${value ? "on" : "off"})`, async () => {
      if (value) vi.stubEnv("HAMILTON_GATE_REPAIR", value);
      await POST(requestFor({}));
      expect(mocks.merge).toHaveBeenCalledTimes(1);
      const start = streamOptions[0].messageMetadata?.({ part: { type: "start" } }) as { narrativeBinding: { omitted: unknown[] } };
      expect(start.narrativeBinding.omitted).toEqual([{ text: LEFT_OUT, reason: "wrong_institution" }]);
      expect(finalMetadata()).toMatchObject({ narrativeBinding: start.narrativeBinding, answerEvidence: { passed: true, held: false } });
      expect(mocks.save.mock.calls[0][0].response.narrativeBinding.omitted).toEqual([{ text: LEFT_OUT, reason: "wrong_institution" }]);
      expect(mocks.generate).not.toHaveBeenCalled();
    });
  }
});
