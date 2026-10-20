import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ trend: vi.fn(), tiers: vi.fn() }));
vi.mock("@/lib/data-store/connection", () => ({ getSql: vi.fn(), sql: vi.fn() }));
vi.mock("@/lib/data-store/call-reports", async (original) => ({ ...(await original<typeof import("@/lib/data-store/call-reports")>()), getRevenueTrend: mocks.trend, getRevenueByTier: mocks.tiers }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/pro/intelligence", useSearchParams: () => new URLSearchParams() }));
vi.mock("./IntelligenceCharts", () => ({ MultiTrend: (props: unknown) => <pre data-chart>{JSON.stringify(props)}</pre>, HorizontalBars: () => null, FeeLandscapeChart: () => null, StateFeeMap: () => null }));
import { IntelligenceView, loadIntelligence, readFindings } from "./IntelligenceWorkspace";
import { marketBoardBriefInput } from "./market-board-brief";
import type { LandingResearchHandoff } from "@/lib/hamilton/landing-research-handoff";
const selection: LandingResearchHandoff = { version: 1, task: "compare", scope: { kind: "national" }, charter: "all", categories: ["overdraft"] };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.trend.mockImplementation(async (_quarters, source) => {
    const row = { quarter: "2026-Q2", total_service_charges: source === "ncua" ? 2000 : 1000,
      bank_service_charges: source === "fdic" ? 1000 : 0, cu_service_charges: source === "ncua" ? 2000 : 0, total_institutions: source === "ncua" ? 25 : 127, yoy_change_pct: 2 };
    return { quarters: [row], latest: row };
  });
  mocks.tiers.mockResolvedValue([]);
});
describe("Intelligence financial source boundaries", () => {
  it("loads and renders separate regulator measures and board exhibits with no mixed total", async () => {
    const data = await loadIntelligence(selection, ["financials"], { compact: false });
    expect(mocks.trend.mock.calls).toEqual([[12, "fdic"], [12, "ncua"]]);
    expect(mocks.tiers.mock.calls).toEqual([[undefined, "fdic"], [undefined, "ncua"]]);
    expect(data.revenue).toBeNull();
    expect(data.tiers).toBeNull();
    expect(data.financialGroups).toHaveLength(2);
    const html = renderToStaticMarkup(<IntelligenceView selection={selection} data={data} lens="financials" overview={false} />);
    expect(html).toContain("Bank deposit service-charge income");
    expect(html).toContain("Broad credit-union fee income");
    expect(html).not.toContain("All filers");
    expect(html).not.toContain("&quot;cu&quot;");
    const input = marketBoardBriefInput(selection, data, ["financials"], null);
    expect(input.exhibits).toHaveLength(2);
    expect(input.exhibits.map(e => e.id)).toEqual(["fee_income_trend_fdic", "fee_income_trend_ncua"]);
    expect(input.exhibits[1].rows[0].at(-1)).toBe("25");
    expect(readFindings(data, "United States", null, "overdraft").map(f => f.source)).toEqual(["FDIC call report", "NCUA (5300 call report)"]);
  });
  it.each([["bank", "fdic"], ["credit_union", "ncua"]] as const)("honors %s selection with only %s financials", async (charter, source) => {
    const data = await loadIntelligence({ ...selection, charter }, ["financials"], { compact: true });
    expect(mocks.trend).toHaveBeenCalledExactlyOnceWith(12, source);
    expect(mocks.tiers).not.toHaveBeenCalled();
    expect(data.financialGroups?.map(group => group.source)).toEqual([source]);
  });
});
