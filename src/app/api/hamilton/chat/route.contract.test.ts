import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const streamTextMock = vi.hoisted(() => vi.fn());
const briefingMock = vi.hoisted(() => vi.fn());

const providerUsageMocks = vi.hoisted(() => ({
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
    streamText: streamTextMock,
    convertToModelMessages: async (messages: unknown) => messages,
    stepCountIs: () => ({}),
  };
});

vi.mock("@/lib/ai-provider", () => ({
  getHamiltonModel: () => "claude-opus-5-5",
  getAnthropicLanguageModel: (model: string) => ({ model }),
  hasAnthropicApiKey: () => true,
  MISSING_ANTHROPIC_API_KEY_MESSAGE: "Missing Anthropic API key",
}));

vi.mock("@/lib/ai-provider-usage", () => ({
  estimateAnthropicCostMicrousd: () => 0,
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

vi.mock("@/lib/research/rate-limit", () => ({
  checkAdminRateLimit: () => ({ allowed: true }),
}));

vi.mock("@/lib/research/history", () => ({
  getDailyCostCents: async () => 0,
  logUsage: vi.fn(async () => {}),
}));

vi.mock("@/lib/hamilton/chat-memory", () => ({
  loadConversationHistory: vi.fn(async () => []),
  appendMessage: vi.fn(async () => {}),
}));

vi.mock("@/lib/hamilton/hamilton-agent", () => ({
  buildHamiltonSystemPrompt: () => "You are internal Hamilton.",
  buildHamiltonTools: () => ({}),
}));

vi.mock("@/lib/hamilton/institution-briefing", () => ({
  buildHamiltonInstitutionBriefing: briefingMock,
}));

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/hamilton/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/hamilton/chat — shared request contract", () => {
  beforeAll(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
  });

  beforeEach(() => {
    streamTextMock.mockReset().mockReturnValue({
      toUIMessageStreamResponse: () => new Response("ok", { status: 200 }),
    });
    briefingMock.mockReset().mockResolvedValue("\nSELECTED INSTITUTION CONTEXT\n- Name: Example Bank\n");
    providerUsageMocks.guardProviderCallMock.mockReset().mockResolvedValue(Date.now());
    providerUsageMocks.recordProviderUsageMock.mockReset().mockResolvedValue(undefined);
  });

  it("rejects invalid institution IDs before provider calls", async () => {
    const { POST } = await import("./route");

    const res = await POST(makeRequest({
      messages: [{ role: "user", parts: [{ type: "text", text: "Analyze this" }] }],
      institutionId: "abc",
    }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid institutionId" });
    expect(providerUsageMocks.guardProviderCallMock).not.toHaveBeenCalled();
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("injects selected institution and policy context into admin chat", async () => {
    const { POST } = await import("./route");

    const res = await POST(makeRequest({
      messages: [{ role: "user", parts: [{ type: "text", text: "What should ops do next?" }] }],
      institutionId: 2945,
      intent: "institution",
      evidencePolicy: "source-diligence",
    }));

    expect(res.status).toBe(200);
    expect(briefingMock).toHaveBeenCalledWith(expect.objectContaining({
      audience: "admin",
      institutionId: 2945,
      intent: "institution",
      evidencePolicy: "source-diligence",
    }));
    expect(streamTextMock).toHaveBeenCalledWith(expect.objectContaining({
      system: expect.stringContaining("HAMILTON REQUEST CONTRACT"),
    }));
    expect(streamTextMock).toHaveBeenCalledWith(expect.objectContaining({
      system: expect.stringContaining("SELECTED INSTITUTION CONTEXT"),
    }));
  });

  it("returns not found when the selected institution cannot be resolved", async () => {
    briefingMock.mockResolvedValueOnce(null);
    const { POST } = await import("./route");

    const res = await POST(makeRequest({
      messages: [{ role: "user", parts: [{ type: "text", text: "Analyze this" }] }],
      institutionId: 4040,
    }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Institution not found" });
    expect(providerUsageMocks.guardProviderCallMock).not.toHaveBeenCalled();
    expect(streamTextMock).not.toHaveBeenCalled();
  });
});
