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

vi.mock("./tool-local-competitors", () => ({
  getLocalCompetitors: { description: "getLocalCompetitors", inputSchema: {}, execute: vi.fn() },
}));

vi.mock("./tool-query-data", () => ({
  listData: { description: "listData", inputSchema: {}, execute: vi.fn() },
  queryData: { description: "queryData", inputSchema: {}, execute: vi.fn() },
  warmDataCatalog: vi.fn(),
  DATA_CATALOG_INSTRUCTION: "PUBLIC DATA: call listData, then queryData.",
}));

// Import after mocks
import { buildMonitorModeSuffix, buildSavedPeerSetPrompt, getHamilton, savedPeerSetUsed } from "./agents";
import { getPublicStats } from "@/lib/data-store";

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

  it("pro: the written answer can read local competitors, fee income against peers, district and state data (#1084)", async () => {
    const config = await getHamilton("pro");
    const toolNames = Object.keys(config.tools);
    for (const name of ["getLocalCompetitors", "queryFeeRevenueCorrelation", "queryDistrictData", "queryStateData"]) {
      expect(toolNames).toContain(name);
    }
    // Still no write or ops tools.
    expect(toolNames).not.toContain("triggerPipelineJob");
    expect(toolNames).not.toContain("queryJobStatus");
    expect(config.systemPrompt).toContain("getLocalCompetitors(institution_id)");
    expect(config.systemPrompt).toContain("queryFeeRevenueCorrelation(view='peers'");
  });

  it("quarter-comparison prompts use the dated financial ranking and preserve raw YTD limits", async () => {
    for (const role of ["pro", "admin"] as const) {
      const config = await getHamilton(role);
      expect(config.systemPrompt).toContain("first call getInstitution(id)");
      expect(config.systemPrompt).toContain("Raw NCUA queryData income is YTD even when period selects Q2");
      expect(config.systemPrompt).toContain("matched per-institution differences before aggregation");
      expect(config.systemPrompt).toContain("never the only true group");
      expect(config.systemPrompt).toContain("Do not print internal account/item codes");
      expect(config.systemPrompt).toContain("validated calculation ledger supplies that cohort-specific ratio");
    }
  });

  it("all Hamilton audiences preserve the financial measure boundary while allowing same-fee price comparisons", async () => {
    for (const role of ["consumer", "pro", "admin"] as const) {
      const config = await getHamilton(role);
      expect(config.systemPrompt).toContain("bank deposit-account service charges (FDIC) and broad credit-union fee income (NCUA) are different measures");
      expect(config.systemPrompt).toContain("Never pool them into a financial median, ranking, revenue share or trend");
      expect(config.systemPrompt).toContain("Published prices for the same fee category may still be compared across charters");
    }
  });

  it("pro and admin answers can read the data catalog; the consumer answer cannot", async () => {
    for (const role of ["pro", "admin"] as const) {
      const config = await getHamilton(role);
      expect(Object.keys(config.tools)).toEqual(expect.arrayContaining(["listData", "queryData"]));
      expect(config.systemPrompt).toContain("PUBLIC DATA: call listData, then queryData.");
    }
    const consumer = await getHamilton("consumer");
    expect(Object.keys(consumer.tools)).not.toContain("queryData");
  });

  it("pro: a question the data cannot answer is said so first, never swapped for another question (#1077)", async () => {
    const config = await getHamilton("pro");
    expect(config.systemPrompt).toContain("the first sentence says plainly which part the data cannot answer, and it takes the headline's place");
    expect(config.systemPrompt).toContain("Never answer a different question in its place, and never pick a fee the reader did not ask about.");
  });

  it("buildSavedPeerSetPrompt passes the reader's saved peer set to the peer tools", () => {
    const prompt = buildSavedPeerSetPrompt({
      id: 9,
      label: "Our \"lake\"\nbanks",
      filters: { institutionIds: [11, 12], charter_type: "bank", states: ["MN"], asset_tiers: ["community_small"], fed_districts: [9] },
    });
    expect(prompt).toContain("id 9");
    expect(prompt).toContain("Our lake banks");
    expect(prompt).not.toContain("\nbanks");
    expect(prompt).toContain("peer_institution_ids: [11, 12]");
    expect(prompt).toContain('states: ["MN"]');
    expect(prompt).toContain('charter_type: "bank"');
    expect(prompt).toContain('asset_tiers: ["community_small"]');
    expect(prompt).toContain("fed_districts: [9]");
    expect(buildSavedPeerSetPrompt(null)).toContain("SAVED PEER SET: none");
  });

  it("savedPeerSetUsed: only a peers-view call with exactly the saved set's filters uses it", () => {
    const set = { filters: { states: ["MN", "WI"], charter_type: "bank", asset_tiers: ["community_small"] } };
    const call = (toolName: string, input: unknown) => [{ toolCalls: [{ toolName, input }] }];
    const matching = { view: "peers", institution_id: 1, states: ["wi", "MN"], charter_type: "bank", asset_tiers: ["community_small"] };
    expect(savedPeerSetUsed(set, call("queryFeeRevenueCorrelation", matching))).toBe(true);
    expect(savedPeerSetUsed(set, call("queryFeeRevenueCorrelation", { ...matching, view: "by_tier" }))).toBe(false);
    expect(savedPeerSetUsed(set, call("queryFeeRevenueCorrelation", { ...matching, states: ["TX"] }))).toBe(false);
    expect(savedPeerSetUsed(set, call("queryFeeRevenueCorrelation", { ...matching, fed_districts: [9] }))).toBe(false);
    expect(savedPeerSetUsed(set, call("queryStateData", { stateCode: "MN" }))).toBe(false);
    expect(savedPeerSetUsed(set, [])).toBe(false);
    expect(savedPeerSetUsed(set, undefined)).toBe(false);
    expect(savedPeerSetUsed({ filters: { institutionIds: [12, 11] } }, call("queryFeeRevenueCorrelation", { view: "peers", institution_id: 1, peer_institution_ids: [11, 12] }))).toBe(true);
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

describe("Hamilton global coverage availability (#2373)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mocked(getPublicStats).mockReset();
  });

  it("treats a failed optional count as unknown, retains capabilities, and retries instead of caching a zero", async () => {
    vi.mocked(getPublicStats).mockRejectedValueOnce(new Error("statement timeout")).mockResolvedValue({ total_observations: 125000, total_institutions: 4200, total_states: 51, total_categories: 49 });
    const fresh = await import("./agents");
    const unavailable = await fresh.getHamilton("pro");
    expect(getPublicStats).toHaveBeenCalledWith({ strict: true });
    expect(unavailable.systemPrompt).toContain("Global published-fee coverage counts are unavailable; do not infer zero");
    expect(unavailable.systemPrompt).not.toContain("0+ fee observations");
    expect(unavailable.systemPrompt).toContain("FDIC Call Reports (revenue trends)");
    expect(unavailable.tools.getInstitution).toBeDefined();
    const recovered = await fresh.getHamilton("pro");
    expect(recovered.systemPrompt).toContain("125,000+ fee observations");
    expect(recovered.systemPrompt).not.toContain("Global published-fee coverage counts are unavailable");
    await fresh.getHamilton("pro");
    expect(getPublicStats).toHaveBeenCalledTimes(2);
  });

  it("caches a successful measured zero and does not label it unavailable", async () => {
    vi.mocked(getPublicStats).mockResolvedValue({ total_observations: 0, total_institutions: 0, total_states: 0, total_categories: 0 });
    const fresh = await import("./agents");
    for (const role of ["pro", "admin"] as const) {
      const config = await fresh.getHamilton(role);
      expect(config.systemPrompt).toContain("0+ fee observations across 0 categories from 0+ institutions");
      expect(config.systemPrompt).not.toContain("Global published-fee coverage counts are unavailable");
    }
    expect(getPublicStats).toHaveBeenCalledTimes(1);
  });
});

describe("buildMonitorModeSuffix (#1256)", () => {
  it("asks for something to check next and bans pricing advice", () => {
    const suffix = buildMonitorModeSuffix();
    expect(suffix).toContain("one specific thing to check next");
    expect(suffix).toContain("Never tell the user to raise, lower or drop a fee");
    expect(suffix).toContain("The pricing decision is the user's");
    expect(suffix).not.toContain("next step");
    expect(suffix).not.toContain("action is needed");
  });
});
