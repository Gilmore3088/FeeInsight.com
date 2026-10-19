import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ getSql: () => { throw new Error("No database in rendering tests"); } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/pro/intelligence", useSearchParams: () => new URLSearchParams() }));

import { SegmentTable } from "@/components/hamilton/memo/segment-table";
import { IntelligenceView, type Loaded } from "@/components/hamilton/intelligence/IntelligenceWorkspace";
import { marketBoardBriefInput } from "@/components/hamilton/intelligence/market-board-brief";
import { buildSegmentResearch, segmentClaims, segmentExhibit } from "./workspace/segment";
import type { SegmentMember } from "./workspace/types";

const several = { low: 1.65, high: 5, fees: [{ name: "Personal money order", amount: 1.65 }, { name: "Postal money order", amount: 5 }] };
const member: SegmentMember = {
  institutionId: 1, institutionName: "Example Bank", amount: 3.325, stateCode: "TX",
  sourceDocumentIds: [101, 102], documentUrls: ["https://example.test/personal.pdf", "https://example.test/postal.pdf"],
  publishedAt: "2026-10-01T00:00:00Z", totalAssets: 10_000_000, charterType: "bank", dailyCap: null, dailyFeeLimit: null, several,
};
const segment = { minAssets: 0, maxAssets: null, charterType: null, stateCode: null, largest: null, label: "institutions with published fees" };
const research = () => buildSegmentResearch({ segment, feeCategory: "money_order", institutionsInSegment: 1, members: [member], current: null, ownInSegment: false });
const selection = { version: 1 as const, task: "compare" as const, scope: { kind: "national" as const }, charter: "all" as const, categories: ["money_order"] };
const loaded: Loaded = {
  fees: null, feeMap: null, revenue: null, tiers: null, economy: null, complaints: null, articles: null, statePosts: null,
  peers: { category: "money_order", institutionsInScope: 1, rows: [{ institutionId: 1, name: member.institutionName, charter: "bank", totalAssets: member.totalAssets, amount: member.amount, documentUrl: member.documentUrls[0], publishedAt: member.publishedAt, ...{ several, documentUrls: member.documentUrls } }] },
};

describe("named segment prices (#1993)", () => {
  it("shows the named source prices in a segment row, preserving both evidence links", () => {
    const html = renderToStaticMarkup(<SegmentTable data={research()} own={null} ownLabel="Subject" />);
    expect(html).toContain("Personal money order");
    expect(html).toContain("Postal money order");
    expect(html).not.toContain(">$3.33<");
    for (const url of member.documentUrls) expect(html).toContain(url);
  });

  it("does not describe a median as a named bank's highest or largest-by-assets price", () => {
    const claims = segmentClaims(research(), "money_order", null);
    const text = claims.map(c => c.text).join(" ");
    expect(text).toContain("Example Bank");
    expect(text).toContain("$1.65");
    expect(text).toContain("$5");
    expect(text).not.toContain("$3.33");
    // No single selected document proves every charge in the range.
    expect(claims.filter(c => c.text.includes("Example Bank")).every(c => !c.source.url)).toBe(true);
  });

  it("does not call another bank's single price the highest when a range extends past it", () => {
    const sample=buildSegmentResearch({ segment, feeCategory:"money_order", institutionsInSegment:2,
      members:[member,{...member,institutionId:2,institutionName:"Other Bank",amount:4,several:undefined}],current:null,ownInSegment:false });
    expect(segmentClaims(sample,"money_order",null).map(c=>c.text).join(" ")).not.toContain("The highest is Other Bank at $4");
  });

  it("carries the range to the shared HTML/PDF competitor exhibit", () => {
    const exhibit = segmentExhibit(research(), "money_order", null, "Subject");
    expect(exhibit?.kind).toBe("competitor_range");
    if (exhibit?.kind === "competitor_range") {
      expect(exhibit.items[0]).toMatchObject({ amount: 3.325, several });
      expect(exhibit.items[0].url).toBeNull();
    }
  });

  it("preserves the aggregate band, percentile, zero count and counted schedule population", () => {
    const members = Array.from({ length: 6 }, (_, i) => ({ ...member, institutionId: i + 1, amount: i === 0 ? 3.325 : i - 1, several: i === 0 ? several : undefined, totalAssets: i, ...(i === 5 ? { countedAs: 5 } : {}) }));
    const input = { segment, feeCategory: "money_order", institutionsInSegment: 6, current: 2, ownInSegment: true };
    const withEvidence = buildSegmentResearch({ ...input, members });
    const withoutEvidence = buildSegmentResearch({ ...input, members: members.map(m => ({ ...m, several: undefined })) });
    expect(withEvidence.band).toEqual(withoutEvidence.band);
    expect(withEvidence.ownPosition).toEqual(withoutEvidence.ownPosition);
    expect(withEvidence.zeroCount).toEqual(withoutEvidence.zeroCount);
    expect(withEvidence.members).toHaveLength(6);
  });
});

describe("Intelligence named prices (#1993)", () => {
  it.each([0, 3])("preserves an ordinary stated price of %s and a legacy single schedule", amount => {
    const row = { institutionId:1, name:"Single Bank", amount, charter:"bank", totalAssets:10, documentUrl:"https://single.test/fees.pdf", publishedAt:null };
    const data = { ...loaded, peers: { category:"money_order", institutionsInScope:1, rows:[row] } };
    const html = renderToStaticMarkup(<IntelligenceView selection={selection} data={data} lens="fees" overview={false} />);
    expect(html).toContain(`$${amount.toFixed(2)}`);
    expect(html).toContain(row.documentUrl);
    expect(marketBoardBriefInput(selection,data,["fees"],null).exhibits[0].rows[0]).toContain(`$${amount.toFixed(2)}`);
  });

  it("renders source prices and all their schedule links instead of a pooled charge", () => {
    const html = renderToStaticMarkup(<IntelligenceView selection={selection} data={loaded} lens="fees" overview={false} />);
    expect(html).toContain("Personal money order");
    expect(html).toContain("Postal money order");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const namedTable = doc.querySelector('[aria-label="Institutions and their published fee"]');
    expect(namedTable?.textContent).not.toContain("$3.33");
    for (const url of member.documentUrls) expect(html).toContain(url);
  });

  it("hands truthful named prices and evidence to the actual board/PDF input", () => {
    const result = marketBoardBriefInput(selection, loaded, ["fees"], null);
    const row = result.exhibits.find(e => e.id === "local_market")!;
    expect(JSON.stringify(row.rows)).toContain("Personal money order");
    expect(JSON.stringify(row.rows)).toContain("Postal money order");
    expect(JSON.stringify(row.rows)).not.toContain("$3.33");
    for (const url of member.documentUrls) expect(JSON.stringify(row.rows)).toContain(url);
    expect(row.note).not.toContain("Each amount links to the schedule it was read from");
  });
});
