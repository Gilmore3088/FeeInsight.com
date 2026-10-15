import { describe, expect, it } from "vitest";
import { checkNarrativeFigures, extractFigures } from "./figure-check";

describe("extractFigures", () => {
  it("reads dollars (with separators and scale words) and percentages", () => {
    const figures = extractFigures("Revenue of $1.2 million, a $35.00 fee, $2,500 wires and 12.5% growth (3 percent).");
    expect(figures.map((f) => [f.kind, f.value])).toEqual([
      ["usd", 1_200_000],
      ["usd", 35],
      ["usd", 2500],
      ["pct", 12.5],
      ["pct", 3],
    ]);
  });
});

describe("checkNarrativeFigures", () => {
  const data = { institution_amount: 35.5, peer_median: 30, peer_p75: 36, ratio: 0.142, revenue: 1_234_567 };

  it("matches payload values within the figure's own rounding", () => {
    expect(checkNarrativeFigures("Your $35.50 fee vs a $30 median; p75 is $36.", data).unmatched).toEqual([]);
    expect(checkNarrativeFigures("About $36 against peers.", data).unmatched).toEqual([]);
    expect(checkNarrativeFigures("Service charges were $1.2 million.", data).unmatched).toEqual([]);
  });

  it("accepts differences, percent differences and ratios expressed as percentages", () => {
    expect(checkNarrativeFigures("$5.50 above the median, 18.3% higher; fee ratio 14.2%.", data).unmatched).toEqual([]);
  });

  it("flags figures the data does not support", () => {
    expect(checkNarrativeFigures("Peers average $42 and fees rose 27%.", data).unmatched).toEqual(["$42", "27%"]);
  });

  it("reports nothing to check when the narrative has no figures", () => {
    expect(checkNarrativeFigures("Pricing is competitive.", data)).toEqual({ checked: 0, unmatched: [] });
  });
});

describe("figures that are not the data's to trace (#1425)", () => {
  const data = { institution_amount: 35, peer_median: 30 };

  it("accepts a figure the reader's question names, and nothing else from outside the data", () => {
    const text = "At $40, the fee you asked about would sit above the $30 peer median; $47.13 is not in the data.";
    expect(checkNarrativeFigures(text, data).unmatched).toEqual(["$40", "$47.13"]);
    expect(checkNarrativeFigures(text, data, { question: "Would a $40 overdraft fee be high?" }).unmatched).toEqual(["$47.13"]);
  });

  it("accepts an asset-tier bound stated as a size range or threshold", () => {
    for (const text of [
      "Among banks with $1 billion to $10 billion in assets, the median is $30.",
      "Peers in the $300M to $1B tier charge $30.",
      "Banks with between $1 billion and $10 billion in total assets charge $30.",
      "Banks under $1 billion in assets charge $30.",
      "Among institutions with assets above $10 billion, the median is $30.",
    ]) expect(checkNarrativeFigures(text, data).unmatched, text).toEqual([]);
  });

  it("still holds a tier bound stated as money, even beside the word assets (review of #1425)", () => {
    for (const [text, unmatched] of [
      ["The bank earned $1 billion in fee income. Its assets are large.", ["$1 billion"]],
      ["The bank earned $1 billion in fees, with assets of $10 billion.", ["$1 billion", "$10 billion"]],
      ["Overdraft revenue hit $1B in the community tier.", ["$1B"]],
      ["Banks under $1 billion in assets charge a $1 billion overdraft fee.", ["$1 billion"]],
      ["The bank has $10 billion in assets.", ["$10 billion"]],
      // Only the tiers' own bounds: $5 billion is not one.
      ["Banks with $5 billion in assets charge $30.", ["$5 billion"]],
    ] as const) expect(checkNarrativeFigures(text, data).unmatched, text).toEqual(unmatched);
  });
});
