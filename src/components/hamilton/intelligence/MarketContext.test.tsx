import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hamilton/landing-geographic-research", () => ({ loadLandingGeographicResearch: async () => null }));
vi.mock("@/lib/hamilton/intelligence-data", async (orig) => ({ ...(await orig() as object), loadFeeMap: async () => null, loadPeerTable: async () => null, loadComplaintTrend: async () => null, loadStatePosts: async () => [] }));
vi.mock("@/lib/data-store/economic-context", async (orig) => ({ ...(await orig() as object), getStateEconomicContext: async () => null }));
vi.mock("@/lib/data-store/call-reports", async (orig) => ({ ...(await orig() as object), getRevenueTrend: async () => null, getRevenueByTier: async () => null }));
vi.mock("@/lib/data-store/news", async (orig) => ({ ...(await orig() as object), getArticles: async () => [] }));

import { MarketContext } from "./IntelligenceWorkspace";

describe("MarketContext (#2042)", () => {
  it("reads the institution's state, leads with fees and keeps the rest one click away", async () => {
    const html = renderToStaticMarkup(await MarketContext({ stateCode: "FL" }));
    expect(html).toContain("The market in Florida");
    expect(html).toContain('href="/pro/intelligence"');
    const details = html.indexOf("<details");
    expect(details).toBeGreaterThan(html.indexOf("Published fee landscape"));
    expect(html.indexOf("Economic conditions")).toBeGreaterThan(details);
    expect(html).toContain("More on Florida: finances, economy, complaints and regulation");
  });

  it("falls back to the U.S. market for a state outside research coverage", async () => {
    const html = renderToStaticMarkup(await MarketContext({ stateCode: null }));
    expect(html).toContain("The market in the United States");
  });
});
