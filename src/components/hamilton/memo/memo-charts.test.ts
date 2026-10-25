import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PriceStrip, dollarTicks, labelRows } from "./memo";

describe("labelRows", () => {
  it("keeps labels that are far apart on one row and moves close ones down", () => {
    expect(labelRows([10, 50, 90])).toEqual([0, 0, 0]);
    expect(labelRows([60, 63, 66, 90])).toEqual([0, 1, 2, 0]);
  });
});

describe("dollarTicks", () => {
  it("uses round steps with at most nine ticks", () => {
    expect(dollarTicks(36)).toEqual([0, 5, 10, 15, 20, 25, 30, 35]);
    expect(dollarTicks(6)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(dollarTicks(120).length).toBeLessThanOrEqual(9);
  });
});

describe("PriceStrip caption", () => {
  const text = (amounts: number[]) =>
    renderToStaticMarkup(createElement(PriceStrip, { amounts, marks: [{ label: "Today $30", price: 30, today: true }], scopeLabel: "Florida" }))
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ");

  it("says no institution publishes the fee when the group is empty, and never prints $-1", () => {
    const t = text([]);
    expect(t).toContain("None of the institutions in Florida publish this fee, so there are no bars.");
    expect(t).not.toContain("$-1");
  });

  it("names the tallest bar when there are amounts", () => {
    expect(text([25, 30, 30])).toContain("(3 in all; the tallest bar is 2 at $30)");
  });
});
