import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock is hoisted — factories must be inline with no references to outer vars

vi.mock("@/lib/data-store", () => ({
  getPublicStats: vi.fn().mockResolvedValue({
    total_observations: 125000,
    total_institutions: 4200,
    total_states: 51,
    total_categories: 49,
  }),
}));

vi.mock("@/lib/data-store/connection", () => ({
  sql: vi.fn().mockImplementation(() => Promise.resolve([])),
}));

// Mock fee-taxonomy to break transitive import chain through data-store barrel
vi.mock("@/lib/fee-taxonomy", () => ({
  getDisplayName: vi.fn((s: string) => s),
  getFeeFamily: vi.fn(() => "account"),
  getFeeTier: vi.fn(() => "core"),
  isFeaturedFee: vi.fn(() => true),
  getFeaturedCategories: vi.fn(() => []),
  getSpotlightCategories: vi.fn(() => []),
  FEE_FAMILIES: [],
  TAXONOMY_COUNT: 49,
  FEATURED_COUNT: 15,
}));

vi.mock("./tools", () => ({
  publicTools: {
    searchFees: { description: "searchFees", inputSchema: {}, execute: vi.fn() },
    searchIndex: { description: "searchIndex", inputSchema: {}, execute: vi.fn() },
    searchInstitutions: { description: "searchInstitutions", inputSchema: {}, execute: vi.fn() },
    getInstitution: { description: "getInstitution", inputSchema: {}, execute: vi.fn() },
  },
}));

vi.mock("./tools-internal", () => ({
  internalTools: {
    queryDistrictData: { description: "queryDistrictData", inputSchema: {}, execute: vi.fn() },
    queryStateData: { description: "queryStateData", inputSchema: {}, execute: vi.fn() },
    queryFeeRevenueCorrelation: { description: "queryFeeRevenueCorrelation", inputSchema: {}, execute: vi.fn() },
    queryOutliers: { description: "queryOutliers", inputSchema: {}, execute: vi.fn() },
    getCollectionStatus: { description: "getCollectionStatus", inputSchema: {}, execute: vi.fn() },
    getReviewQueueStats: { description: "getReviewQueueStats", inputSchema: {}, execute: vi.fn() },
    searchInstitutionsByName: { description: "searchInstitutionsByName", inputSchema: {}, execute: vi.fn() },
    rankInstitutions: { description: "rankInstitutions", inputSchema: {}, execute: vi.fn() },
    queryJobStatus: { description: "queryJobStatus", inputSchema: {}, execute: vi.fn() },
    queryDataQuality: { description: "queryDataQuality", inputSchema: {}, execute: vi.fn() },
    triggerPipelineJob: { description: "triggerPipelineJob", inputSchema: {}, execute: vi.fn() },
    queryNationalData: { description: "queryNationalData", inputSchema: {}, execute: vi.fn() },
    queryRegulatoryRisk: { description: "queryRegulatoryRisk", inputSchema: {}, execute: vi.fn() },
  },
}));

// Import after mocks
import { getHamilton } from "./agents";

describe("getHamilton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.BFI_MODEL_CONSUMER;
    delete process.env.BFI_MODEL_PRO;
    delete process.env.BFI_MODEL_ADMIN;
  });

  it("consumer: returns Haiku model and public tools only with maxSteps=3", async () => {
    const config = await getHamilton("consumer");

    expect(config.model).toBe("claude-haiku-4-5-20251001");
    expect(config.maxSteps).toBe(3);
    expect(config.maxTokens).toBe(2048);
    expect(config.requiresAuth).toBe(false);
    expect(config.requiredRole).toBeNull();

    const toolNames = Object.keys(config.tools);
    expect(toolNames).toContain("searchFees");
    expect(toolNames).toContain("searchIndex");
    expect(toolNames).toContain("searchInstitutions");
    expect(toolNames).toContain("getInstitution");

    // Should NOT have internal/ops tools
    expect(toolNames).not.toContain("triggerPipelineJob");
    expect(toolNames).not.toContain("getCollectionStatus");
    expect(toolNames).not.toContain("queryNationalData");
  });

  it("pro: returns the Hamilton model, public + non-ops internal tools, maxSteps=4", async () => {
    const config = await getHamilton("pro");

    expect(config.model).toBe("claude-opus-5-5");
    expect(config.maxSteps).toBe(4);
    expect(config.maxTokens).toBe(16000);
    expect(config.requiresAuth).toBe(true);
    expect(config.requiredRole).toBe("premium");

    const toolNames = Object.keys(config.tools);

    // Has public tools
    expect(toolNames).toContain("searchFees");
    // Has consolidated internal tools
    expect(toolNames).toContain("queryNationalData");
    expect(toolNames).toContain("searchInstitutionsByName");
    expect(toolNames).toContain("rankInstitutions");
  });

  it("admin: returns the Hamilton model, all tools, maxSteps=4", async () => {
    const config = await getHamilton("admin");

    expect(config.model).toBe("claude-opus-5-5");
    expect(config.maxSteps).toBe(4);
    expect(config.maxTokens).toBe(16000);
    expect(config.requiresAuth).toBe(true);
    expect(config.requiredRole).toBe("admin");

    const toolNames = Object.keys(config.tools);

    // Has all tools including ops
    // Same consolidated tools as pro (Hamilton is single agent)
    expect(toolNames).toContain("queryNationalData");
    expect(toolNames).toContain("searchFees");
    expect(toolNames).toContain("searchInstitutionsByName");
    expect(toolNames).toContain("rankInstitutions");
    expect(toolNames).toContain("getCollectionStatus");
    expect(toolNames).toContain("getReviewQueueStats");
    expect(toolNames).toContain("queryJobStatus");
  });

  it("consumer: systemPrompt contains HAMILTON_SYSTEM_PROMPT base text", async () => {
    const config = await getHamilton("consumer");
    expect(config.systemPrompt).toContain("You are Hamilton, the pricing advisor");
  });

  it("consumer: systemPrompt starts with consumer-role prefix (plain-language framing)", async () => {
    const config = await getHamilton("consumer");
    const hamiltonIdx = config.systemPrompt.indexOf("You are Hamilton, the pricing advisor");
    expect(hamiltonIdx).toBeGreaterThan(0);

    const prefix = config.systemPrompt.slice(0, hamiltonIdx);
    expect(prefix.toLowerCase()).toMatch(/consumer|general public|plain language|plain-language|explain/);
  });

  it("admin: systemPrompt starts with admin-role prefix containing operational/data quality language", async () => {
    const config = await getHamilton("admin");
    const hamiltonIdx = config.systemPrompt.indexOf("You are Hamilton, the pricing advisor");
    expect(hamiltonIdx).toBeGreaterThan(0);

    const prefix = config.systemPrompt.slice(0, hamiltonIdx);
    expect(prefix.toLowerCase()).toMatch(/operational|data quality|pipeline|review queue|analyst|administrator/);
  });

  it("old functions do not exist: getAgent, getPublicAgents, getAdminAgents, buildAgents", async () => {
    const mod = await import("./agents");
    expect((mod as Record<string, unknown>).getAgent).toBeUndefined();
    expect((mod as Record<string, unknown>).getPublicAgents).toBeUndefined();
    expect((mod as Record<string, unknown>).getAdminAgents).toBeUndefined();
    expect((mod as Record<string, unknown>).buildAgents).toBeUndefined();
  });

  it("BFI_MODEL_CONSUMER env var overrides consumer model", async () => {
    process.env.BFI_MODEL_CONSUMER = "claude-opus-4-5-20250514";
    const config = await getHamilton("consumer");
    expect(config.model).toBe("claude-opus-4-5-20250514");
  });
  it("pro and admin prompts require stating the evidence and never hide gaps", async () => {
    const pro = await getHamilton("pro");
    const admin = await getHamilton("admin");
    for (const agent of [pro, admin]) {
      expect(agent.systemPrompt).not.toMatch(/Never reference missing data|Never say "no data"/);
      expect(agent.systemPrompt).toMatch(/insufficient/);
    }
  });
  it("HAMILTON_MODEL overrides the Pro and admin model", async () => {
    process.env.HAMILTON_MODEL = "claude-sonnet-5-5";
    try {
      expect((await getHamilton("pro")).model).toBe("claude-sonnet-5-5");
    } finally {
      delete process.env.HAMILTON_MODEL;
    }
  });
});
