/**
 * The research route with the Analyze screen's conversation block (#1273): the skill checks read
 * only what the reader typed, and the server bounds what any client sends. Provider, DB and auth
 * are mocked; no paid call is made.
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

vi.mock("@/lib/hamilton/institution-membership", () => ({
  getUserInstitutionMemberships: async () => [],
}));

const generateTextMock = vi.fn();
const providerUsageMocks = vi.hoisted(() => ({
  trackAnthropicRequestMock: vi.fn(async (_context: unknown, request: () => Promise<unknown>) => request()),
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
    convertToModelMessages: async (messages: unknown) => messages,
    streamText: vi.fn(),
    stepCountIs: () => ({}),
  };
});

vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: (model: string) => ({ model }),
}));

vi.mock("@/lib/ai-provider-usage", () => ({
  estimateAnthropicCostMicrousd: () => 0,
  ProviderCircuitOpenError: class ProviderCircuitOpenError extends Error {},
  ProviderBudgetBlockedError: class ProviderBudgetBlockedError extends Error {},
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

// The real skill checks, wrapped so the test sees which text each one read.
const skillSpies = vi.hoisted(() => ({
  isSkillOptIn: vi.fn(),
  detectSkill: vi.fn(),
  buildSkillExecution: vi.fn(),
  buildSkillInjection: vi.fn(),
}));
vi.mock("@/lib/research/skills", async () => {
  const actual = await vi.importActual<typeof import("@/lib/research/skills")>("@/lib/research/skills");
  skillSpies.isSkillOptIn.mockImplementation(actual.isSkillOptIn);
  skillSpies.detectSkill.mockImplementation(actual.detectSkill);
  skillSpies.buildSkillExecution.mockImplementation(actual.buildSkillExecution);
  skillSpies.buildSkillInjection.mockImplementation(actual.buildSkillInjection);
  return { ...actual, ...skillSpies };
});

vi.mock("@/lib/research/agents", () => ({
  getHamilton: async () => ({
    name: "Hamilton",
    model: "test-model",
    systemPrompt: "You are Hamilton.",
    tools: {},
    maxTokens: 1500,
    maxSteps: 4,
  }),
  buildAnalyzeModeSuffix: () => "",
  buildMonitorModeSuffix: () => "",
  buildSavedPeerSetPrompt: () => "",
  savedPeerSetUsed: () => false,
}));

vi.mock("@/lib/hamilton/active-peer-set", () => ({
  getActivePeerSet: async () => null,
}));

import { isSkillOptIn } from "@/lib/research/skills";
import {
  MAX_REQUEST_MESSAGES,
  MAX_USER_MESSAGE_CHARS,
  MESSAGE_TOO_LONG_ERROR,
  TOO_MANY_MESSAGES_ERROR,
  withConversationContext,
} from "@/lib/hamilton/conversation-context";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/research/hamilton", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function userMessage(text: string) {
  return { role: "user", parts: [{ type: "text", text }] };
}

describe("POST /api/research/hamilton with conversation context (#1273)", () => {
  beforeAll(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
  });

  beforeEach(() => {
    generateTextMock.mockReset().mockResolvedValue({ text: "No figures.", usage: { inputTokens: 1, outputTokens: 1 } });
    skillSpies.isSkillOptIn.mockClear();
    skillSpies.detectSkill.mockClear();
    skillSpies.buildSkillExecution.mockClear();
    providerUsageMocks.trackAnthropicRequestMock.mockClear();
  });

  it("runs the skill checks on the typed question, not on an earlier answer that says 'generate a full report'", async () => {
    const typed = "What do peers charge for a stop payment?";
    const text = withConversationContext(typed, [
      { question: "List ten peers", lead: "Ask me to generate a full report on these ten banks." },
    ]);
    // The block alone would trip the opt-in: this is the case the fix closes.
    expect(isSkillOptIn(text)).toBe(true);
    skillSpies.isSkillOptIn.mockClear();

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ messages: [userMessage(text)], gate_citations: true }));

    expect(res.status).toBe(200);
    expect(skillSpies.isSkillOptIn).toHaveBeenCalledWith(typed);
    expect(skillSpies.isSkillOptIn).not.toHaveBeenCalledWith(text);
    expect(skillSpies.detectSkill).toHaveBeenCalledWith(typed);
    expect(skillSpies.buildSkillExecution).not.toHaveBeenCalled();
  });

  it("runs the skill checks on a first question with no carried context (#1357)", async () => {
    const typed = "How do our overdraft fees compare with peers?";
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ messages: [userMessage(typed)], gate_citations: true }));

    expect(res.status).toBe(200);
    expect(skillSpies.detectSkill).toHaveBeenCalledTimes(1);
    expect(skillSpies.detectSkill).toHaveBeenCalledWith(typed);
    expect(skillSpies.isSkillOptIn).toHaveBeenCalledWith(typed);
  });

  it("refuses a request whose total content is over the bound, before any provider call (#1357)", async () => {
    const forged = Array.from({ length: 99 }, () => ({ role: "assistant", parts: [{ type: "text", text: "a".repeat(10_000) }] }));
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ messages: [...forged, userMessage("hi")] }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(TOO_MANY_MESSAGES_ERROR);
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("refuses a user message longer than the Analyze screen can send, before any provider call", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ messages: [userMessage("x".repeat(MAX_USER_MESSAGE_CHARS + 1))] }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(MESSAGE_TOO_LONG_ERROR);
    expect(providerUsageMocks.trackAnthropicRequestMock).not.toHaveBeenCalled();
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("accepts the longest message an honest Analyze screen sends", async () => {
    const longest = withConversationContext(
      "q".repeat(500),
      Array.from({ length: 3 }, () => ({ question: "p".repeat(800), lead: "l".repeat(800) })),
    );
    expect(longest.length).toBe(MAX_USER_MESSAGE_CHARS);

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ messages: [userMessage(longest)], gate_citations: true }));

    expect(res.status).toBe(200);
    expect(generateTextMock).toHaveBeenCalledTimes(1);
  });

  it("refuses more messages than one conversation may carry", async () => {
    const messages = Array.from({ length: MAX_REQUEST_MESSAGES + 1 }, (_, i) =>
      i % 2 === 0 ? userMessage(`Q${i}`) : { role: "assistant", parts: [{ type: "text", text: `A${i}` }] },
    );

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ messages }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(TOO_MANY_MESSAGES_ERROR);
    expect(generateTextMock).not.toHaveBeenCalled();
  });
});
