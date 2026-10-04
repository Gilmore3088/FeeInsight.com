import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all data-store modules before importing the tool
vi.mock("@/lib/data-store/call-reports", () => ({
  getRevenueTrend: vi.fn().mockResolvedValue({ quarters: [], latest: null }),
  getTopRevenueInstitutions: vi.fn().mockResolvedValue([]),
  getRevenueByTier: vi.fn().mockResolvedValue([]),
  getDistrictFeeRevenue: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/data-store/fed", () => ({
  getNationalEconomicSummary: vi.fn().mockResolvedValue({}),
  getBeigeBookThemes: vi.fn().mockResolvedValue([]),
  getFredSummary: vi.fn().mockResolvedValue({}),
  getDistrictEconomicSummary: vi.fn().mockResolvedValue({}),
  getLatestBeigeBook: vi.fn().mockResolvedValue([]),
  getDistrictContent: vi.fn().mockResolvedValue([]),
  getRecentSpeeches: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/data-store/health", () => ({
  getIndustryHealthMetrics: vi.fn().mockResolvedValue({}),
  getHealthMetricsByCharter: vi.fn().mockResolvedValue({}),
  getDepositGrowthTrend: vi.fn().mockResolvedValue([]),
  getLoanGrowthTrend: vi.fn().mockResolvedValue([]),
  getInstitutionCountTrends: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/data-store/complaints", () => ({
  getDistrictComplaintSummary: vi.fn().mockResolvedValue({}),
  getNationalComplaintSummary: vi.fn().mockResolvedValue({ total_complaints: 0, fee_related_pct: 0, average_per_institution: 0 }),
}));

vi.mock("@/lib/data-store/financial", () => ({
  getStateDemographics: vi.fn().mockResolvedValue({}),
  getLatestIndicators: vi.fn().mockResolvedValue([]),
  getSodMarketShare: vi.fn().mockResolvedValue([]),
  getNyFedData: vi.fn().mockResolvedValue([]),
  getOfrData: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/data-store/fee-index", () => ({
  getNationalIndex: vi.fn().mockResolvedValue([]),
  getPeerIndex: vi.fn().mockResolvedValue([]),
  getIndexSnapshot: vi.fn().mockResolvedValue([]),
  getContractFeeRows: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/data-store/derived-analytics", () => ({
  getRevenueConcentration: vi.fn().mockResolvedValue({ dollar_volume: [], institution_prevalence: [], summary: {} }),
  getFeeDependencyTrend: vi.fn().mockResolvedValue({ trend: [], signals: {} }),
  getRevenuePerInstitutionTrend: vi.fn().mockResolvedValue({ current: {}, trend: [], signals: {} }),
}));

// Mock other deps used by tools-internal.ts
vi.mock("@/lib/data-store/geographic", () => ({
  getDistrictStats: vi.fn().mockResolvedValue({}),
  getStateStats: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/lib/data-store/fee-revenue", () => ({
  getFeeRevenueData: vi.fn().mockResolvedValue([]),
  getTierFeeRevenueSummary: vi.fn().mockResolvedValue([]),
  getCharterFeeRevenueSummary: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/data-store/core", () => ({
  getOutlierFlaggedFees: vi.fn().mockResolvedValue({ total: 0, fees: [] }),
  getReviewStats: vi.fn().mockResolvedValue({}),
  getStats: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/lib/data-store/dashboard", () => ({
  getCollectionHealth: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/lib/data-store/intelligence", () => ({
  searchExternalIntelligence: vi.fn().mockResolvedValue([]),
  listIntelligence: vi.fn().mockResolvedValue({ items: [], total: 0 }),
}));

vi.mock("@/lib/data-store/connection", () => ({
  sql: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/agents/run-store", () => ({
  startAgentRun: vi.fn().mockResolvedValue({ run: { id: 1 }, reused: false, steps: [] }),
}));

import { internalTools } from "./tools-internal";

// Import mocked modules so we can check calls
import * as callReports from "@/lib/data-store/call-reports";
import * as fed from "@/lib/data-store/fed";
import * as health from "@/lib/data-store/health";
import * as complaints from "@/lib/data-store/complaints";
import * as feeIndex from "@/lib/data-store/fee-index";
import * as derivedAnalytics from "@/lib/data-store/derived-analytics";
import * as intelligence from "@/lib/data-store/intelligence";

describe("queryNationalData", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const execute = internalTools.queryNationalData.execute as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Registration ────────────────────────────────────────────────────────
  it("is registered in internalTools", () => {
    expect(internalTools.queryNationalData).toBeDefined();
  });

  // ── call_reports source ─────────────────────────────────────────────────
  describe("source: call_reports", () => {
    it("returns all data when no view specified", async () => {
      const result = await execute({ source: "call_reports", quarters: 8, limit: 10, top_n: 5 });
      expect(callReports.getRevenueTrend).toHaveBeenCalledWith(8);
      expect(callReports.getTopRevenueInstitutions).toHaveBeenCalledWith(10);
      expect(callReports.getRevenueByTier).toHaveBeenCalled();
      expect(result).toHaveProperty("trend");
      expect(result).toHaveProperty("top_institutions");
      expect(result).toHaveProperty("by_tier");
    });

    it("returns only trend when view=trend", async () => {
      const result = await execute({ source: "call_reports", view: "trend", quarters: 4, limit: 10, top_n: 5 });
      expect(callReports.getRevenueTrend).toHaveBeenCalledWith(4);
      expect(callReports.getTopRevenueInstitutions).not.toHaveBeenCalled();
      expect(result).toHaveProperty("trend");
    });

    it("returns top institutions when view=top_institutions", async () => {
      const result = await execute({ source: "call_reports", view: "top_institutions", limit: 5, quarters: 8, top_n: 5 });
      expect(callReports.getTopRevenueInstitutions).toHaveBeenCalledWith(5);
      expect(result).toHaveProperty("top_institutions");
    });

    it("returns tier data when view=by_tier", async () => {
      const result = await execute({ source: "call_reports", view: "by_tier", quarters: 8, limit: 10, top_n: 5 });
      expect(callReports.getRevenueByTier).toHaveBeenCalled();
      expect(result).toHaveProperty("by_tier");
    });

    it("returns district data when view=by_district with district param", async () => {
      const result = await execute({ source: "call_reports", view: "by_district", district: 3, quarters: 8, limit: 10, top_n: 5 });
      expect(callReports.getDistrictFeeRevenue).toHaveBeenCalledWith(3);
      expect(result).toHaveProperty("district_revenue");
    });
  });

  // ── economic source ─────────────────────────────────────────────────────
  describe("source: economic", () => {
    it("returns all economic data when no view specified", async () => {
      const result = await execute({ source: "economic", quarters: 8, limit: 10, top_n: 5 });
      expect(fed.getNationalEconomicSummary).toHaveBeenCalled();
      expect(fed.getBeigeBookThemes).toHaveBeenCalled();
      expect(fed.getFredSummary).toHaveBeenCalled();
      expect(result).toHaveProperty("national_summary");
      expect(result).toHaveProperty("beige_book_themes");
      expect(result).toHaveProperty("fred_summary");
    });

    it("returns only fred when view=fred", async () => {
      const result = await execute({ source: "economic", view: "fred", quarters: 8, limit: 10, top_n: 5 });
      expect(fed.getFredSummary).toHaveBeenCalled();
      expect(fed.getNationalEconomicSummary).not.toHaveBeenCalled();
      expect(result).toHaveProperty("fred_summary");
    });

    it("returns only beige book when view=beige_book", async () => {
      const result = await execute({ source: "economic", view: "beige_book", quarters: 8, limit: 10, top_n: 5 });
      expect(fed.getBeigeBookThemes).toHaveBeenCalled();
      expect(result).toHaveProperty("beige_book_themes");
    });

    it("returns district summary when view=district with district param", async () => {
      const result = await execute({ source: "economic", view: "district", district: 7, quarters: 8, limit: 10, top_n: 5 });
      expect(fed.getDistrictEconomicSummary).toHaveBeenCalledWith(7);
      expect(result).toHaveProperty("district_summary");
    });

    it("returns error when view=district without district param", async () => {
      const result = await execute({ source: "economic", view: "district", quarters: 8, limit: 10, top_n: 5 });
      expect(result).toHaveProperty("error");
      expect((result as { error: string }).error).toContain("district");
    });
  });

  // ── health source ───────────────────────────────────────────────────────
  describe("source: health", () => {
    it("returns all health data when no view specified", async () => {
      const result = await execute({ source: "health", quarters: 8, limit: 10, top_n: 5 });
      expect(health.getIndustryHealthMetrics).toHaveBeenCalled();
      expect(health.getHealthMetricsByCharter).toHaveBeenCalled();
      expect(health.getDepositGrowthTrend).toHaveBeenCalled();
      expect(health.getLoanGrowthTrend).toHaveBeenCalled();
      expect(health.getInstitutionCountTrends).toHaveBeenCalled();
      expect(result).toHaveProperty("metrics");
      expect(result).toHaveProperty("by_charter");
    });

    it("returns only metrics when view=metrics", async () => {
      const result = await execute({ source: "health", view: "metrics", quarters: 8, limit: 10, top_n: 5 });
      expect(health.getIndustryHealthMetrics).toHaveBeenCalled();
      expect(health.getHealthMetricsByCharter).not.toHaveBeenCalled();
      expect(result).toHaveProperty("metrics");
    });

    it("returns deposit trend when view=deposits", async () => {
      const result = await execute({ source: "health", view: "deposits", quarters: 6, limit: 10, top_n: 5 });
      expect(health.getDepositGrowthTrend).toHaveBeenCalledWith(6);
      expect(result).toHaveProperty("deposits");
    });
  });

  // ── complaints source ───────────────────────────────────────────────────
  describe("source: complaints", () => {
    it("returns district complaint summary when district provided", async () => {
      const result = await execute({ source: "complaints", district: 5, quarters: 8, limit: 10, top_n: 5 });
      expect(complaints.getDistrictComplaintSummary).toHaveBeenCalledWith(5);
      expect(result).toHaveProperty("complaints");
    });

    it("returns error when district not provided", async () => {
      const result = await execute({ source: "complaints", quarters: 8, limit: 10, top_n: 5 });
      expect(result).toHaveProperty("error");
      expect((result as { error: string }).error).toContain("district");
    });
  });

  // ── fee_index source ────────────────────────────────────────────────────
  describe("source: fee_index", () => {
    it("returns national index snapshot by default", async () => {
      const result = await execute({ source: "fee_index", limit: 15, quarters: 8, top_n: 5 });
      expect(feeIndex.getIndexSnapshot).toHaveBeenCalledWith(undefined, 15);
      expect(result).toHaveProperty("index");
    });

    it("returns peer index when charter provided", async () => {
      const result = await execute({ source: "fee_index", charter: "bank", quarters: 8, limit: 10, top_n: 5 });
      expect(feeIndex.getPeerIndex).toHaveBeenCalledWith(
        expect.objectContaining({ charter_type: "bank" }),
      );
      expect(result).toHaveProperty("index");
    });

    it("returns peer index when tiers provided", async () => {
      const result = await execute({ source: "fee_index", tiers: ["community"], quarters: 8, limit: 10, top_n: 5 });
      expect(feeIndex.getPeerIndex).toHaveBeenCalledWith(
        expect.objectContaining({ asset_tiers: ["community"] }),
      );
      expect(result).toHaveProperty("index");
    });
  });

  // ── derived source ──────────────────────────────────────────────────────
  describe("source: derived", () => {
    it("returns all derived analytics when no view specified", async () => {
      const result = await execute({ source: "derived", quarters: 8, limit: 10, top_n: 5 });
      expect(derivedAnalytics.getRevenueConcentration).toHaveBeenCalledWith(5);
      expect(derivedAnalytics.getFeeDependencyTrend).toHaveBeenCalledWith(8);
      expect(derivedAnalytics.getRevenuePerInstitutionTrend).toHaveBeenCalledWith(8);
      expect(result).toHaveProperty("concentration");
      expect(result).toHaveProperty("dependency");
      expect(result).toHaveProperty("revenue_per_institution");
    });

    it("returns only concentration when view=concentration", async () => {
      const result = await execute({ source: "derived", view: "concentration", top_n: 3, quarters: 8, limit: 10 });
      expect(derivedAnalytics.getRevenueConcentration).toHaveBeenCalledWith(3);
      expect(derivedAnalytics.getFeeDependencyTrend).not.toHaveBeenCalled();
      expect(result).toHaveProperty("concentration");
    });

    it("returns only dependency when view=dependency", async () => {
      const result = await execute({ source: "derived", view: "dependency", quarters: 6, limit: 10, top_n: 5 });
      expect(derivedAnalytics.getFeeDependencyTrend).toHaveBeenCalledWith(6);
      expect(result).toHaveProperty("dependency");
    });

    it("returns only per-institution when view=revenue_per_institution", async () => {
      const result = await execute({ source: "derived", view: "revenue_per_institution", quarters: 4, limit: 10, top_n: 5 });
      expect(derivedAnalytics.getRevenuePerInstitutionTrend).toHaveBeenCalledWith(4);
      expect(result).toHaveProperty("revenue_per_institution");
    });
  });

  // ── external source ─────────────────────────────────────────────────
  describe("source: external", () => {
    it("returns search results with citation when query provided", async () => {
      vi.mocked(intelligence.searchExternalIntelligence).mockResolvedValueOnce([
        {
          id: 1,
          source_name: "CFPB Overdraft Study",
          source_date: "2025-12-01",
          category: "research",
          tags: ["overdraft", "cfpb"],
          content_text: "Banks collected $7.7 billion in overdraft fees in 2024, down from $12.6 billion in 2019.",
          source_url: "https://cfpb.gov/overdraft-2025",
          created_at: "2026-01-15T10:00:00Z",
          created_by: "admin",
          headline: "Banks collected <b>$7.7 billion</b> in overdraft fees",
          rank: 0.85,
        },
      ]);

      const result = await execute({ source: "external", query: "overdraft", quarters: 8, limit: 10, top_n: 5 });
      expect(intelligence.searchExternalIntelligence).toHaveBeenCalledWith("overdraft", undefined);
      expect(result).toHaveProperty("query", "overdraft");
      expect(result).toHaveProperty("total", 1);

      const results = (result as { results: Array<{ citation: string; source_name: string; headline: string }> }).results;
      expect(results[0].source_name).toBe("CFPB Overdraft Study");
      expect(results[0].headline).toContain("$7.7 billion");
      expect(results[0].citation).toBe("[Source: CFPB Overdraft Study, 2025-12-01]");
    });

    it("passes category filter when view param provided", async () => {
      vi.mocked(intelligence.searchExternalIntelligence).mockResolvedValueOnce([]);

      await execute({ source: "external", query: "fees", view: "regulation", quarters: 8, limit: 10, top_n: 5 });
      expect(intelligence.searchExternalIntelligence).toHaveBeenCalledWith("fees", { category: "regulation" });
    });

    it("returns recent list when no query provided", async () => {
      vi.mocked(intelligence.listIntelligence).mockResolvedValueOnce({
        items: [
          {
            id: 2,
            source_name: "ABA Fee Survey 2025",
            source_date: "2025-11-15",
            category: "survey",
            tags: ["aba", "survey"],
            content_text: "The American Bankers Association annual fee survey found median overdraft fees declined to $29.",
            source_url: null,
            created_at: "2026-01-20T12:00:00Z",
            created_by: null,
          },
        ],
        total: 1,
      });

      const result = await execute({ source: "external", quarters: 8, limit: 15, top_n: 5 });
      expect(intelligence.listIntelligence).toHaveBeenCalledWith(15, 0);
      expect(result).toHaveProperty("total", 1);

      const items = (result as { items: Array<{ citation: string; source_name: string }> }).items;
      expect(items[0].source_name).toBe("ABA Fee Survey 2025");
      expect(items[0].citation).toBe("[Source: ABA Fee Survey 2025, 2025-11-15]");
    });

    it("returns empty results for no-match search", async () => {
      vi.mocked(intelligence.searchExternalIntelligence).mockResolvedValueOnce([]);

      const result = await execute({ source: "external", query: "zzznomatch", quarters: 8, limit: 10, top_n: 5 });
      expect(result).toHaveProperty("total", 0);
      expect((result as { results: unknown[] }).results).toHaveLength(0);
    });
  });

  // ── Error handling ──────────────────────────────────────────────────────
  describe("error handling", () => {
    it("returns error for unknown source", async () => {
      // Type cast to bypass type checking for test
      const result = await execute({
        source: "invalid" as "call_reports",
        quarters: 8,
        limit: 10,
        top_n: 5,
      });
      expect(result).toHaveProperty("error");
      expect((result as { error: string }).error).toContain("Unknown source");
    });
  });
});

describe("rankInstitutions and queryRegulatoryRisk follow the statistics contract", () => {
  const row = (institution_id: number, amount: number, fee_category = "nsf") => ({
    institution_id, fee_category, amount, institution_name: `Bank ${institution_id}`,
    state_code: "GA", charter_type: "bank", asset_size_tier: "community",
  });

  beforeEach(() => vi.clearAllMocks());

  it("ranks by each institution's median, counting a bank with many variants once", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const execute = internalTools.rankInstitutions.execute as any;
    vi.mocked(feeIndex.getContractFeeRows).mockResolvedValueOnce([
      row(1, 10), row(2, 20), row(3, 30), row(4, 40),
      // Bank 5 lists four variants; its median (60) is one value, not four votes.
      row(5, 50), row(5, 55), row(5, 65), row(5, 70),
    ] as never);

    const result = await execute({ metric: "above_p75", limit: 10 }, {});

    expect(result.results[0]).toMatchObject({ institution: "Bank 5", matching_fees: 1, total_fees: 1 });
    expect(result.results.find((r: { institution: string }) => r.institution === "Bank 1")?.matching_fees).toBe(0);
  });

  it("finds no outliers in a category with fewer than five institutions", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const execute = internalTools.queryRegulatoryRisk.execute as any;
    vi.mocked(feeIndex.getContractFeeRows).mockResolvedValueOnce([row(1, 10), row(2, 90)] as never);

    const result = await execute({ categories: ["nsf"], limit: 5 }, {});

    expect(JSON.stringify(result)).toContain('"outlier_institution_count":0');
  });
});
