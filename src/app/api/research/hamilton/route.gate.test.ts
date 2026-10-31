/**
 * Integration test — the /api/research/hamilton route honours the citation
 * gate when `gate_citations: true` is sent. Heavy dependencies (ai SDK,
 * Anthropic provider, DB, auth, rate limiter) are mocked — we just verify
 * the gate evaluates the buffered output and returns the structured
 * refusal shape.
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

// This suite exercises citation/provider gates, not membership storage.
vi.mock("@/lib/hamilton/output-gate-shadow-store", () => ({ scheduleGateShadow: () => {}, GATE_SHADOW_DETAIL_KEY: "gate_shadow" }));
vi.mock("@/lib/hamilton/institution-membership", () => ({
  getUserInstitutionMemberships: async () => [],
}));

// ─── Mocks (must be declared before importing the route) ──────────────────────

const generateTextMock = vi.fn();
const providerUsageMocks = vi.hoisted(() => ({
  trackAnthropicRequestMock: vi.fn(async (_context: unknown, request: () => Promise<unknown>) =>
    request(),
  ),
  guardProviderCallMock: vi.fn(async () => Date.now()),
  recordProviderUsageMock: vi.fn(async () => {}),
}));

vi.mock("@/lib/hamilton/quota", () => ({
  checkProAiQuota: async () => ({ allowed: true, used: 0, limit: 50, resetsAt: "" }),
  quotaExceededMessage: () => "quota",
}));

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    generateText: generateTextMock,
    // convertToModelMessages becomes a no-op pass-through for the test
    convertToModelMessages: async (messages: unknown) => messages,
    streamText: vi.fn(),
    stepCountIs: () => ({}),
  };
});

vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: (model: string) => ({ model }),
  createAnthropic: () => (model: string) => ({ model }),
}));

vi.mock("@/lib/ai-provider-usage", async () => ({
  observedProviderUsage: (await vi.importActual<typeof import("@/lib/ai-provider-usage")>("@/lib/ai-provider-usage")).observedProviderUsage,
  estimateAnthropicCostMicrousd: () => 0,
  ProviderCircuitOpenError: class ProviderCircuitOpenError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ProviderCircuitOpenError";
    }
  },
  ProviderBudgetBlockedError: class ProviderBudgetBlockedError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ProviderBudgetBlockedError";
    }
  },
  trackAnthropicRequest: providerUsageMocks.trackAnthropicRequestMock,
  guardProviderCall: providerUsageMocks.guardProviderCallMock,
  recordProviderUsage: providerUsageMocks.recordProviderUsageMock,
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(async () => ({
    id: 1,
    role: "admin",
    username: "test",
    display_name: "Test Admin",
  })),
}));

vi.mock("@/lib/access", () => ({
  canAccessPremium: vi.fn(() => true),
}));

vi.mock("@/lib/research/history", () => ({
  getDailyCostCents: async () => 0,
  logUsage: vi.fn(async () => {}),
}));

vi.mock("@/lib/research/skills", () => ({
  detectSkill: () => null,
  buildSkillInjection: () => "",
  buildSkillExecution: () => "",
  isSkillOptIn: () => false,
  findOfferedSkill: () => null,
}));

const getHamiltonMock = vi.hoisted(() =>
  vi.fn(async (_role: string) => ({
    name: "Hamilton",
    model: "claude-sonnet-4-5-20250929",
    systemPrompt: "You are Hamilton.",
    tools: {},
    maxTokens: 1500,
    maxSteps: 4,
  })),
);

vi.mock("@/lib/research/agents", () => ({
  getHamilton: getHamiltonMock,
  buildAnalyzeModeSuffix: () => "",
  buildMonitorModeSuffix: () => "",
  buildSavedPeerSetPrompt: () => "",
  savedPeerSetUsed: () => false,
}));

vi.mock("@/lib/hamilton/active-peer-set", () => ({
  getActivePeerSet: async () => null,
}));

import { getCurrentUser } from "@/lib/auth";
import { HAMILTON_STOPPED_MESSAGE } from "@/lib/hamilton/provider-paused";

// ─── Test-local helper ────────────────────────────────────────────────────────

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/research/hamilton", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// The real generateText result carries each step's text parts: a one-step answer's text is steps[0].content.
function oneStep<T extends { text: string; steps?: { toolResults: unknown[] }[] }>(result: T) {
  const [first = { toolResults: [] }] = result.steps ?? [];
  return { ...result, steps: [{ ...first, content: [{ type: "text", text: result.text }] }] };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("POST /api/research/hamilton — citation gate", () => {
  beforeAll(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
  });

  beforeEach(() => {
    generateTextMock.mockReset();
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: 1,
      role: "admin",
      username: "test",
      display_name: "Test Admin",
      email: "test@example.com",
      stripe_customer_id: null,
      subscription_status: "active",
      institution_name: null,
      institution_type: null,
      asset_tier: null,
      state_code: null,
      fed_district: null,
      job_role: null,
      interests: null,
    });
    providerUsageMocks.trackAnthropicRequestMock.mockReset().mockImplementation(
      async (_context: unknown, request: () => Promise<unknown>) => request(),
    );
    providerUsageMocks.guardProviderCallMock.mockReset().mockResolvedValue(Date.now());
    providerUsageMocks.recordProviderUsageMock.mockReset().mockResolvedValue(undefined);
  });

  it("should_reject_unauthenticated_public_ai_before_provider_guard", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(null);

    const { POST } = await import("./route");
    const res = await POST(makeRequest({
      messages: [{ role: "user", parts: [{ type: "text", text: "overdraft report" }] }],
    }));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("public_ai_disabled");
    expect(providerUsageMocks.guardProviderCallMock).not.toHaveBeenCalled();
    expect(providerUsageMocks.trackAnthropicRequestMock).not.toHaveBeenCalled();
  });

  it("should_return_refused_when_report_has_no_citations", async () => {
    generateTextMock.mockResolvedValue(oneStep({
      text: [
        "## Findings",
        "Overdraft fees are very high at $35 on average.",
        "NSF fees are running at $32 typically.",
        "Wire fees have climbed to $25 per transaction.",
        "Foreign transaction fees hold near 3% of the amount.",
        "ATM fees sit around $3.50 out of network.",
        "Maintenance fees average $12 monthly.",
      ].join("\n"),
      finishReason: "stop",
      usage: { inputTokens: 100, outputTokens: 200 },
    }));

    const { POST } = await import("./route");
    const res = await POST(makeRequest({
      messages: [{ role: "user", parts: [{ type: "text", text: "overdraft report" }] }],
      gate_citations: true,
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("refused");
    expect(body.reason).toBe("insufficient_citations");
    expect(body.metrics.claims).toBeGreaterThan(0);
    expect(body.metrics.citations).toBeLessThan(5);
    expect(Array.isArray(body.claims_without_citations)).toBe(true);
    expect(body.suggestion).toMatch(/citation|claim|data source/i);
  });

  it("records every tool step's tokens and cache use for a gated answer, not the last step's (#1418)", async () => {
    generateTextMock.mockResolvedValue(oneStep({
      text: "No figures here.",
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 5 },
      totalUsage: { inputTokens: 900, outputTokens: 300, inputTokenDetails: { noCacheTokens: 200, cacheReadTokens: 600, cacheWriteTokens: 100 } },
    }));
    let recorded: unknown;
    providerUsageMocks.trackAnthropicRequestMock.mockImplementation(async (_context: unknown, request: () => Promise<unknown>) => {
      const value = await request();
      recorded = (value as { usage?: unknown }).usage;
      return value;
    });

    const { POST } = await import("./route");
    await POST(makeRequest({
      messages: [{ role: "user", parts: [{ type: "text", text: "overdraft report" }] }],
      gate_citations: true,
    }));

    expect(recorded).toEqual({ input_tokens: 200, output_tokens: 300, cache_read_input_tokens: 600, cache_creation_input_tokens: 100 });
  });

  it("should_return_ok_when_report_is_well_cited", async () => {
    generateTextMock.mockResolvedValue(oneStep({
      text: [
        "## Findings",
        "Per published fee records, the national median overdraft is $35 across 1,284 institutions.",
        "JPMorgan Chase charges $34 for overdraft, per published fee records.",
        "According to Call Reports, service charge revenue fell 3.6% year over year.",
        "The 75th percentile sits at $38 per published fee records.",
        "FRED series FEDFUNDS shows a 5.3% federal funds rate.",
        "Beige Book commentary notes tightening consumer credit across 6 districts.",
        "Fifth Third Bank reports a $37 NSF fee per published fee records.",
      ].join("\n"),
      steps: [{ toolResults: [{ output: { median: 35, fee: 34, change_pct: 3.6, p75: 38, rate: 5.3, amount: 37 } }] }],
      finishReason: "stop",
      usage: { inputTokens: 100, outputTokens: 200 },
    }));

    const { POST } = await import("./route");
    const res = await POST(makeRequest({
      messages: [{ role: "user", parts: [{ type: "text", text: "overdraft report" }] }],
      gate_citations: true,
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.text).toContain("published fee records");
    expect(body.metrics.citations).toBeGreaterThanOrEqual(5);
  });

  it("should_refuse_a_well_cited_report_whose_figures_or_wording_fail_the_evidence_gate", async () => {
    generateTextMock.mockResolvedValue(oneStep({
      text: [
        "## Findings",
        "Per published fee records, the national median overdraft is $35 across 1,284 institutions.",
        "JPMorgan Chase charges $34 for overdraft, per published fee records.",
        "According to Call Reports, service charge revenue fell 3.6% year over year.",
        "The 75th percentile sits at $38 per published fee records.",
        "FRED series FEDFUNDS shows a 5.3% federal funds rate.",
        "Beige Book commentary notes tightening consumer credit across 6 districts.",
        "Fifth Third Bank reports a $41 NSF fee per published fee records, so you should lower the fee.",
      ].join("\n"),
      steps: [{ toolResults: [{ output: { median: 35, fee: 34, change_pct: 3.6, p75: 38, rate: 5.3 } }] }],
      finishReason: "stop",
      usage: { inputTokens: 100, outputTokens: 200 },
    }));

    const { POST } = await import("./route");
    const res = await POST(makeRequest({
      messages: [{ role: "user", parts: [{ type: "text", text: "overdraft report" }] }],
      gate_citations: true,
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("refused");
    expect(body.reason).toBe("evidence_check_failed");
    expect(body.text).toBeUndefined();
    expect(body.problems.join(" ")).toContain("$41");
    expect(body.problems.join(" ")).toContain("advice");
  });

  it("checks and sends every step's text of a gated report, not generateText's last-step text", async () => {
    // The real SDK generateText over a mock model: the model writes a sentence, reads data, then
    // writes the cited findings. generateText's own text is the second step alone, so before this
    // fix the first sentence (an untraced $41 and advice) was dropped from the report unchecked.
    const { generateText: realGenerateText, stepCountIs: realStepCountIs, tool } = await vi.importActual<typeof import("ai")>("ai");
    const { MockLanguageModelV3 } = await import("ai/test");
    const { z } = await import("zod");
    const usage = {
      inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 3, text: 3, reasoning: undefined },
    };
    const steps = [
      {
        content: [
          { type: "text" as const, text: "Fifth Third Bank reports a $41 NSF fee per published fee records, so you should lower the fee." },
          { type: "tool-call" as const, toolCallId: "call-1", toolName: "peerFees", input: "{}" },
        ],
        finishReason: { unified: "tool-calls" as const, raw: "tool_use" }, usage, warnings: [],
      },
      {
        content: [{ type: "text" as const, text: [
          "## Findings",
          "Per published fee records, the national median overdraft is $35 across 1,284 institutions.",
          "JPMorgan Chase charges $34 for overdraft, per published fee records.",
          "According to Call Reports, service charge revenue fell 3.6% year over year.",
          "The 75th percentile sits at $38 per published fee records.",
          "FRED series FEDFUNDS shows a 5.3% federal funds rate.",
          "Beige Book commentary notes tightening consumer credit across 6 districts.",
        ].join("\n") }],
        finishReason: { unified: "stop" as const, raw: "end_turn" }, usage, warnings: [],
      },
    ];
    let step = 0;
    // The route's own system prompt, output cap and abort signal; the model, messages, tools and step
    // limit are the test's (the suite mocks the provider, the message conversion and stepCountIs).
    generateTextMock.mockImplementation((options: { system?: string; maxOutputTokens?: number; abortSignal?: AbortSignal }) => realGenerateText({
      system: options.system,
      maxOutputTokens: options.maxOutputTokens,
      abortSignal: options.abortSignal,
      model: new MockLanguageModelV3({ doGenerate: async () => steps[step++] }),
      // convertToModelMessages is a pass-through in this suite; the real SDK needs model messages.
      messages: [{ role: "user", content: "overdraft report" }],
      tools: { peerFees: tool({ inputSchema: z.object({}), execute: async () => ({ median: 35, fee: 34, change_pct: 3.6, p75: 38, rate: 5.3 }) }) },
      stopWhen: realStepCountIs(4),
    }));

    const { POST } = await import("./route");
    const res = await POST(makeRequest({
      messages: [{ role: "user", parts: [{ type: "text", text: "overdraft report" }] }],
      gate_citations: true,
    }));

    const body = await res.json();
    expect(step).toBe(2);
    expect(body.status).toBe("refused");
    expect(body.reason).toBe("evidence_check_failed");
    expect(body.text).toBeUndefined();
    expect(body.problems.join(" ")).toContain("$41");
  });

  it("should_answer_an_admin_on_the_analyze_screen_with_the_pro_prompt", async () => {
    generateTextMock.mockResolvedValue(oneStep({ text: "## Hamilton's View\nShort answer.", finishReason: "stop", usage: { inputTokens: 10, outputTokens: 10 } }));
    getHamiltonMock.mockClear();

    const { POST } = await import("./route");
    await POST(makeRequest({
      messages: [{ role: "user", parts: [{ type: "text", text: "pricing" }] }],
      mode: "analyze",
      gate_citations: true,
    }));
    await POST(makeRequest({
      messages: [{ role: "user", parts: [{ type: "text", text: "pipeline status" }] }],
      gate_citations: true,
    }));

    expect(getHamiltonMock.mock.calls.map((call) => call[0])).toEqual(["pro", "admin"]);
  });

  it("should_return_locked_when_gated_provider_circuit_is_open", async () => {
    const { ProviderCircuitOpenError } = await import("@/lib/ai-provider-usage");
    providerUsageMocks.trackAnthropicRequestMock.mockRejectedValueOnce(
      new ProviderCircuitOpenError(
        "Provider circuit is open: latest Anthropic credit-balance failure was 2026-08-13T02:00:00.000Z on hamilton.chat.",
      ),
    );

    const { POST } = await import("./route");
    const res = await POST(makeRequest({
      messages: [{ role: "user", parts: [{ type: "text", text: "overdraft report" }] }],
      gate_citations: true,
    }));

    expect(res.status).toBe(423);
    const body = await res.json();
    expect(body).toEqual({ error: HAMILTON_STOPPED_MESSAGE, code: "provider_stopped" });
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("keeps a Hamilton daily cap's own line instead of the stop line (#1921)", async () => {
    const { HamiltonTaskBudgetError, HAMILTON_READER_DAILY_CAP_MESSAGE } = await import("@/lib/hamilton/task-budget");
    providerUsageMocks.guardProviderCallMock.mockRejectedValueOnce(
      new HamiltonTaskBudgetError("reader_daily", "calls", 120, 120, "ask"),
    );

    const { POST } = await import("./route");
    const res = await POST(makeRequest({
      messages: [{ role: "user", parts: [{ type: "text", text: "overdraft report" }] }],
    }));

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: HAMILTON_READER_DAILY_CAP_MESSAGE, code: "hamilton_budget_cap" });
  });

  it("should_return_locked_when_streaming_provider_circuit_is_open", async () => {
    const { ProviderCircuitOpenError } = await import("@/lib/ai-provider-usage");
    providerUsageMocks.guardProviderCallMock.mockRejectedValueOnce(
      new ProviderCircuitOpenError(
        "Provider circuit is open: latest Anthropic credit-balance failure was 2026-08-13T02:00:00.000Z on hamilton.chat.",
      ),
    );

    const { POST } = await import("./route");
    const res = await POST(makeRequest({
      messages: [{ role: "user", parts: [{ type: "text", text: "overdraft report" }] }],
    }));

    expect(res.status).toBe(423);
    const body = await res.json();
    expect(body).toEqual({ error: HAMILTON_STOPPED_MESSAGE, code: "provider_stopped" });
  });
});
