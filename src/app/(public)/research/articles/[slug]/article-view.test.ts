import { describe, expect, it } from "vitest";
import { bylineDate, parseArticle, plainSummary, tableLabel, tableFolds } from "./article-view";

// The shape the weekly fee article writes: an opening line, then sections of chart, table and one
// sentence, a prose section with a list, a long table, a method section and a closing "As of".
const ARTICLE = [
  "A single national number hides the pattern.",
  "## Banks: the larger the bank, the higher the fee",
  "```bars Median fee at banks, by size\nSmall | 30 | $30\nLarge | 35 | $35\n```",
  "| Bank size | Banks | Median fee |\n|---|---|---|\n| Small | 200 | $30 |\n| Large | 29 | $35 |",
  "Small banks sit at $30; large banks at $35.",
  "## The state matters less than the institution",
  "State medians run from $25 to $35.",
  "- **California** has the lowest median.\n- **Mississippi** has the highest.",
  "So it depends on where someone banks.",
  "## Every state with enough data",
  "| State | Institutions | Lowest | Median | Highest |\n|---|---|---|---|---|\n| [California](https://feeinsight.com/research/state/CA) | 87 | $0 | $25 | $50 |",
  "## How these numbers are built",
  "Each institution counts once.",
  "A group is shown only with 20 institutions.",
  "As of October 2026.",
].join("\n\n");

describe("parseArticle", () => {
  const brief = parseArticle(ARTICLE);

  it("keeps the opening paragraph as the lead and the closing date for the byline", () => {
    expect(brief.lead).toEqual(["A single national number hides the pattern."]);
    expect(brief.asOf).toBe("October 2026");
  });

  it("lifts each section's first paragraph above its exhibit", () => {
    const [banks] = brief.sections;
    expect(banks.title).toBe("Banks: the larger the bank, the higher the fee");
    expect(banks.finding).toBe("Small banks sit at $30; large banks at $35.");
    expect(banks.notes).toEqual([]);
    expect(banks.exhibits).toHaveLength(1);
    const chart = banks.exhibits[0];
    expect(chart.kind).toBe("bars");
    if (chart.kind !== "bars") throw new Error("expected a chart");
    expect(chart.label).toBe("Median fee at banks, by size");
    expect(chart.rows).toEqual([
      { label: "Small", value: 30, shown: "$30" },
      { label: "Large", value: 35, shown: "$35" },
    ]);
    // The table under the chart holds its figures, so it joins the chart's exhibit.
    expect(chart.table?.rows).toHaveLength(2);
  });

  it("keeps lists and later paragraphs in order, never as the finding", () => {
    const state = brief.sections[1];
    expect(state.finding).toBe("State medians run from $25 to $35.");
    expect(state.notes).toHaveLength(2);
    expect(state.notes[0].startsWith("- ")).toBe(true);
    expect(state.exhibits).toEqual([]);
  });

  it("labels a standalone table from its columns", () => {
    const states = brief.sections[2];
    expect(states.finding).toBeNull();
    expect(states.exhibits[0].label).toBe("Institutions, lowest, median and highest, by state");
  });

  it("holds the method section apart for the disclosure", () => {
    expect(brief.sections.map((s) => s.title)).not.toContain("How these numbers are built");
    expect(brief.method).toEqual({
      title: "How these numbers are built",
      blocks: ["Each institution counts once.", "A group is shown only with 20 institutions."],
    });
  });

  it("gives each section a unique anchor", () => {
    expect(brief.sections.map((s) => s.id)).toEqual([
      "banks-the-larger-the-bank-the-higher-the-fee",
      "the-state-matters-less-than-the-institution",
      "every-state-with-enough-data",
    ]);
    const twice = parseArticle("## Fees\n\nOne.\n\n## Fees\n\nTwo.");
    expect(twice.sections.map((s) => s.id)).toEqual(["fees", "fees-2"]);
  });

  it("uses an article's own Source line for its section", () => {
    const sourced = parseArticle("## Revenue\n\nRevenue rose.\n\nSource: FDIC call reports, 2026-Q2.");
    expect(sourced.sections[0].source).toBe("FDIC call reports, 2026-Q2.");
    expect(sourced.sections[0].notes).toEqual([]);
  });

  it("reads an article with no headings as a lead alone", () => {
    const plain = parseArticle("Just text.\n\nMore text.");
    expect(plain.lead).toEqual(["Just text.", "More text."]);
    expect(plain.sections).toEqual([]);
    expect(plain.method).toBeNull();
    expect(plain.asOf).toBeNull();
  });

  it("drops a chart with no usable rows rather than drawing an empty one", () => {
    expect(parseArticle("## A\n\n```bars Empty\nNo | x | y\n```").sections[0].exhibits).toEqual([]);
  });
});

describe("article helpers", () => {
  it("folds a table only when it would hide more than two rows", () => {
    expect(tableFolds(7)).toBe(false);
    expect(tableFolds(8)).toBe(true);
  });

  it("labels a one-column table by its heading", () => {
    expect(tableLabel({ head: ["State"], rows: [] })).toBe("State");
  });

  it("summarizes the opening without Markdown marks, cut at a word", () => {
    expect(plainSummary(parseArticle("Overdraft fees **fell** in [Texas](https://x.test)."))).toBe("Overdraft fees fell in Texas.");
    expect(plainSummary(parseArticle("one two three four"), 9)).toBe("one two...");
  });

  it("dates the byline in UTC", () => {
    expect(bylineDate("2026-10-08T23:30:00Z")?.label).toBe("October 8, 2026");
    expect(bylineDate(null)).toBeNull();
    expect(bylineDate("not a date")).toBeNull();
  });
});
