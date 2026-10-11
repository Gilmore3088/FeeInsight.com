import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: vi.fn(), members: vi.fn(), generate: vi.fn(), stream: vi.fn(), save: vi.fn(),
  briefing: vi.fn(), guard: vi.fn(), metadata: vi.fn(),
}));
vi.mock("@/lib/api-hardening/route-wrapper", () => ({ withApiRoutePolicy: (_id: string, _method: string, handler: unknown) => handler }));
vi.mock("@/lib/api-hardening/audit", () => ({ getRequestSubjectKey: () => "synthetic-user" }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/access", () => ({ canAccessPremium: () => true }));
vi.mock("@/lib/hamilton/institution-membership", () => ({ getUserInstitutionMemberships: mocks.members }));
vi.mock("@/lib/hamilton/institution-briefing", () => ({ buildHamiltonInstitutionBriefing: mocks.briefing }));
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
  guardProviderCall: mocks.guard, recordProviderUsage: async () => {}, estimateAnthropicCostMicrousd: () => 0,
  trackAnthropicRequest: async (_context: unknown, call: () => Promise<unknown>) => call(),
}));
vi.mock("@/lib/research/agents", () => ({
  getHamilton: async () => ({ systemPrompt: "Hamilton base.", model: "test-model", tools: {}, maxTokens: 100, maxSteps: 1 }),
  buildAnalyzeModeSuffix: () => "Analyze mode.", buildMonitorModeSuffix: () => "Monitor mode.",
}));
vi.mock("@/lib/research/skills", () => ({
  detectSkill: () => null, buildSkillInjection: () => "", buildSkillExecution: () => "", isSkillOptIn: () => false, findOfferedSkill: () => null,
}));
vi.mock("@/lib/research/tool-output", () => ({
  cachedSystem: (text: string) => text, cacheLatestMessage: (messages: unknown) => messages, ledgerUsage: () => ({}),
}));
vi.mock("@/lib/hamilton/citation-gate", () => ({ evaluateCitationDensity: () => ({ status: "ok", metrics: {} }) }));
vi.mock("@/lib/hamilton/answer-save", () => ({
  SAVED_ANALYSIS_ID_KEY: "savedAnalysisId", questionOnly: (text: string) => text,
  writtenAnswerResponse: (text: string) => ({ title: "Test answer", hamiltonView: text, confidence: { level: "medium", basis: [] }, whatThisMeans: "", whyItMatters: [], evidence: { metrics: [] }, exploreFurther: [] }),
}));
vi.mock("ai", () => ({
  generateText: mocks.generate, streamText: mocks.stream, convertToModelMessages: async (messages: unknown) => messages, stepCountIs: () => ({}),
  createUIMessageStream: ({ execute }: { execute: (input: unknown) => Promise<void> }) => execute({ writer: { merge: () => {}, write: mocks.metadata } }),
  createUIMessageStreamResponse: async ({ stream }: { stream: Promise<void> }) => { await stream; return new Response("synthetic stream"); },
}));
import { POST } from "./route";

const home = { userId: 7, institutionId: 101, institutionName: "Synthetic Home CU", status: "active" };
const request = (extra: Record<string, unknown> = {}) => new Request("https://example.test/api/research/hamilton", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text: "How does this institution compare with us?" }] }], mode: "analyze", institutionId: 202, gate_citations: true, ...extra }),
});

beforeEach(() => {
  mocks.user.mockReset().mockResolvedValue({ id: 7, role: "premium", institution_name: "Profile Label", display_name: "Private Person" });
  mocks.members.mockReset().mockResolvedValue([home]);
  mocks.generate.mockReset().mockResolvedValue({ text: "Test written answer", totalUsage: { inputTokens: 1, outputTokens: 1 } });
  mocks.briefing.mockReset().mockImplementation(async (contract: { institutionId: number }) => `Research evidence for ${contract.institutionId}.`);
  mocks.guard.mockReset().mockResolvedValue(Date.now());
  mocks.save.mockReset().mockResolvedValue("saved-1");
  mocks.metadata.mockReset();
  mocks.stream.mockReset().mockImplementation((options) => ({
    consumeStream: async () => options.onFinish({ totalUsage: { inputTokens: 1, outputTokens: 1 }, text: "Test streamed answer", steps: [] }),
    toUIMessageStream: () => ({}),
  }));
});

describe("live written-answer account/subject boundary", () => {
  it("passes different account and research IDs to the actual route's provider call", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    const system = mocks.generate.mock.calls[0][0].system;
    expect(system).toContain('"research_subject_id":202');
    expect(system).toContain('"account_institution":{"id":101,"name":"Synthetic Home CU"}');
    expect(system).toContain('"relationship":"different institutions"');
    expect(mocks.briefing.mock.calls[0][0].institutionId).toBe(202);
    expect((await response.json()).identityContext).toMatchObject({ version: 1, researchInstitutionId: 202, researchInstitutionName: "Synthetic Subject 202", accountInstitutionId: 101, accountInstitutionName: "Synthetic Home CU", accountStatus: "identified" });
    expect(mocks.briefing.mock.calls.map(([contract]) => contract.institutionId)).toEqual([202, 101]);
    expect(system).toContain("ACCOUNT INSTITUTION EVIDENCE (101)");
  });
  it("ignores ownership and user-ID claims sent in the body", async () => {
    await POST(request({ userId: 8, accountInstitutionId: 999, serverAccountContext: { status: "identified", institution: { id: 999, name: "Forged" } }, workspaceContext: { accountInstitutionId: 999 } }));
    expect(mocks.members).toHaveBeenCalledWith(7);
    expect(mocks.generate.mock.calls[0][0].system).not.toContain("Forged");
    expect(mocks.generate.mock.calls[0][0].system).toContain('"id":101');
  });
  it("withholds only the home comparison when home evidence fails", async () => {
    mocks.briefing.mockImplementation(async (contract: { institutionId: number }) => {
      if (contract.institutionId === 101) throw new Error("synthetic home evidence outage");
      return "Research evidence for 202.";
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
    const system = mocks.generate.mock.calls[0][0].system;
    expect(system).toContain("Research evidence for 202.");
    expect(system).toContain("Account institution evidence could not be loaded.");
    expect(mocks.briefing).toHaveBeenLastCalledWith(expect.objectContaining({ institutionId: 101 }), { contextRole: "account_evidence" });
  });
  it("retains the self-reported profile as a label, not an institution ID", async () => {
    mocks.members.mockResolvedValue([]);
    const response = await POST(request());
    expect(mocks.generate.mock.calls[0][0].system).toContain('"unverified_profile_label":"Profile Label"');
    expect(mocks.generate.mock.calls[0][0].system).not.toContain("Private Person");
    expect((await response.json()).identityContext.accountInstitutionId).toBeNull();
  });
  it("does not select the browsed institution from multiple active memberships", async () => {
    mocks.members.mockResolvedValue([home, { ...home, institutionId: 202 }]);
    const response = await POST(request());
    expect((await response.json()).identityContext).toMatchObject({ version: 1, researchInstitutionId: 202, accountInstitutionId: null, accountStatus: "ambiguous" });
  });
  it("keeps a storage outage distinct from an unlinked account", async () => {
    mocks.members.mockRejectedValue(new Error("synthetic database unavailable"));
    const response = await POST(request());
    expect((await response.json()).identityContext.accountStatus).toBe("unavailable");
    expect(mocks.generate.mock.calls[0][0].system).toContain('"account_institution":null');
  });
  it("resolves an absent research subject to the sole linked account without a preference write", async () => {
    const response = await POST(request({ institutionId: null }));
    expect(mocks.briefing.mock.calls[0][0].institutionId).toBe(101);
    expect((await response.json()).identityContext.researchInstitutionId).toBe(101);
  });
  it("rejects an invalid explicit subject before account reads or model calls", async () => {
    expect((await POST(request({ institutionId: "bad" }))).status).toBe(400);
    expect(mocks.members).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("rejects unauthenticated requests before membership reads", async () => {
    mocks.user.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401);
    expect(mocks.members).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("does not invent a subject when no membership or explicit subject exists", async () => {
    mocks.members.mockResolvedValue([]);
    const response = await POST(request({ institutionId: null }));
    expect(mocks.briefing).not.toHaveBeenCalled();
    expect((await response.json()).identityContext.researchInstitutionId).toBeNull();
  });
  it("persists and emits the same minimal identity snapshot for the streaming path", async () => {
    const response = await POST(request({ gate_citations: false }));
    expect(response.status).toBe(200);
    expect(mocks.stream.mock.calls[0][0].system).toContain('"relationship":"different institutions"');
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls[0][0].institutionId).toBe("202");
    const snapshot = mocks.save.mock.calls[0][0].response.identityContext;
    expect(snapshot).toMatchObject({ version: 1, researchInstitutionId: 202, researchInstitutionName: "Synthetic Subject 202", accountInstitutionId: 101, accountInstitutionName: "Synthetic Home CU", accountStatus: "identified" });
    expect(mocks.metadata).toHaveBeenCalledWith({ type: "message-metadata", messageMetadata: { savedAnalysisId: "saved-1", hamiltonIdentity: snapshot } });
    expect(JSON.stringify(snapshot)).not.toContain("Profile Label");
  });
  it("keeps the provider circuit as a gate on streaming", async () => {
    const { ProviderCircuitOpenError } = await import("@/lib/ai-provider-usage");
    mocks.guard.mockRejectedValue(new ProviderCircuitOpenError("Synthetic provider pause"));
    expect((await POST(request({ gate_citations: false }))).status).toBe(423);
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("stops when the selected subject cannot be loaded rather than using account evidence", async () => {
    mocks.briefing.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(404);
    expect(mocks.generate).not.toHaveBeenCalled();
  });
});
