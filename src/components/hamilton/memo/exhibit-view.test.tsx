import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AnswerView, ExhibitView, axisFor, placeLabels } from "./exhibit-view";

const src = { label: "Bank Fee Index", asOf: "2026-10-01" };

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
