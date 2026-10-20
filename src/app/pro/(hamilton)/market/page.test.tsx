import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /pro/market dates its fee data by the newest published fee, as every public page does
 * (#2491). A document crawl publishes nothing, so a crawl date is never called an update.
 */
const summary = vi.hoisted(() => ({ refreshedOn: null as string | null }));

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn(async () => ({ id: 1 })) }));
vi.mock("@/lib/access", () => ({ canAccessPremium: vi.fn(() => true) }));
vi.mock("@/lib/data-store/fee-index", () => ({
  getNationalIndexCachedStamped: vi.fn(async () => ({ entries: [], stamp: null })),
}));
vi.mock("@/lib/data-store/fed", () => ({
  getBeigeBookHeadlines: vi.fn(async () => new Map()),
  getBeigeBookEditions: vi.fn(async () => []),
  getRecentSpeeches: vi.fn(async () => []),
}));
vi.mock("@/lib/data-store/articles", () => ({ getPublishedArticles: vi.fn(async () => []) }));
vi.mock("@/lib/data-store/public-cached-reads", () => ({
  getDataFreshnessCached: vi.fn(async () => ({ last_crawl_at: "2026-10-19T15:00:00.000Z" })),
  getPublicStatsCached: vi.fn(async () => ({
    total_institutions: 1000,
    total_observations: 50000,
    total_categories: 49,
  })),
}));
vi.mock("@/lib/public-stats", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/public-stats")>()),
  getPublicStatsSummary: vi.fn(async () => ({ refreshedOn: summary.refreshedOn })),
}));

import ProMarketPage from "./page";

async function renderText(): Promise<string> {
  const markup = renderToStaticMarkup(await ProMarketPage());
  return new DOMParser().parseFromString(markup, "text/html").body.textContent ?? "";
}

describe("/pro/market freshness date (#2491)", () => {
  beforeEach(() => {
    summary.refreshedOn = null;
  });

  it("dates the fee data by the newest published fee, never the newest crawl", async () => {
    summary.refreshedOn = "Oct 12, 2026";
    const text = await renderText();
    expect(text).toContain("Last updatedOct 12, 2026");
    expect(text).toContain("Fee data last updated Oct 12, 2026.");
    expect(text).not.toContain("Oct 19, 2026");
  });

  it("shows no date when no published fee date is known, rather than a crawl date", async () => {
    const text = await renderText();
    expect(text).not.toContain("Oct 19, 2026");
    expect(text).not.toContain("Fee data last");
  });
});
