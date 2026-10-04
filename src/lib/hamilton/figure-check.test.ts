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
