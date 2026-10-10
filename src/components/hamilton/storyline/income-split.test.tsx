import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StoryExhibitView } from "./story-exhibits";
import { incomeSplitOf } from "./income-split";

// Test figures only.
const split = { unit: "per_1000_deposits", own: 4.1, peerMedian: 5, peerLabel: "Credit unions $5B to $10B", n: 25, priceIndex: 108, priceExplained: -0.3, otherExplained: -0.6, quarterEnd: "2026-06-30" };

describe("income split", () => {
  it("draws the gap split into price and how often fees are charged, not a table", () => {
    const html = renderToStaticMarkup(
      <StoryExhibitView
        number={1}
        researchInstitutionName="Space Coast Credit Union"
        item={{
          id: "income-split",
          actionTitle: "Price explains about a third of the gap",
          exhibit: { kind: "structure_matrix", title: "t", columns: ["Yours"], rows: [{ name: "x", cells: ["1"] }], sources: [], incomeSplit: split } as never,
        }}
      />,
    );
    expect(html).toContain("$4.10");
    expect(html).toContain("year to Jun 30, 2026");
    expect(html).toContain("$5.00");
    expect(html).toContain("−$0.90");
    expect(html).toContain("Published prices");
    expect(html).toContain("Space Coast Credit Union");
    expect(html).toContain("Space Coast Credit Union&#x27;s published prices");
    expect(html).not.toContain("Your published prices");
    expect(html).not.toContain(">You<");
    expect(html).toContain("33%");
    expect(html).toContain("<strong class=\"font-semibold text-warm-900\">108</strong>");
    expect(html).not.toContain("<table");
  });

  it("falls back to the table when the numbers are missing", () => {
    expect(incomeSplitOf({ kind: "structure_matrix" })).toBeNull();
    expect(incomeSplitOf({ incomeSplit: { ...split, own: "4.1" } })).toBeNull();
  });
});
