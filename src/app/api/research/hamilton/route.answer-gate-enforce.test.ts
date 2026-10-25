/**
 * HAMILTON_ANSWER_GATE_ENFORCE (#1077, V5 plan T4) on the written-answer route, buffered and
 * streamed. Off (the default): the gate is never called on the request path and the reply is what
 * today's checks decide. On: a held verdict gets the path's held reply and its text is never sent,
 * in any mode; a validated one is shown as today. The whole SSE body is read through the real UI
 * message stream helpers; only the provider and, where a test forces a verdict, the gate are fakes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  stream: vi.fn(), generate: vi.fn(), briefing: vi.fn(), save: vi.fn(), usage: vi.fn(), shadow: vi.fn(),
  held: { message: "Synthetic held line." as string | null },
  /** A forced status for the gate; null runs the real gate; "partial_cut" adds a non-critical cut of `cut` to the real verdict. */
  forced: null as null | "validated" | "ready_partial" | "held" | "throw" | "partial_cut",
  cut: "",
  calls: 0,
}));
// The shadow is computed at once here, so each test reads the record it would write after the response.
vi.mock("@/lib/hamilton/output-gate-shadow-store", () => ({
  scheduleGateShadow: (compute: () => unknown) => { mocks.shadow(compute()); },
  GATE_SHADOW_DETAIL_KEY: "gate_shadow",
}));
vi.mock("@/lib/hamilton/output-gate", async () => {
  const actual = await vi.importActual<typeof import("@/lib/hamilton/output-gate")>("@/lib/hamilton/output-gate");
  return {
    ...actual,
    gateAnswer: (input: Parameters<typeof actual.gateAnswer>[0]) => {
      mocks.calls += 1;
      if (mocks.forced === "throw") throw new Error("synthetic gate failure");
      const verdict = actual.gateAnswer(input);
      if (!mocks.forced) return verdict;
      if (mocks.forced === "partial_cut") {
        return { ...verdict, status: "ready_partial" as const,
          failures: [...verdict.failures, { code: "causal_unsupported" as const, message: "Synthetic unsupported cause.", critical: false, source: "cause" as const, sentences: [mocks.cut] }] };
      }
      const failures = mocks.forced === "validated" ? []
        : [{ code: "untraced_figure" as const, message: "Synthetic untraced figure.", critical: mocks.forced === "held", source: "check" as const }];
      return { ...verdict, status: mocks.forced, failures };
    },
  };
});
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
// The real module, with only the density check passing every draft: these tests are about the output gate.
vi.mock("@/lib/hamilton/citation-gate", async () => ({
  ...(await vi.importActual<typeof import("@/lib/hamilton/citation-gate")>("@/lib/hamilton/citation-gate")),
  evaluateCitationDensity: (text: string) => ({ status: "ok", metrics: { chars: text.length } }),
}));
vi.mock("ai", async () => ({
  ...(await vi.importActual<typeof import("ai")>("ai")),
  streamText: mocks.stream, generateText: mocks.generate, convertToModelMessages: async (messages: unknown) => messages, stepCountIs: () => ({}),
}));
import { ALL_LEFT_OUT_LEAD } from "@/lib/hamilton/written-answer-binding";
import { writtenAnswerBinding } from "@/lib/hamilton/answer-save";
import { POST } from "./route";

// Invented figures for tests only.
const TOOL_OUTPUT = { fee: 35, peer_median: 29 };
const PASSING = "## Hamilton's View\nThe overdraft fee of $35 sits above the peer median of $29.";
const QUESTION = "How does our overdraft fee compare?";
const DRAFT_MARK = "peer median of $29";

const request = (mode: string | null = "analyze", extra: Record<string, unknown> = {}) => new Request("https://example.test/api/research/hamilton", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text: QUESTION }] }], ...(mode ? { mode } : {}), institutionId: 202, ...extra }),
});

type Chunk = Record<string, unknown> & { type: string };

function providerChunks(text: string, output: unknown = TOOL_OUTPUT): Chunk[] {
  return [
    { type: "start" }, { type: "start-step" },
    { type: "tool-input-available", toolCallId: "call-1", toolName: "getInstitution", input: {} },
    { type: "tool-output-available", toolCallId: "call-1", output },
    { type: "reasoning-start", id: "r1" }, { type: "reasoning-delta", id: "r1", delta: `Drafting: ${text}` }, { type: "reasoning-end", id: "r1" },
    { type: "text-start", id: "t1" }, { type: "text-delta", id: "t1", delta: text }, { type: "text-end", id: "t1" },
    { type: "finish-step" }, { type: "finish", finishReason: "stop" },
  ];
}

function streams(text: string, finishReason = "stop", outputs: unknown[] = [TOOL_OUTPUT]) {
  mocks.stream.mockImplementation((options) => ({
    consumeStream: async () => options.onFinish({ finishReason, totalUsage: { inputTokens: 1, outputTokens: 1 }, text,
      steps: [{ toolResults: outputs.map((output) => ({ toolName: "getInstitution", input: {}, output })) }] }),
    toUIMessageStream: (streamOptions: { messageMetadata?: (input: { part: Chunk }) => unknown }) => {
      const chunks = providerChunks(text, outputs[0]).map((chunk) => {
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
const textOf = (chunks: Chunk[]) => chunks.filter((c) => c.type === "text-delta").map((c) => c.delta).join("");
/** The body without the random ids the UI stream helper gives each message, so two runs compare byte for byte. */
const stable = (raw: string) => raw.replace(/"messageId":"[^"]+"/g, '"messageId":"x"');
const draft = (text: string) => ({ text, finishReason: "stop", steps: [{ toolResults: [{ toolName: "getInstitution", input: {}, output: TOOL_OUTPUT }] }],
  totalUsage: { inputTokens: 10, outputTokens: 5 }, response: { messages: [] } });

beforeEach(() => {
  mocks.held.message = "Synthetic held line.";
  mocks.forced = null;
  mocks.calls = 0;
  for (const mock of [mocks.stream, mocks.generate, mocks.usage, mocks.shadow]) mock.mockReset();
  mocks.briefing.mockReset().mockResolvedValue({ prompt: "Research evidence.", evidence: [] });
  mocks.save.mockReset().mockResolvedValue("saved-1");
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("streamed written answer, switch off (the default)", () => {
  it.each(["analyze", null])("mode %s: the gate never runs on the request path, so a verdict it would hold changes nothing", async (mode) => {
    streams(PASSING);
    const baseline = await sse(await POST(request(mode)));
    mocks.shadow.mockReset();
    mocks.calls = 0;
    mocks.forced = "held";
    streams(PASSING);
    const off = await sse(await POST(request(mode)));
    // Only the shadow (computed at once here) calls the gate: one call per answer.
    expect(mocks.calls).toBe(1);
    expect(stable(off.raw)).toBe(stable(baseline.raw));
    expect(textOf(off.chunks)).toBe(PASSING);
    expect(mocks.shadow.mock.calls[0][0]).not.toHaveProperty("gateMode");
  });
});

describe("streamed written answer, switch on", () => {
  beforeEach(() => { vi.stubEnv("HAMILTON_ANSWER_GATE_ENFORCE", "true"); });

  it.each(["held", "ready_partial", "throw"] as const)("a %s verdict in Analyze: the held line only, the draft never sent, nothing saved", async (forced) => {
    mocks.forced = forced;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    streams(PASSING);
    const { raw, chunks } = await sse(await POST(request("analyze")));
    // ready_partial: the forced failure cuts no sentence, so a partial view would still hold it: held.
    expect(textOf(chunks)).toBe("Synthetic held line.");
    expect(raw).not.toContain(DRAFT_MARK);
    expect(chunks.some((c) => c.type.startsWith("reasoning"))).toBe(false);
    expect(mocks.save).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("a held verdict in an admin chat (no mode), which streamed ungated before, is held too", async () => {
    mocks.forced = "held";
    streams(PASSING);
    const { raw, chunks } = await sse(await POST(request(null)));
    expect(textOf(chunks)).toBe("Synthetic held line.");
    expect(raw).not.toContain(DRAFT_MARK);
    expect(mocks.shadow.mock.calls[0][0]).toMatchObject({ path: "written_streaming", today: "shown_ungated", gateMode: "enforced" });
  });

  it("holds with the source-check line when no held line is set", async () => {
    mocks.held.message = null;
    mocks.forced = "held";
    streams(PASSING);
    const { raw, chunks } = await sse(await POST(request("analyze")));
    expect(textOf(chunks)).toBe(ALL_LEFT_OUT_LEAD);
    expect(raw).not.toContain(DRAFT_MARK);
  });

  it("a validated answer is shown and saved as today, in Analyze and in an admin chat", async () => {
    streams(PASSING);
    const analyze = await sse(await POST(request("analyze")));
    expect(textOf(analyze.chunks)).toBe(PASSING);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.shadow.mock.calls[0][0]).toMatchObject({ unified: "validated", gateMode: "enforced" });
    streams(PASSING);
    expect(textOf((await sse(await POST(request(null)))).chunks)).toBe(PASSING);
  });

  it("a partial verdict that cuts a sentence the real binding keeps: the cut text is nowhere in the body and is not saved", async () => {
    // Invented banks: the profile read returns Synthetic Bank A's $10 overdraft fee as a catalog row, so the binding binds.
    const profile = {
      identity: { id: 9001, name: "Synthetic Bank A" },
      fees: { verified: [{ fee_name: "Overdraft", fee_category: "overdraft", amount: 10, frequency: "per item", status: "verified", record_id: 1, source_document_id: 101 }], provisional: [] },
    };
    const kept = "Synthetic Bank A charges $10 for an overdraft.";
    const cut = "Synthetic Bank A keeps it there because its costs rose.";
    const text = `## Hamilton's View\n${kept} ${cut}`;
    const binding = writtenAnswerBinding(text, [profile], QUESTION,
      { toolResults: [{ toolName: "getInstitution", input: {}, output: profile }], institutionId: 202, accountInstitutionId: null });
    expect(binding?.supported.map((s) => s.text)).toContain(kept);
    expect(binding?.omitted.map((o) => o.text) ?? []).not.toContain(cut);
    mocks.forced = "partial_cut";
    mocks.cut = cut;
    streams(text, "stop", [profile]);
    const { raw, chunks } = await sse(await POST(request("analyze")));
    expect(raw).not.toContain(cut);
    expect(raw).not.toContain("because its costs rose");
    expect(textOf(chunks)).toBe("Synthetic held line.");
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("an answer the provider never finished sends no text: the gate never read it", async () => {
    streams(PASSING, "length");
    const { raw, chunks } = await sse(await POST(request("analyze")));
    expect(raw).not.toContain(DRAFT_MARK);
    expect(textOf(chunks)).toBe("");
    expect(mocks.save).not.toHaveBeenCalled();
  });
});

describe("buffered written answer (gate_citations)", () => {
  it("switch off: shown as today, the gate not called on the request path", async () => {
    mocks.forced = "held";
    mocks.generate.mockResolvedValueOnce(draft(PASSING));
    const body = await (await POST(request("analyze", { gate_citations: true }))).json();
    expect(body).toMatchObject({ status: "ok", text: PASSING });
    expect(mocks.calls).toBe(1); // the shadow only
  });

  it("switch on: a held or partial verdict is refused with no answer text; validated is shown", async () => {
    vi.stubEnv("HAMILTON_ANSWER_GATE_ENFORCE", "on");
    for (const forced of ["held", "ready_partial"] as const) {
      mocks.forced = forced;
      mocks.generate.mockResolvedValueOnce(draft(PASSING));
      const response = await POST(request("analyze", { gate_citations: true }));
      const raw = await response.text();
      expect(JSON.parse(raw), forced).toMatchObject({ status: "refused", reason: "evidence_check_failed", problems: ["Synthetic untraced figure."] });
      expect(raw).not.toContain(DRAFT_MARK);
    }
    expect(mocks.shadow.mock.calls.at(-1)?.[0]).toMatchObject({ path: "written_buffered", gateMode: "enforced" });
    mocks.forced = null;
    mocks.generate.mockResolvedValueOnce(draft(PASSING));
    expect(await (await POST(request("analyze", { gate_citations: true }))).json()).toMatchObject({ status: "ok", text: PASSING });
  });
});
