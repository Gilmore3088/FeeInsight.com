// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { simulateReadableStream, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";

// Invented institution and figures for tests only; nothing here is live data.
const mocks = vi.hoisted(() => ({ append: vi.fn(), usage: vi.fn(), log: vi.fn(), model: { current: null as unknown } }));
vi.mock("@/lib/api-hardening/route-wrapper", () => ({ withApiRoutePolicy: (_id: string, _method: string, handle: unknown) => handle }));
vi.mock("@/lib/api-hardening/audit", () => ({ getRequestSubjectKey: () => "fixture-user" }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => ({ id: 7, role: "admin" }) }));
vi.mock("@/lib/hamilton/quota", () => ({ checkProAiQuota: async () => ({ allowed: true }), quotaExceededMessage: () => "quota" }));
vi.mock("@/lib/ai-provider-usage", async () => ({
  observedProviderUsage: (await vi.importActual<typeof import("@/lib/ai-provider-usage")>("@/lib/ai-provider-usage")).observedProviderUsage,
  guardProviderCall: async () => Date.now(), recordProviderUsage: mocks.usage, estimateAnthropicCostMicrousd: () => 0 }));
vi.mock("@/lib/ai-provider", async () => ({
  ...(await vi.importActual<typeof import("@/lib/ai-provider")>("@/lib/ai-provider")),
  hasAnthropicApiKey: () => true,
  getAnthropicLanguageModel: () => mocks.model.current,
}));
vi.mock("@/lib/research/history", () => ({ logUsage: mocks.log }));
vi.mock("@/lib/hamilton/chat-memory", () => ({ loadConversationHistory: async () => [], appendMessage: mocks.append }));
vi.mock("@/lib/hamilton/hamilton-agent", () => ({
  buildHamiltonSystemPrompt: () => "Fixture only",
  buildHamiltonTools: () => ({ peerFees: tool({ inputSchema: z.object({}), execute: async () => ({ peer_median: 34 }) }) }),
}));
vi.mock("@/lib/hamilton/institution-briefing", () => ({ buildHamiltonInstitutionBriefing: async () => "Fixture" }));
vi.mock("@/lib/data-store", () => ({ getInstitutionById: async () => null }));
import { POST } from "./route";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 3, text: 3, reasoning: undefined },
};
const text = (id: string, delta: string): LanguageModelV3StreamPart[] => [
  { type: "text-start", id }, { type: "text-delta", id, delta }, { type: "text-end", id },
];
// Step 1 writes a sentence, then reads data; step 2 writes the rest.
const STEPS: LanguageModelV3StreamPart[][] = [
  [
    ...text("0", "First Example Bank charges $35.00 for an overdraft."),
    { type: "tool-call", toolCallId: "call-1", toolName: "peerFees", input: "{}" },
    { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_use" }, usage },
  ],
  [
    ...text("0", "Across 7 peers, the median is $34.00."),
    { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage },
  ],
];

beforeEach(() => {
  for (const mock of [mocks.append, mocks.usage, mocks.log]) mock.mockReset().mockResolvedValue(undefined);
  let step = 0;
  mocks.model.current = new MockLanguageModelV3({
    doStream: async () => ({ stream: simulateReadableStream({ chunks: STEPS[step++], initialDelayInMs: 0, chunkDelayInMs: 0 }) }),
  });
});

describe("admin chat saved assistant message", () => {
  it("stores every step's text, joined as the screen joins it, not the SDK's last-step text", async () => {
    const response = await POST(new Request("https://fixture.invalid/api/hamilton/chat", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ id: "q", role: "user", parts: [{ type: "text", text: "Is our overdraft fee high?" }] }],
        conversation_id: "00000000-0000-4000-8000-000000000007" }),
    }));
    await response.text();
    await vi.waitFor(() => expect(mocks.append.mock.calls.map((call) => call[2])).toEqual(["user", "assistant"]));
    expect(mocks.append.mock.calls[1][3]).toBe("First Example Bank charges $35.00 for an overdraft. Across 7 peers, the median is $34.00.");
  });
});
