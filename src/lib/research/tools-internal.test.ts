import { describe, it, expect, vi, beforeEach } from "vitest";
import { writtenAnswerCheck } from "@/lib/hamilton/answer-save";

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

vi.mock("@/lib/data-store/fee-index", async () => {
  const { makeStamp } = await vi.importActual<typeof import("@/lib/dataset-stamp")>("@/lib/dataset-stamp");
  const stamp = makeStamp({
    dataset: "published_fee_catalog", mode: "live", readAt: "2026-10-18T14:10:00Z", runId: null, newestRecordAt: null,
    methodVersion: 3, counting: "counted_once", filters: [{ key: "sourced", label: "Only sourced fees" }],
  });
  const entry = (i: number) => ({ fee_category: `fee_${i}`, median_amount: 10 + i });
  return {
    getNationalIndex: vi.fn().mockResolvedValue([]),
    getPeerIndex: vi.fn().mockResolvedValue([]),
    getNationalIndexStamped: vi.fn().mockResolvedValue({ entries: Array.from({ length: 20 }, (_, i) => entry(i)), stamp }),
    getPeerIndexStamped: vi.fn().mockResolvedValue({ entries: [], stamp }),
    getIndexSnapshot: vi.fn().mockResolvedValue([]),
    getContractFeeRows: vi.fn().mockResolvedValue([]),
  };
});

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
import * as feeRevenue from "@/lib/data-store/fee-revenue";

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
      expect(callReports.getRevenueTrend).toHaveBeenCalledWith(8, "fdic");
      expect(callReports.getRevenueTrend).toHaveBeenCalledWith(8, "ncua");
      expect(callReports.getTopRevenueInstitutions).toHaveBeenCalledWith(10, "fdic");
      expect(callReports.getTopRevenueInstitutions).toHaveBeenCalledWith(10, "ncua");
      expect(callReports.getRevenueByTier).toHaveBeenCalled();
      expect(result).toHaveProperty("financial_groups.0.trend");
      expect(result).toHaveProperty("financial_groups.0.top_institutions");
      expect(result).toHaveProperty("financial_groups.0.by_tier");
    });

    it("returns only trend when view=trend", async () => {
      const result = await execute({ source: "call_reports", view: "trend", quarters: 4, limit: 10, top_n: 5 });
      expect(callReports.getRevenueTrend).toHaveBeenCalledWith(4, "fdic");
      expect(callReports.getRevenueTrend).toHaveBeenCalledWith(4, "ncua");
      expect(callReports.getTopRevenueInstitutions).not.toHaveBeenCalled();
      expect(result).toHaveProperty("financial_groups.0.trend");
    });

    it("returns top institutions when view=top_institutions", async () => {
      const result = await execute({ source: "call_reports", view: "top_institutions", limit: 5, quarters: 8, top_n: 5 });
      expect(callReports.getTopRevenueInstitutions).toHaveBeenCalledWith(5, "fdic");
      expect(callReports.getTopRevenueInstitutions).toHaveBeenCalledWith(5, "ncua");
      expect(result).toHaveProperty("financial_groups.0.top_institutions");
    });

    it("returns tier data when view=by_tier", async () => {
      const result = await execute({ source: "call_reports", view: "by_tier", quarters: 8, limit: 10, top_n: 5 });
      expect(callReports.getRevenueByTier).toHaveBeenCalled();
      expect(result).toHaveProperty("financial_groups.0.by_tier");
    });

    it("returns district data when view=by_district with district param", async () => {
      const result = await execute({ source: "call_reports", view: "by_district", district: 3, quarters: 8, limit: 10, top_n: 5 });
      expect(callReports.getDistrictFeeRevenue).toHaveBeenCalledWith(3, undefined, "fdic");
      expect(callReports.getDistrictFeeRevenue).toHaveBeenCalledWith(3, undefined, "ncua");
      expect(result).toHaveProperty("financial_groups.0.district_revenue");
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
      expect(health.getIndustryHealthMetrics).toHaveBeenCalledWith("fdic");
      expect(health.getIndustryHealthMetrics).toHaveBeenCalledWith("ncua");
      expect(health.getDepositGrowthTrend).toHaveBeenCalled();
      expect(health.getLoanGrowthTrend).toHaveBeenCalled();
      expect(health.getInstitutionCountTrends).toHaveBeenCalled();
      expect(result).toHaveProperty("financial_groups.0.metrics");
      expect(result).toHaveProperty("financial_groups.1.charter_type", "credit_union");
    });

    it("returns only metrics when view=metrics", async () => {
      const result = await execute({ source: "health", view: "metrics", quarters: 8, limit: 10, top_n: 5 });
      expect(health.getIndustryHealthMetrics).toHaveBeenCalled();
      expect(health.getHealthMetricsByCharter).not.toHaveBeenCalled();
      expect(result).toHaveProperty("financial_groups.0.metrics");
    });

    it("returns deposit trend when view=deposits", async () => {
      const result = await execute({ source: "health", view: "deposits", quarters: 6, limit: 10, top_n: 5 });
      expect(health.getDepositGrowthTrend).toHaveBeenCalledWith(6, "fdic");
      expect(health.getDepositGrowthTrend).toHaveBeenCalledWith(6, "ncua");
      expect(result).toHaveProperty("financial_groups.0.deposits");
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
    it("returns national index snapshot by default, cut to the limit, with its dataset stamp (#1924)", async () => {
      const result = await execute({ source: "fee_index", limit: 15, quarters: 8, top_n: 5 }) as { index: unknown[]; dataset: { stamp_id: string; summary: string; filters: string[] } };
      expect(feeIndex.getNationalIndexStamped).toHaveBeenCalled();
      expect(result.index).toHaveLength(15);
      expect(result.dataset.stamp_id).toMatch(/^ds_/);
      expect(result.dataset.summary).toBe("Published fee schedules, read live 18 Oct 2026 14:10 UTC. Institutions sharing one fee schedule count once.");
      expect(result.dataset.filters).toEqual(["Only sourced fees"]);
    });

    it("returns peer index when charter provided", async () => {
      const result = await execute({ source: "fee_index", charter: "bank", quarters: 8, limit: 10, top_n: 5 });
      expect(feeIndex.getPeerIndexStamped).toHaveBeenCalledWith(
        expect.objectContaining({ charter_type: "bank" }),
      );
      expect(result).toHaveProperty("index");
      expect(result).toHaveProperty("dataset.stamp_id");
    });

    it("returns peer index when tiers provided", async () => {
      const result = await execute({ source: "fee_index", tiers: ["community"], quarters: 8, limit: 10, top_n: 5 });
      expect(feeIndex.getPeerIndexStamped).toHaveBeenCalledWith(
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
      expect(derivedAnalytics.getFeeDependencyTrend).toHaveBeenCalledWith(8, "fdic");
      expect(derivedAnalytics.getFeeDependencyTrend).toHaveBeenCalledWith(8, "ncua");
      expect(derivedAnalytics.getRevenuePerInstitutionTrend).toHaveBeenCalledWith(8, "fdic");
      expect(derivedAnalytics.getRevenuePerInstitutionTrend).toHaveBeenCalledWith(8, "ncua");
      expect(result).toHaveProperty("concentration");
      expect(result).toHaveProperty("financial_groups.0.dependency");
      expect(result).toHaveProperty("financial_groups.0.revenue_per_institution");
    });

    it("returns only concentration when view=concentration", async () => {
      const result = await execute({ source: "derived", view: "concentration", top_n: 3, quarters: 8, limit: 10 });
      expect(derivedAnalytics.getRevenueConcentration).toHaveBeenCalledWith(3);
      expect(derivedAnalytics.getFeeDependencyTrend).not.toHaveBeenCalled();
      expect(result).toHaveProperty("concentration");
    });

    it("returns only dependency when view=dependency", async () => {
      const result = await execute({ source: "derived", view: "dependency", quarters: 6, limit: 10, top_n: 5 });
      expect(derivedAnalytics.getFeeDependencyTrend).toHaveBeenCalledWith(6, "fdic");
      expect(derivedAnalytics.getFeeDependencyTrend).toHaveBeenCalledWith(6, "ncua");
      expect(result).toHaveProperty("financial_groups.0.dependency");
    });

    it("returns only per-institution when view=revenue_per_institution", async () => {
      const result = await execute({ source: "derived", view: "revenue_per_institution", quarters: 4, limit: 10, top_n: 5 });
      expect(derivedAnalytics.getRevenuePerInstitutionTrend).toHaveBeenCalledWith(4, "fdic");
      expect(derivedAnalytics.getRevenuePerInstitutionTrend).toHaveBeenCalledWith(4, "ncua");
      expect(result).toHaveProperty("financial_groups.0.revenue_per_institution");
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

describe("Hamilton financial tool comparability (#2330)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const national = internalTools.queryNationalData.execute as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const correlation = internalTools.queryFeeRevenueCorrelation.execute as any;
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["call_reports", "trend"], ["call_reports", "top_institutions"], ["call_reports", "by_tier"], ["call_reports", "by_district"],
    ["health", "metrics"], ["health", "by_charter"], ["health", "deposits"], ["health", "loans"], ["health", "institution_counts"],
    ["derived", "dependency"], ["derived", "revenue_per_institution"],
  ])("%s/%s returns separately labeled canonical financial groups without a pooled benchmark", async (source, view) => {
    const result = await national({ source, view, quarters: 8, limit: 10, top_n: 5 });
    expect(result.financial_groups).toHaveLength(2);
    expect(result.financial_groups[0]).toMatchObject({ financial_source: "fdic", charter_type: "bank", fee_income_definition: { source: "fdic", measure: "deposit_service_charge_income", period_basis: "standalone_quarter" } });
    expect(result.financial_groups[1]).toMatchObject({ financial_source: "ncua", charter_type: "credit_union", fee_income_definition: { source: "ncua", measure: "broad_credit_union_fee_income", source_period_basis: "year_to_date" } });
    expect(Object.keys(result)).toEqual(["financial_groups"]);
  });

  it.each(["call_reports", "health", "derived"])("honors a credit-union charter or explicit regulator in %s", async (source) => {
    const result = await national({ source, charter: "credit_union", quarters: 8, limit: 10, top_n: 5 });
    expect(result.financial_groups).toHaveLength(1);
    expect(result.financial_groups[0].financial_source).toBe("ncua");
    const bank = await national({ source, financial_source: "fdic", quarters: 8, limit: 10, top_n: 5 });
    expect(bank.financial_groups).toHaveLength(1);
    expect(bank.financial_groups[0].charter_type).toBe("bank");
    expect(await national({ source, charter: "credit_union", financial_source: "fdic" })).toHaveProperty("error");
  });

  it.each(["institutions", "by_tier", "by_charter"])("partitions correlation %s and passes a canonical source to every reader", async (view) => {
    const result = await correlation({ view, limit: 20 });
    expect(result.financial_groups.map((group: { financial_source: string }) => group.financial_source)).toEqual(["fdic", "ncua"]);
    expect(result).not.toHaveProperty("data");
    for (const group of result.financial_groups) {
      expect(group.income_per_10k_assets).toMatchObject({ fields: ["fee_income_ratio", "avg_fee_income_ratio"], definition: expect.stringContaining("not fee income as a share of revenue"), unit: "USD income per 10,000 USD assets", period_basis: "standalone_quarter" });
    }
    const reader = view === "institutions" ? feeRevenue.getFeeRevenueData : view === "by_tier" ? feeRevenue.getTierFeeRevenueSummary : feeRevenue.getCharterFeeRevenueSummary;
    expect(reader).toHaveBeenCalledWith("fdic");
    expect(reader).toHaveBeenCalledWith("ncua");
    vi.clearAllMocks();
    const scoped = await correlation({ view, limit: 20, charter_type: "credit_union" });
    expect(scoped.financial_groups).toHaveLength(1);
    expect(reader).toHaveBeenCalledExactlyOnceWith("ncua");
  });

  it("does not pretend a conflicting source/charter or missing subject is a comparison", async () => {
    expect(await correlation({ view: "by_tier", charter_type: "bank", financial_source: "ncua" })).toHaveProperty("error");
    expect(feeRevenue.getTierFeeRevenueSummary).not.toHaveBeenCalled();
    expect(await correlation({ view: "peers" })).toHaveProperty("error");
  });

  it("labels dependency percentages and whole-dollar per-institution income with their actual period bases", async () => {
    const result = await national({ source: "derived", quarters: 8, limit: 10, top_n: 5 });
    expect(result.financial_groups[0]).toMatchObject({ dependency: { measure_definition: { unit: "percent", period_basis: "standalone_quarter" } }, revenue_per_institution: { measure_definition: { unit: "USD", period_basis: "standalone_quarter" } } });
    expect(result.financial_groups[1]).toMatchObject({ dependency: { measure_definition: { unit: "percent", period_basis: "year_to_date" } }, revenue_per_institution: { measure_definition: { unit: "USD", period_basis: "standalone_quarter" } } });
  });

  it("passes the full answer gate for national thousands, derived dollars, and health percentages (#2358)", async () => {
    vi.mocked(callReports.getRevenueTrend).mockResolvedValueOnce({ latest: { quarter: "2026-Q2", total_service_charges: 2640000, total_institutions: 4000, bank_service_charges: 0, cu_service_charges: 2640000, yoy_change_pct: 2.5 }, quarters: [] });
    const nationalIncome = await national({ source: "call_reports", financial_source: "ncua", view: "trend", quarters: 8, limit: 10, top_n: 5 });
    expect(writtenAnswerCheck("Credit unions reported $2.64 billion in broad fee income for Q2 2026.", [nationalIncome])).toMatchObject({ passed: true, figureCheck: { unmatched: [] } });
    expect(writtenAnswerCheck("Credit unions reported $2.64 million in broad fee income.", [nationalIncome]).passed).toBe(false);

    vi.mocked(derivedAnalytics.getFeeDependencyTrend).mockResolvedValueOnce({ trend: [{ report_date: "2026-06-30", avg_fee_income_ratio: 4.3, institution_count: 25 }], signals: { qoq_change_pct: null, yoy_change_pct: null } });
    vi.mocked(derivedAnalytics.getRevenuePerInstitutionTrend).mockResolvedValueOnce({ current: { by_tier: [], by_charter: [] }, trend: [{ report_date: "2026-06-30", avg_sc_income: 11125000, institution_count: 25 }], signals: { qoq_change_pct: null, yoy_change_pct: null } });
    const derived = await national({ source: "derived", financial_source: "ncua", quarters: 8, limit: 10, top_n: 5 });
    expect(writtenAnswerCheck("The reported revenue share was 4.3%, and mean quarterly income was $11.125 million.", [derived])).toMatchObject({ passed: true, problems: [] });
    expect(writtenAnswerCheck("The reported revenue share was $4.3.", [derived]).passed).toBe(false);

    vi.mocked(health.getIndustryHealthMetrics).mockResolvedValueOnce({ roa: { current: 0.75, history: [], trend: "stable", asOf: "2026-06-30", minimum_median_count: 5 }, roe: null, efficiency_ratio: null });
    vi.mocked(health.getDepositGrowthTrend).mockResolvedValueOnce({ current_yoy_pct: 2.5, history: [{ quarter: "2026-Q2", yoy_pct: 2.5, absolute: 1200000 }], trend: "stable", asOf: "2026-06-30" });
    const metrics = await national({ source: "health", financial_source: "ncua", quarters: 8, limit: 10, top_n: 5 });
    expect(writtenAnswerCheck("The return on assets was 0.75%. Deposits were $1.2 billion, with reported growth of 2.5%.", [metrics])).toMatchObject({ passed: true, problems: [] });
    expect(writtenAnswerCheck("The return on assets was $0.75.", [metrics]).passed).toBe(false);
  });

  it.each(["institutions", "by_tier", "by_charter"])("keeps correlation %s schedule prices, financial totals, and asset intensity in separate units (#2358)", async (view) => {
    const row = { financial_source: "ncua", report_date: "2026-06-30", service_charge_income: 153080, avg_service_charge_income: 153080, avg_fee: 30, avg_fee_amount: 30, median_overdraft: 30, fee_income_ratio: 7.49, avg_fee_income_ratio: 7.49 };
    const reader = view === "institutions" ? feeRevenue.getFeeRevenueData : view === "by_tier" ? feeRevenue.getTierFeeRevenueSummary : feeRevenue.getCharterFeeRevenueSummary;
    vi.mocked(reader).mockResolvedValueOnce([row] as never);
    const result = await correlation({ view, limit: 20, financial_source: "ncua" });
    expect(writtenAnswerCheck("Reported broad fee income was $153.08 million. The published schedule price was $30.", [result])).toMatchObject({ passed: true, problems: [] });
    expect(writtenAnswerCheck("The published schedule price was $30,000.", [result]).passed).toBe(false);
    expect(writtenAnswerCheck("Fee income was 7.49% of revenue.", [result]).passed).toBe(false);
  });

  it("leaves same-fee prices comparable across charters and labels schedule concentration correctly", async () => {
    const result = await national({ source: "derived", view: "concentration", quarters: 8, limit: 10, top_n: 5 });
    expect(result).toHaveProperty("concentration");
    expect(result.concentration_basis).toContain("not realized fee income");
    expect(result).not.toHaveProperty("financial_groups");
    expect(derivedAnalytics.getFeeDependencyTrend).not.toHaveBeenCalled();
    const prices = await national({ source: "fee_index", financial_source: "ncua", limit: 10 });
    expect(prices).toHaveProperty("index");
    expect(feeIndex.getNationalIndexStamped).toHaveBeenCalled();
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
