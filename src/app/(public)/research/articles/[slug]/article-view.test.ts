import { describe, expect, it } from "vitest";
import {
  METHOD_TITLE,
  articleTags,
  bylineDate,
  isEmptyCell,
  parseArticle,
  plainSummary,
  tableFolds,
  tableLabel,
  unsourcedSections,
} from "./article-view";

const FEE_SOURCE = "Bank Fee Index, from banks' and credit unions' own published fee schedules.";

// The shape the weekly fee article writes: an opening line, then sections of chart, table and one
// sentence, a prose section with a list, a long table, a revenue section, the method and "As of".
const ARTICLE = [
  "A single national number hides the pattern.",
  "## Banks: the larger the bank, the higher the fee",
  "```bars Median fee at banks, by size\nSmall | 30 | $30\nLarge | 35 | $35\n```",
  "| Bank size | Banks | Median fee |\n|---|---|---|\n| Small | 200 | $30 |\n| Large | 29 | $35 |",
  "Small banks sit at $30; large banks at $35.",
  "## The state matters less than the institution",
  "State medians run from $25 to $35.",
  "- **California** has the lowest median.\n- **Mississippi** has the highest.",
  "### Inside one state",
  "So it depends on where someone banks.",
  "## Every state with enough data",
  "| State | Institutions | Lowest | Median | Highest |\n|---|---|---|---|---|\n| [California](https://feeinsight.com/research/state/CA) | 87 | $0 | $25 | $50 |",
  "## Who collects the revenue",
  "Large banks took most of the revenue.",
  "| Bank size | Overdraft revenue |\n|---|---|\n| Large | $1.1 billion |",
  "## How these numbers are built",
  "Each institution counts once.",
  "### Size groups",
  "| Group | Floor |\n|---|---|\n| Small | 20 |",
  "As of October 2026.",
].join("\n\n");

describe("parseArticle", () => {
  const brief = parseArticle(ARTICLE, FEE_SOURCE);

  it("keeps the opening paragraph as the lead and the closing date for the byline", () => {
    expect(brief.lead).toEqual(["A single national number hides the pattern."]);
    expect(brief.asOf).toBe("October 2026");
  });

  it("lifts each section's first paragraph above its exhibit, and sources fee exhibits", () => {
    const [banks] = brief.sections;
    expect(banks.title).toBe("Banks: the larger the bank, the higher the fee");
    expect(banks.finding).toBe("Small banks sit at $30; large banks at $35.");
    expect(banks.notes).toEqual([]);
    expect(banks.source).toBe(FEE_SOURCE);
    const chart = banks.exhibits[0];
    if (chart.kind !== "bars") throw new Error("expected a chart");
    expect(chart.label).toBe("Median fee at banks, by size");
    expect(chart.rows).toEqual([
      { label: "Small", value: 30, shown: "$30" },
      { label: "Large", value: 35, shown: "$35" },
    ]);
    // The table under the chart holds its figures, so it joins the chart's exhibit.
    expect(chart.table?.rows).toHaveLength(2);
  });

  it("keeps lists, subheads and later paragraphs inside their section, never as the finding", () => {
    const state = brief.sections[1];
    expect(state.finding).toBe("State medians run from $25 to $35.");
    expect(state.notes).toEqual([
      "- **California** has the lowest median.\n- **Mississippi** has the highest.",
      "### Inside one state",
      "So it depends on where someone banks.",
    ]);
    expect(brief.sections.map((s) => s.title)).not.toContain("Inside one state");
    // No exhibit, no source line.
    expect(state.source).toBeNull();
  });

  it("labels a standalone table from its columns", () => {
    expect(brief.sections[2].exhibits[0].label).toBe("Institutions, lowest, median and highest, by state");
  });

  it("never credits non-fee figures to fee schedules, and flags them unsourced", () => {
    const revenue = brief.sections[3];
    expect(revenue.exhibits).toHaveLength(1);
    expect(revenue.source).toBeNull();
    expect(unsourcedSections(brief)).toEqual(["Who collects the revenue"]);
  });

  it("holds the method apart, its subheads as text and its tables as exhibits", () => {
    expect(brief.sections.map((s) => s.title)).not.toContain("How these numbers are built");
    expect(brief.method?.title).toBe("How these numbers are built");
    expect(brief.method?.blocks).toEqual(["Each institution counts once.", "### Size groups"]);
    expect(brief.method?.exhibits.map((e) => e.kind)).toEqual(["table"]);
  });

  it("matches only whole method titles", () => {
    for (const title of ["How these numbers are built", "Methodology", "About the data", "Data and methods", "How the figures were counted"]) {
      expect(METHOD_TITLE.test(title)).toBe(true);
    }
    for (const title of ["How the state compares", "How these fees changed", "Methodology changes in 2026", "How we see overdraft"]) {
      expect(METHOD_TITLE.test(title)).toBe(false);
    }
    expect(parseArticle("## How the state compares\n\nTexas sits at $30.").sections).toHaveLength(1);
  });

  it("gives each section a unique, prefixed anchor", () => {
    expect(brief.sections.map((s) => s.id)).toEqual([
      "s-banks-the-larger-the-bank-the-higher-the-fee",
      "s-the-state-matters-less-than-the-institution",
      "s-every-state-with-enough-data",
      "s-who-collects-the-revenue",
    ]);
    const twice = parseArticle("## Fees\n\nOne.\n\n## Fees\n\nTwo.");
    expect(twice.sections.map((s) => s.id)).toEqual(["s-fees", "s-fees-2"]);
  });

  it("uses an article's own Source line, in a section and before the first heading", () => {
    const sourced = parseArticle("## Revenue\n\nRevenue rose.\n\n| Q | Revenue |\n|---|---|\n| Q2 | $1 |\n\nSource: FDIC call reports, 2026-Q2.", FEE_SOURCE);
    expect(sourced.sections[0].source).toBe("FDIC call reports, 2026-Q2.");
    expect(sourced.sections[0].notes).toEqual([]);
    const lead = parseArticle("Opening.\n\n```bars Fees\nA | 1 | $1\n```\n\nSource: State fee filings.\n\n## Next\n\nMore.", FEE_SOURCE);
    expect(lead.leadExhibits.source).toBe("State fee filings.");
    expect(lead.leadExhibits.exhibits).toHaveLength(1);
  });

  it("captions an untitled chart with its section title", () => {
    const untitled = parseArticle("## Overdraft by size\n\n```bars\nA | 1 | $1\n```");
    expect(untitled.sections[0].exhibits[0].label).toBe("Overdraft by size");
    expect(parseArticle("```bars\nA | 1 | $1\n```").leadExhibits.exhibits[0].label).toBe("Chart");
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

  it("treats dashes and n/a as no figure", () => {
    expect(["-", "–", "n/a", "N/A", ""].every(isEmptyCell)).toBe(true);
    expect(isEmptyCell("$0")).toBe(false);
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

  it("reads fee tags from the stored JSON", () => {
    expect(articleTags('["overdraft","states"]')).toEqual(["overdraft", "states"]);
    expect(articleTags("not json")).toEqual([]);
    expect(articleTags(null)).toEqual([]);
  });
});
