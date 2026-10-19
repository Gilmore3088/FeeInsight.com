import { beforeEach, describe, expect, it, vi } from "vitest";

// Invented institution and figures for tests only; nothing here is live data.
const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  track: vi.fn(),
  hasKey: vi.fn(() => true),
  briefing: vi.fn(async () => "\nBRIEFING."),
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
vi.mock("./institution-briefing", () => ({ buildHamiltonInstitutionBriefing: mocks.briefing }));
vi.mock("./request-contract", () => ({ buildHamiltonRequestContractPrompt: () => " CONTRACT." }));

const { writeWrittenAnswer } = await import("./written-answer-read");
const input = { institutionId: 7, institutionName: "First Example Bank", question: "Would a $40 overdraft fee be high?", tracking: { operation: "written_answer_eval", subjectKey: "k", agentRunId: 3 } };

beforeEach(() => {
  mocks.generateText.mockReset();
  mocks.hasKey.mockReturnValue(true);
  mocks.track.mockReset().mockImplementation(async (_context: unknown, call: () => Promise<unknown>) => call());
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
});
