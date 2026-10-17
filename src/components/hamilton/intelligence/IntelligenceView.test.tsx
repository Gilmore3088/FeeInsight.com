import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ getSql: () => { throw new Error("no database in unit tests"); } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/pro/hamilton", useSearchParams: () => new URLSearchParams() }));

import { feeFocusHref, IntelligenceView, type Loaded } from "./IntelligenceWorkspace";
import { decodeLandingResearch } from "@/lib/hamilton/landing-research-handoff";
import { assetSizeFor } from "@/lib/hamilton/asset-size";

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

describe("feeFocusHref", () => {
  it("puts the chosen fee first, keeps the others and carries the asset size", () => {
    const href = new URL(feeFocusHref({ version: 1, task: "compare", scope: { kind: "national" }, charter: "bank", categories: ["monthly_maintenance", "overdraft"] }, "overdraft", assetSizeFor("1b-10b")), "https://x");
    expect(href.pathname).toBe("/pro/intelligence");
    expect(href.searchParams.get("size")).toBe("1b-10b");
    expect(decodeLandingResearch(href.searchParams.get("research"))?.categories).toEqual(["overdraft", "monthly_maintenance"]);
  });
});

describe("MarketBriefView", () => {
  it("answers only the topics asked and says when the data could not load", async () => {
    const { MarketBriefView } = await import("./MarketBrief");
    const { parseMarketQuestion } = await import("@/lib/hamilton/market-question");
    const question = "talk to me about $5B and up in florida. fee pricing, revenue, complaints";
    const html = renderToStaticMarkup(<MarketBriefView question={question} market={parseMarketQuestion(question)!} data={empty} />);
    expect(html).toContain("Florida: fee landscape, financials and complaints");
    expect(html).toContain("could not load just now");
    expect(html).not.toContain("Economic conditions");
    expect(html).toContain("It does not recommend a price.");
  });
});

describe("MarketBriefView follow-up (#979 H04-T03, AC1)", () => {
  const question = "talk to me about $5B and up in florida. fee pricing, revenue, complaints";
  it("is the page's one question field and hands the conversation back to Ask", async () => {
    const { MarketBriefView } = await import("./MarketBrief");
    const { parseMarketQuestion } = await import("@/lib/hamilton/market-question");
    const html = renderToStaticMarkup(<MarketBriefView question={question} market={parseMarketQuestion(question)!} data={empty} instId="101" conversationId="8f14e45f-ceea-467f-a0f6-37f8b3a3e2f1" />);
    expect(html.match(/<input(?![^>]*type="hidden")/g)).toHaveLength(1);
    expect(html).toContain('name="conversation" value="8f14e45f-ceea-467f-a0f6-37f8b3a3e2f1"');
    expect(html).toContain('name="send" value="1"');
    expect(html).not.toContain('name="from_brief"');
  });
  it("outside a conversation, carries the brief's question as the follow-up's earlier turn", async () => {
    const { MarketBriefView } = await import("./MarketBrief");
    const { parseMarketQuestion } = await import("@/lib/hamilton/market-question");
    const html = renderToStaticMarkup(<MarketBriefView question={question} market={parseMarketQuestion(question)!} data={empty} />);
    expect(html).toContain('name="from_brief" value="talk to me about $5B and up in florida. fee pricing, revenue, complaints"');
    expect(html).not.toContain('name="conversation"');
  });
});

describe("market board brief", () => {
  it("lists findings and limits, never actions, and says when data is missing", async () => {
    const { marketBoardBriefInput } = await import("./market-board-brief");
    const { boardBriefFromMarket } = await import("@/lib/hamilton/board-brief");
    const selection = { version: 1 as const, task: "compare" as const, scope: { kind: "state" as const, stateCode: "FL" as const }, charter: "all" as const, categories: ["overdraft"] };
    const report = boardBriefFromMarket(marketBoardBriefInput(selection, empty, ["fees", "financials"], assetSizeFor("1b-10b")));
    expect(report.answer?.decisions).toEqual([]);
    expect(report.answer?.headline).toContain("no finding for Florida");
    expect(report.recommendation).toContain("$1B to $10B");
    expect(report.recommendation).toContain("does not recommend a price");
    expect(report.boardBrief?.sourceResearchHref).toContain("size=1b-10b");
  });
});
