import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ getSql: () => { throw new Error("no database in unit tests"); } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/pro/hamilton", useSearchParams: () => new URLSearchParams() }));

import { IntelligenceView, type Loaded } from "./IntelligenceWorkspace";

const empty: Loaded = { fees: null, feeMap: null, peers: null, revenue: null, tiers: null, economy: null, complaints: null, articles: null, statePosts: null };

describe("IntelligenceView", () => {
  it("renders a state overview with every reader failed, saying so instead of showing zeros", () => {
    const html = renderToStaticMarkup(<IntelligenceView
      selection={{ version: 1, task: "compare", scope: { kind: "state", stateCode: "FL" }, charter: "all", categories: ["monthly_maintenance"] }}
      data={empty} lens="fees" overview />);
    expect(html).toContain("Florida: fees, finances and market");
    expect(html).toContain("Complaint records could not load.");
    expect(html).not.toContain("$0.00");
  });
});
