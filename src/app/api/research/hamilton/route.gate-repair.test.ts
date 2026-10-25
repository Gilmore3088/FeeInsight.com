/**
 * Claim contract step 5 (#1077): bounded repair and partial answers on the buffered written-answer
 * path, behind HAMILTON_GATE_REPAIR (off by default). Off, nothing changes and no rewrite is made;
 * on, the one output gate decides, one rewrite is asked for, and a partial answer shows its
 * supported sentences. The streamed answer is not changed by the switch (its replay needs a spike).
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
vi.mock("@/lib/hamilton/citation-gate", () => ({ evaluateCitationDensity: (text: string) => mocks.density(text) }));
vi.mock("ai", () => ({
  generateText: mocks.generate, streamText: mocks.stream, convertToModelMessages: async (messages: unknown) => messages, stepCountIs: () => ({}),
  createUIMessageStream: ({ execute }: { execute: (input: unknown) => Promise<void> }) => execute({ writer: { merge: mocks.merge, write: mocks.write } }),
  createUIMessageStreamResponse: async ({ stream }: { stream: Promise<void> }) => { await stream; return new Response("synthetic stream"); },
}));
import { POST } from "./route";

const TOOL_OUTPUT = { fee: 35, peer_median: 29 };
const PASSING = "## Hamilton's View\nThe overdraft fee of $35 sits above the peer median of $29.";
const UNTRACED = "## Hamilton's View\nThe overdraft fee of $35 sits above the peer median of $27.";
const ADVICE_SENTENCE = "The bank should lower the fee to match its peers.";
const WITH_ADVICE = `${PASSING} ${ADVICE_SENTENCE}`;
const QUESTION = "How does our overdraft fee compare?";

const requestFor = (extra: Record<string, unknown>) => new Request("https://example.test/api/research/hamilton", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text: QUESTION }] }], mode: "analyze", institutionId: 202, ...extra }),
});
const buffered = () => requestFor({ gate_citations: true });
const draft = (text: string) => ({ text, finishReason: "stop", steps: [{ toolResults: [{ toolName: "getInstitution", input: {}, output: TOOL_OUTPUT }] }],
  totalUsage: { inputTokens: 10, outputTokens: 5 }, response: { messages: [{ role: "assistant", content: text }] } });
const rewrite = (text: string) => ({ text, finishReason: "stop", steps: [], totalUsage: { inputTokens: 20, outputTokens: 6 } });

const repairRows = () => mocks.logUsage.mock.calls.filter((call) => call[2] === "hamilton-repair");

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

describe("buffered written answer with HAMILTON_GATE_REPAIR off (the default)", () => {
  it("refuses a failing draft as today and makes no rewrite", async () => {
    mocks.generate.mockResolvedValueOnce(draft(UNTRACED));
    const body = await (await POST(buffered())).json();
    expect(body).toMatchObject({ status: "refused", reason: "evidence_check_failed" });
    expect(body.gate).toBeUndefined();
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(repairRows()).toEqual([]);
  });
});

describe("buffered written answer with HAMILTON_GATE_REPAIR on (#1077 step 5)", () => {
  beforeEach(() => { vi.stubEnv("HAMILTON_GATE_REPAIR", "true"); });

  it("fails then passes: shows the rewrite, validated, with two provider calls recorded and the rewrite counted in the quota", async () => {
    mocks.generate.mockResolvedValueOnce(draft(UNTRACED)).mockResolvedValueOnce(rewrite(PASSING));
    const body = await (await POST(buffered())).json();
    expect(body).toMatchObject({ status: "ok", text: PASSING, gate: { status: "validated", repair: "used", firstStatus: "held", lead: null } });
    expect(mocks.generate).toHaveBeenCalledTimes(2);
    expect(mocks.tracked.mock.calls.map(([context]) => (context as { operation: string }).operation))
      .toEqual(["research_with_citation_gate", "research_gate_repair"]);
    const second = mocks.generate.mock.calls[1][0];
    expect(second.toolChoice).toBe("none");
    expect(second.messages.at(-2)).toMatchObject({ role: "assistant", content: UNTRACED });
    expect(second.messages.at(-1)).toMatchObject({ role: "user" });
    expect(second.messages.at(-1).content).toContain("$27");
    expect(repairRows()).toEqual([[7, null, "hamilton-repair", 20, 6, 0]]);
    expect(mocks.shadow.mock.calls[0][0]).toMatchObject({ today: "shown", unified: "validated" });
  });

  it("makes no rewrite for a validated first draft", async () => {
    mocks.generate.mockResolvedValueOnce(draft(PASSING));
    const body = await (await POST(buffered())).json();
    expect(body).toMatchObject({ status: "ok", text: PASSING, gate: { status: "validated", repair: "not_needed" } });
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  });

  it("fails twice with a non-critical failure: ready_partial, only the supported sentence, with the lead", async () => {
    mocks.generate.mockResolvedValueOnce(draft(WITH_ADVICE)).mockResolvedValueOnce(rewrite(WITH_ADVICE));
    const body = await (await POST(buffered())).json();
    expect(body).toMatchObject({ status: "ok", gate: { status: "ready_partial", repair: "kept_first", leftOut: 1,
      lead: "Part of this answer was left out because it did not pass Hamilton's checks." } });
    expect(body.text).toBe(PASSING);
    expect(mocks.shadow.mock.calls[0][0]).toMatchObject({ today: "shown_partial", unified: "ready_partial" });
  });

  it("critical twice: held, refused with the gate's problems", async () => {
    mocks.generate.mockResolvedValueOnce(draft(UNTRACED)).mockResolvedValueOnce(rewrite(UNTRACED));
    const body = await (await POST(buffered())).json();
    expect(body).toMatchObject({ status: "refused", reason: "evidence_check_failed", gate: { status: "held", repair: "kept_first" } });
    expect(body.problems[0]).toContain("$27");
    expect(body.text).toBeUndefined();
  });

  it("a provider stop on the first call: no rewrite", async () => {
    mocks.generate.mockRejectedValueOnce(new Error("synthetic provider stop"));
    const response = await POST(buffered());
    expect(response.status).toBe(503);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(repairRows()).toEqual([]);
  });

  it("a provider stop on the rewrite keeps the first draft's verdict and tries no more", async () => {
    mocks.generate.mockResolvedValueOnce(draft(UNTRACED)).mockRejectedValueOnce(new Error("synthetic provider stop"));
    const body = await (await POST(buffered())).json();
    expect(body).toMatchObject({ status: "refused", gate: { status: "held", repair: "failed" } });
    expect(mocks.generate).toHaveBeenCalledTimes(2);
    expect(repairRows()).toEqual([]);
  });

  it("makes no rewrite once the reader's daily quota is used", async () => {
    mocks.quotaAllowed = false;
    mocks.generate.mockResolvedValueOnce(draft(UNTRACED));
    const body = await (await POST(buffered())).json();
    expect(body).toMatchObject({ status: "refused", gate: { status: "held", repair: "not_allowed" } });
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  });

  it("leaves the streamed answer as it is: no rewrite there", async () => {
    mocks.stream.mockImplementation((options) => ({
      consumeStream: async () => options.onFinish({ finishReason: "stop", totalUsage: { inputTokens: 1, outputTokens: 1 }, text: UNTRACED,
        steps: [{ toolResults: [{ output: TOOL_OUTPUT }] }] }),
      toUIMessageStream: () => new ReadableStream({ start(c) { c.enqueue({ type: "finish", finishReason: "stop" }); c.close(); } }),
    }));
    await POST(requestFor({}));
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.stream).toHaveBeenCalledTimes(1);
    expect(mocks.write.mock.calls.some(([chunk]) => chunk.type === "text-delta" && chunk.delta === "Synthetic held line.")).toBe(true);
    expect(repairRows()).toEqual([]);
  });

  it("records the repair in the shadow run: first status, outcome and calls, no text", async () => {
    mocks.generate.mockResolvedValueOnce(draft(UNTRACED)).mockResolvedValueOnce(rewrite(PASSING));
    await POST(buffered());
    const record = mocks.shadow.mock.calls[0][0];
    expect(record.repair).toEqual({ firstStatus: "held", outcome: "used", calls: 1 });
    expect(JSON.stringify(record)).not.toContain("overdraft fee of");
  });

  it("gives the rewrite only the time left under maxDuration, and skips it when too little is left", async () => {
    let now = 1_000_000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      mocks.generate.mockImplementationOnce(async () => { now += 290_000; return draft(UNTRACED); });
      const body = await (await POST(buffered())).json();
      expect(body).toMatchObject({ status: "refused", gate: { repair: "not_allowed" } });
      expect(mocks.generate).toHaveBeenCalledTimes(1);
    } finally {
      clock.mockRestore();
    }
  });

  it("keeps a showable partial first draft when the rewrite fails citation density, with that draft's metrics", async () => {
    mocks.generate.mockResolvedValueOnce(draft(WITH_ADVICE)).mockResolvedValueOnce(rewrite(PASSING));
    mocks.density.mockImplementation((text: string) => text === PASSING
      ? { status: "refused", reason: "insufficient_citations", metrics: { which: "rewrite" } }
      : { status: "ok", metrics: { which: "first" } });
    const body = await (await POST(buffered())).json();
    expect(body).toMatchObject({ status: "ok", text: PASSING, metrics: { which: "first" }, gate: { status: "ready_partial", chosen: "first", repair: "used" } });
  });

  it("reports the chosen rewrite's density metrics", async () => {
    mocks.generate.mockResolvedValueOnce(draft(UNTRACED)).mockResolvedValueOnce(rewrite(PASSING));
    const body = await (await POST(buffered())).json();
    expect(body.metrics).toEqual({ chars: PASSING.length });
  });

  it("(B) never shows a bold-led Why It Matters bullet the gate cut", async () => {
    const text = `${PASSING}\n\n## Why It Matters\n- **Pricing.** ${ADVICE_SENTENCE}\n- The fee is one of the most visible prices on the account.`;
    mocks.generate.mockResolvedValueOnce(draft(text)).mockResolvedValueOnce(rewrite(text));
    const body = await (await POST(buffered())).json();
    expect(body).toMatchObject({ status: "ok", gate: { status: "ready_partial", leftOut: 1 } });
    expect(body.text).not.toContain("should lower");
    expect(body.text).toContain("The fee is one of the most visible prices on the account.");
  });

  it("(D) holds when the failing line also sits in Evidence", async () => {
    const text = `${WITH_ADVICE}\n\n## Evidence\n- **Overdraft fee:** $35, so the bank should lower the fee`;
    mocks.generate.mockResolvedValueOnce(draft(text)).mockResolvedValueOnce(rewrite(text));
    const body = await (await POST(buffered())).json();
    expect(body).toMatchObject({ status: "refused", reason: "evidence_check_failed", gate: { status: "held", gateStatus: "ready_partial", heldBy: "failure_outside_prose" } });
    expect(mocks.shadow.mock.calls[0][0]).toMatchObject({ today: "held" });
  });
});
