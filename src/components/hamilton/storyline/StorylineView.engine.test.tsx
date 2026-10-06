import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildFeeAnswer } from "@/lib/hamilton/workspace/answer";
import { buildAskResponse, parseAsk } from "@/lib/hamilton/workspace/ask";
import { buildSegmentResearch, parseSegment } from "@/lib/hamilton/workspace/segment";
import { overdraftResearch } from "@/lib/hamilton/workspace/test-fixtures";
import type { FeeResearch, SegmentMember } from "@/lib/hamilton/workspace/types";
import { StorylineView } from "./StorylineView";

// The engine's own storylines, built from its invented test fixtures, drawn by the page.
const structure: FeeResearch["structure"] = {
  groupLabel: "peers (Credit unions in Tennessee)",
  columns: [
    { category: "overdraft", label: "Overdraft fee" },
    { category: "nsf", label: "NSF fee" },
    { category: "od_daily_cap", label: "Daily cap" },
  ],
  rows: [
    { institutionId: 1, name: "Example Valley Credit Union", own: true, values: { overdraft: 32, nsf: 32 } },
    { institutionId: 2, name: "Peer 2", own: false, values: { overdraft: 27 } },
  ],
  source: { label: "Fees on each institution's own published schedule (verified, live)", table: "published_fee_catalog" },
};
const research = (o: Partial<FeeResearch> = {}) =>
  overdraftResearch({ structure, changeEvents: [{ date: "2026-08-02", institutionName: "Peer 4", from: 30, to: 25 }], ...o });

describe("StorylineView with engine storylines", () => {
  const intents = [{}, { wantsDecision: true }, { tested: [25, 0] }, { structure: true }, { focus: "trend" as const }];
  for (const story of intents) {
    it(`draws the ${JSON.stringify(story)} storyline with every exhibit numbered`, () => {
      const built = buildFeeAnswer(research(), { story }).storyline!;
      const html = renderToStaticMarkup(<StorylineView story={built} />);
      expect(html).toContain(built.governingThought.replace(/&/g, "&amp;").slice(0, 20));
      for (const e of built.exhibits) expect(html).toContain(`Exhibit ${e.number}`);
      expect(html).not.toMatch(/recommend/i);
    });
  }

  it("draws the segment storyline for a $10B-and-up question", () => {
    const members: SegmentMember[] = [10, 0, 36].map((amount, i) => ({
      institutionId: 200 + i,
      institutionName: `Big Bank ${i + 1}`,
      amount,
      stateCode: "NY",
      sourceDocumentIds: [i],
      documentUrls: [],
      publishedAt: "2026-09-20",
      totalAssets: 1_000_000_000,
      charterType: "bank",
      dailyCap: null,
    }));
    const seg = buildSegmentResearch({
      segment: parseSegment("all 10B and up institutions")!,
      feeCategory: "overdraft",
      institutionsInSegment: 184,
      members,
      current: 32,
      ownInSegment: false,
    });
    const question = "talk to me about all 10B and up institutions for od fees";
    const res = buildAskResponse({ question, intent: parseAsk(question), research: research({ segment: seg }), memory: [] });
    const html = renderToStaticMarkup(<StorylineView story={res.answer!.storyline!} />);
    expect(html).toContain("Big Bank 1");
    expect(html).toContain("Exhibit 1");
  });
});
