import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sql: vi.fn(), market: vi.fn(), footprint: vi.fn(), branches: vi.fn(), study: vi.fn() }));
vi.mock("@/lib/data-store/connection", () => ({ sql: Object.assign(mocks.sql, { unsafe: vi.fn((value: string) => value) }) }));
vi.mock("@/lib/data-store/local-market", () => ({ getLocalMarketCompetitors: mocks.market }));
vi.mock("@/lib/data-store/branches", () => ({ getMarketBranchFootprint: mocks.footprint, getBranchesForInstitution: mocks.branches }));
vi.mock("@/lib/data-store/market-study", () => ({ getMarketStudyData: mocks.study }));
vi.mock("@/lib/data-store/competitor-coverage", () => ({
  getBranchlessIds: vi.fn(async () => new Set()), getLiveFeeFacts: vi.fn(async () => []),
  summarizeMarketCoverage: vi.fn(() => null),
}));
vi.mock("@/lib/hamilton/studies-exhibits/market", () => ({
  bankStyles: vi.fn(() => new Map()), footprintLegend: vi.fn(() => ""), footprintMap: vi.fn(() => ""),
  responsive: (draw: (size: number) => string | null) => draw(640),
}));
vi.mock("@/lib/hamilton/branch-network-map", () => ({ branchNetworkMap: vi.fn(() => null) }));
vi.mock("d3-geo", () => ({ geoContains: vi.fn(() => false) }));
vi.mock("@/lib/geo/counties", () => ({ countyFeature: vi.fn(() => null) }));

import { getLocalMarketAnswer, MARKET_FEES } from "./local-market-answer";
import { HOMEPAGE_MARKET_CATEGORIES } from "./local-market-request";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sql.mockImplementation(async (strings: TemplateStringsArray) => {
    const query = strings.join("?");
    if (query.includes("PERCENTILE_CONT")) return [
      { fee_category: "paper_statement", amount: "0" },
      { fee_category: "money_order", amount: "4.00" },
      // Intentional over-return from the synthetic boundary; never allowed into the result.
      { fee_category: "overdraft", amount: "30" },
    ];
    if (query.includes("ANY(")) return [{ id: 202, institution_name: "Synthetic Peer", charter_type: "bank" }];
    return [{ id: 101, institution_name: "Synthetic Subject", charter_type: "bank", cert_number: "987654", city: "Synthetic City", state_code: "WA" }];
  });
  mocks.market.mockResolvedValue({
    label: "Synthetic County", basis: "branch_counties", sod_year: 2025, county_fips: ["53033"],
    competitors: [{ institution_id: 202, fees: { paper_statement: 2, money_order: 3, nsf: 30 } }],
  });
  mocks.footprint.mockResolvedValue({ byInstitution: {
    101: { branches: 1, deposits: 1000 }, 202: { branches: 2, deposits: 2000 },
  }, totalBranches: 3, totalDeposits: 3000 });
  mocks.branches.mockResolvedValue({ total: 1, rows: [{ city: "Synthetic City", state: "WA", latitude: null, longitude: null }] });
  mocks.study.mockResolvedValue(null);
});

describe("local-market category propagation through the real service", () => {
  it("applies charter before ranking and never substitutes another type", async () => {
    const result = await getLocalMarketAnswer(101, { categories: ["money_order"], charter: "credit_union" });
    expect(result?.competitors).toEqual([]);
    expect(result?.institutionId).toBe(101);
  });

  it("uses exactly the selected list in both fee queries and the response", async () => {
    const categories = ["money_order", "paper_statement"];
    const result = await getLocalMarketAnswer(101, { categories });
    expect(mocks.market).toHaveBeenCalledWith(expect.objectContaining({ institutionId: 101, categories }));
    const ownFeeCall = mocks.sql.mock.calls.find(([strings]) => strings.join("?").includes("PERCENTILE_CONT"));
    expect(ownFeeCall?.[1]).toBe(101);
    expect(String(ownFeeCall?.[2])).toContain("fee_audience IN ('consumer', 'both')");
    expect(ownFeeCall?.[3]).toEqual(categories);
    expect(result?.categories).toEqual(categories);
    expect(result?.you.fees).toEqual({ money_order: 4, paper_statement: 0 });
    expect(ownFeeCall?.[0].join("?")).toContain("c.amount >= 0");
    expect(ownFeeCall?.[0].join("?")).toContain("CASE WHEN c.fee_category = 'overdraft' THEN MAX(c.amount)");
    expect(result?.competitors[0].fees).toEqual({ money_order: 3, paper_statement: 2 });
    expect(result?.institutionId).toBe(101);
    expect(result?.market.basis).toBe("branch_counties");
  });

  it("keeps missing requested fees missing rather than returning zero or legacy fees", async () => {
    const result = await getLocalMarketAnswer(101, { categories: ["cashiers_check"] });
    expect(result?.categories).toEqual(["cashiers_check"]);
    expect(result?.you.fees).toEqual({});
    expect(result?.competitors[0].fees).toEqual({});
  });

  it("supports the complete homepage set without spotlight substitution", async () => {
    const result = await getLocalMarketAnswer(101, { categories: HOMEPAGE_MARKET_CATEGORIES });
    expect(result?.categories).toEqual([...HOMEPAGE_MARKET_CATEGORIES]);
    expect(result?.you.fees).not.toHaveProperty("overdraft");
    expect(result?.competitors[0].fees).not.toHaveProperty("nsf");
  });

  it("preserves legacy caller defaults", async () => {
    expect((await getLocalMarketAnswer(101))?.categories).toEqual([...MARKET_FEES]);
  });

  it("rejects an invalid explicit list before database access", async () => {
    await expect(getLocalMarketAnswer(101, { categories: [] })).rejects.toThrow();
    expect(mocks.sql).not.toHaveBeenCalled();
    expect(mocks.market).not.toHaveBeenCalled();
  });

  it("does not infer an institution or market when one is missing", async () => {
    mocks.sql.mockResolvedValue([]);
    expect(await getLocalMarketAnswer(101, { categories: ["money_order"] })).toBeNull();
    expect(mocks.market).not.toHaveBeenCalled();
  });

  it("preserves an unavailable branch-market result", async () => {
    mocks.market.mockResolvedValue(null);
    expect(await getLocalMarketAnswer(101, { categories: ["money_order"] })).toBeNull();
  });

  it("does not use a credit union charter number as an FDIC certificate", async () => {
    mocks.sql.mockResolvedValueOnce([{ id: 101, institution_name: "Synthetic CU", charter_type: "credit_union", cert_number: "987654", city: "Synthetic City", state_code: "WA" }]);
    await getLocalMarketAnswer(101, { categories: ["paper_statement"] });
    expect(mocks.market).toHaveBeenCalledWith(expect.objectContaining({ certNumber: null, categories: ["paper_statement"] }));
  });
});
