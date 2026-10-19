import { beforeEach, describe, expect, it, vi } from "vitest";

// Invented institution and figures for tests only; nothing here is live data.
const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  track: vi.fn(),
  hasKey: vi.fn(() => true),
  briefing: vi.fn(),
}));
vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));
vi.mock("ai", () => ({
  generateText: mocks.generateText,
  convertToModelMessages: async (messages: unknown) => messages,
  stepCountIs: (n: number) => ({ steps: n }),
}));
vi.mock("@/lib/ai-provider", () => ({
  getAnthropicLanguageModel: () => "model",
  hasAnthropicApiKey: mocks.hasKey,
  isProviderLimitError: (error: unknown) => error instanceof Error && error.message === "provider limit",
}));
vi.mock("@/lib/ai-provider-usage", async () => ({
  observedProviderUsage: (await vi.importActual<typeof import("@/lib/ai-provider-usage")>("@/lib/ai-provider-usage")).observedProviderUsage, trackAnthropicRequest: mocks.track }));
vi.mock("@/lib/research/agents", () => ({
  getHamilton: async () => ({ systemPrompt: "Hamilton.", model: "test-model", tools: { t: {} }, maxTokens: 900, maxSteps: 4 }),
  buildAnalyzeModeSuffix: (focus: string) => ` ANALYZE ${focus}.`,
  buildMonitorModeSuffix: () => "",
  buildSavedPeerSetPrompt: () => "",
}));
vi.mock("@/lib/research/skills", () => ({
  detectSkill: () => null, buildSkillInjection: () => "", buildSkillExecution: () => "", isSkillOptIn: () => false, findOfferedSkill: () => null,
}));
vi.mock("./institution-briefing", () => ({ buildHamiltonInstitutionBriefingSnapshot: mocks.briefing }));
vi.mock("./request-contract", () => ({ buildHamiltonRequestContractPrompt: () => " CONTRACT." }));

const { writeWrittenAnswer, buildWrittenAnswerSystemPrompt } = await import("./written-answer-read");
const input = { institutionId: 7, institutionName: "First Example Bank", question: "Would a $40 overdraft fee be high?", tracking: { operation: "written_answer_eval", subjectKey: "k", agentRunId: 3 } };

beforeEach(() => {
  mocks.generateText.mockReset();
  mocks.hasKey.mockReturnValue(true);
  mocks.track.mockReset().mockImplementation(async (_context: unknown, call: () => Promise<unknown>) => call());
  mocks.briefing.mockReset().mockResolvedValue({ prompt: "\nBRIEFING.", evidence: [] });
});

describe("writeWrittenAnswer, the paid eval's written answer (#1414)", () => {
  it("records every step's tokens and cache use, tags the call and checks the answer against its tools and question", async () => {
    mocks.generateText.mockResolvedValue({
      text: "At $40 the fee would sit above the $30 peer median.",
      finishReason: "stop",
      steps: [{ toolResults: [{ toolName: "queryFeeData", output: { peer_median: 30 } }] }],
      totalUsage: { inputTokens: 900, outputTokens: 120, inputTokenDetails: { noCacheTokens: 300, cacheReadTokens: 500, cacheWriteTokens: 100 } },
    });
    let usage: unknown;
    mocks.track.mockImplementation(async (_context: unknown, call: () => Promise<unknown>) => {
      const value = await call();
      usage = (value as { usage?: unknown }).usage;
      return value;
    });
    const result = await writeWrittenAnswer(input);
    expect(usage).toEqual({ input_tokens: 300, output_tokens: 120, cache_read_input_tokens: 500, cache_creation_input_tokens: 100 });
    expect(mocks.track.mock.calls[0][0]).toMatchObject({ agent: "hamilton", operation: "written_answer_eval", routeId: "api.research.hamilton", subjectKey: "k", agentRunId: 3, metadata: { institution_id: 7 } });
    const call = mocks.generateText.mock.calls[0][0];
    expect(call).toMatchObject({ maxOutputTokens: 900, stopWhen: { steps: 4 }, tools: { t: {} } });
    expect(String(call.system.content ?? call.system)).toContain("ANALYZE Pricing.");
    expect(result).toMatchObject({ status: "written", toolResults: [{ toolName: "queryFeeData", output: { peer_median: 30 } }] });
    // $40 comes from the question, $30 from the tool: both trace.
    expect(result.status === "written" && result.check.passed).toBe(true);
  });

  it("reports a missing key, an empty answer, a refused provider and a spent budget as unavailable", async () => {
    mocks.hasKey.mockReturnValueOnce(false);
    expect(await writeWrittenAnswer(input)).toEqual({ status: "unavailable", reason: "Hamilton's writer is not configured." });
    mocks.generateText.mockResolvedValueOnce({ text: "  ", finishReason: "stop", steps: [], totalUsage: {} });
    expect(await writeWrittenAnswer(input)).toEqual({ status: "unavailable", reason: "Hamilton wrote no answer within its steps." });
    mocks.generateText.mockRejectedValueOnce(new Error("provider limit"));
    expect((await writeWrittenAnswer(input)).status).toBe("unavailable");
    mocks.generateText.mockRejectedValueOnce(new Error("Provider budget guard blocked this call."));
    expect(await writeWrittenAnswer(input)).toEqual({ status: "unavailable", reason: "Hamilton's writing budget for today is used up." });
    mocks.generateText.mockRejectedValueOnce(new Error("socket hang up"));
    expect(await writeWrittenAnswer(input)).toEqual({ status: "unavailable", reason: "Hamilton's writer could not be reached." });
  });

  it("checks the exact briefing snapshot that the buffered writer saw, without a second fetch", async () => {
    const fact = { institution_id: 7, institution_name: "First Example Bank", context_role: "research", metric: "service_charge_income",
      value: 57260, unit: "thousands of dollars", report_date: "2026-06-30", period_basis: "ytd",
      source: "ncua", publisher: "NCUA", evidence_tier: "regulatory" };
    mocks.briefing.mockResolvedValueOnce({ prompt: `\nBRIEFING ${JSON.stringify([fact])}`, evidence: [fact] });
    mocks.generateText.mockResolvedValue({ text: "Fee income through June was $57.26 million year to date.", finishReason: "stop", steps: [], totalUsage: {} });
    const result = await writeWrittenAnswer({ ...input, question: "What was fee income through June?" });
    expect(mocks.briefing).toHaveBeenCalledTimes(1);
    expect(mocks.briefing).toHaveBeenCalledWith(expect.objectContaining({ institutionId: 7 }), { writtenAnswer: true });
    const system = mocks.generateText.mock.calls[0][0].system;
    expect(String(system.content ?? system)).toContain(JSON.stringify([fact]));
    expect(String(system.content ?? system)).toContain("first call queryData");
    expect(String(system.content ?? system)).toContain("never calculation inputs");
    expect(result.status === "written" && result.check.passed).toBe(true);
  });

  it("returns selected and home evidence once with their own identities and scopes", async () => {
    const selected = { institution_id: 7, context_role: "research", metric: "service_charge_income", value: 10 };
    const home = { institution_id: 8, context_role: "account_evidence", metric: "service_charge_income", value: 20 };
    mocks.briefing.mockResolvedValueOnce({ prompt: "SELECTED SNAPSHOT", evidence: [selected] })
      .mockResolvedValueOnce({ prompt: "HOME SNAPSHOT", evidence: [home] });
    const result = await buildWrittenAnswerSystemPrompt({ agent: { systemPrompt: "Hamilton." }, peerSet: null, homeId: 8,
      contract: { audience: "pro", institutionId: 7, intent: "analyze", evidencePolicy: "provisional-first", gateCitations: false,
        mode: "analyze", messages: [{ id: "question", role: "user", parts: [{ type: "text", text: "How do we compare?" }] }] } });
    expect(mocks.briefing).toHaveBeenCalledTimes(2);
    expect(mocks.briefing.mock.calls[1][1]).toEqual({ contextRole: "account_evidence", writtenAnswer: true });
    expect(result).toMatchObject({ status: "ok", briefingEvidence: [selected, home] });
    expect(result.status === "ok" && result.systemPrompt).toContain("research subject remains 7");
  });
});
