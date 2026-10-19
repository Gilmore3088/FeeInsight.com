import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AnswerView, ExhibitView, axisFor, ownLabelStyle, placeLabels } from "./exhibit-view";

const src = { label: "Bank Fee Index", asOf: "2026-10-01" };

describe("ownLabelStyle (#2080)", () => {
  it("keeps the institution's label inside the track at any width, the axis ends included", () => {
    // At the axis maximum the label ends at the mark; at the minimum it starts at it.
    expect(ownLabelStyle(100)).toEqual({ left: "100%", transform: "translateX(-100%)" });
    expect(ownLabelStyle(0)).toEqual({ left: "0%", transform: "translateX(-0%)" });
    expect(ownLabelStyle(140)).toEqual({ left: "100%", transform: "translateX(-100%)" });
    expect(ownLabelStyle(65)).toEqual({ left: "65%", transform: "translateX(-65%)" });
  });

  it("renders a price at the top of the axis with its label ending at the mark, never past the frame", () => {
    const exhibit = {
      kind: "fee_position" as const,
      title: "Overdraft against peers",
      unit: "dollars" as const,
      own: 40,
      ownLabel: "Example Valley Credit Union",
      band: { label: "Peer group", p25: 20, median: 25, p75: 30, n: 18 },
      markers: [],
      sources: [src],
    };
    const html = renderToStaticMarkup(<ExhibitView exhibit={exhibit} />);
    expect(html).toMatch(/max-w-full truncate[^"]*" style="left:\d+(\.\d+)?%;transform:translateX\(-\d+(\.\d+)?%\)" title="Example Valley Credit Union \$40"/);
    expect(html).not.toContain("whitespace-nowrap text-xs font-semibold");
  });
});

describe("axisFor", () => {
  it("pads both ends and never goes below $0", () => {
    const a = axisFor([2, 3]);
    expect(a.lo).toBe(1);
    expect(a.hi).toBe(4);
    expect(axisFor([0, 30]).lo).toBe(0);
    expect(a.at(a.lo)).toBe(0);
    expect(a.at(a.hi)).toBe(100);
  });
});

describe("placeLabels", () => {
  it("keeps labels inside the track and stacks only the ones that would overlap", () => {
    const placed = placeLabels([
      { x: 2, width: 20 },
      { x: 10, width: 20 },
      { x: 60, width: 20 },
      { x: 99, width: 20 },
    ]);
    expect(placed[0]).toEqual({ left: 0, row: 0 });
    expect(placed[1].row).toBe(1);
    expect(placed[2].row).toBe(0);
    expect(placed[3].left).toBe(80);
  });
});

describe("AnswerView", () => {
  const answer = {
    feeCategory: "overdraft",
    headline: "Your $32 overdraft fee is $1 above the peer median.",
    claims: [{ text: "The middle half charge $28 to $35.", source: src, sampleSize: 18 }],
    drivers: [],
    exhibit: {
      kind: "fee_position" as const,
      title: "Overdraft against peers",
      unit: "dollars" as const,
      own: 32,
      ownLabel: "You",
      band: { label: "Peer group", p25: 28, median: 31, p75: 35, n: 18 },
      markers: [{ label: "Texas", scope: "state" as const, value: 30, n: 210 }],
      sources: [src],
    },
    question: { prompt: "About how many overdraft fees did you charge?", inputKind: "number" as const, fieldKey: "fee.overdraft.annual_items" },
    evidenceLevel: "market" as const,
  };

  it("leads with the headline, shows sample size, the exhibit, the question and the evidence", () => {
    const html = renderToStaticMarkup(<AnswerView answer={answer} questionAction="/pro/research" />);
    expect(html.indexOf("Your $32 overdraft fee")).toBeLessThan(html.indexOf("Overdraft against peers"));
    expect(html).toContain("n=18");
    expect(html).toContain("Texas: $30");
    expect(html).toContain('name="fee.overdraft.annual_items"');
    expect(html).toContain("Market data only");
    expect(html).not.toContain("font-mono");
  });

  it("says so when a competitor range is empty", () => {
    const html = renderToStaticMarkup(
      <ExhibitView exhibit={{ kind: "competitor_range", title: "Local", unit: "dollars", own: 30, ownLabel: "You", items: [], sources: [] }} />,
    );
    expect(html).toContain("No named competitor publishes this fee yet.");
  });

  it("won't draw a trend from one point", () => {
    const html = renderToStaticMarkup(
      <ExhibitView exhibit={{ kind: "trend", title: "Income", unit: "dollars", series: [{ label: "You", points: [{ date: "2026-06-30", value: 1 }] }], sources: [] }} />,
    );
    expect(html).toContain("Not enough points");
  });
});

describe("phone readings (Space Coast review, 2026-10-15)", () => {
  const position = {
    kind: "fee_position" as const,
    title: "Late payment",
    unit: "dollars" as const,
    own: 5,
    ownLabel: "First Example Credit Union",
    band: { label: "Peers", p25: 25, median: 25, p75: 25, n: 5 },
    markers: [
      { label: "Florida median", scope: "state" as const, value: 23.75, n: 69 },
      { label: "National median", scope: "national" as const, value: 22, n: 900 },
    ],
    sources: [],
  };

  it("names a one-price middle half once, and lists the market medians for a phone", () => {
    const html = renderToStaticMarkup(<ExhibitView exhibit={position} />);
    expect(html).toContain("middle half all at $25");
    expect(html).not.toContain("$25 to $25");
    expect(html).toContain('aria-label="Market medians"');
    expect(html).toMatch(/Florida <span[^>]*>\$23\.75<\/span>/);
  });

  it("keys only the sides competitors are actually on", () => {
    const html = renderToStaticMarkup(
      <ExhibitView exhibit={{ kind: "competitor_range", title: "Local", unit: "dollars", own: 5, ownLabel: "First Example Credit Union", items: [{ name: "A", amount: 10, url: null }, { name: "B", amount: 10, url: null }], sources: [] }} />,
    );
    expect(html).toContain("Charges more");
    expect(html).not.toContain("Charges less");
  });
});

describe("competitor range with several fees (#1931)", () => {
  it("shows a competitor's one fee as its price and several fees as their range with names", () => {
    const html = renderToStaticMarkup(
      <ExhibitView
        exhibit={{
          kind: "competitor_range",
          title: "Local",
          unit: "dollars",
          own: 160,
          ownLabel: "Subject",
          items: [
            { name: "A", amount: 120, url: null },
            { name: "B", amount: 162.5, url: null, several: { low: 150, high: 175, fees: [{ name: "Levy", amount: 150 }, { name: "Garnishment", amount: 175 }] } },
          ],
          sources: [],
        }}
      />,
    );
    expect(html).toContain("$120");
    expect(html).toContain("$150 to $175");
    expect(html).toContain("Levy $150; Garnishment $175");
    expect(html).not.toContain("$162.50");
  });
});
