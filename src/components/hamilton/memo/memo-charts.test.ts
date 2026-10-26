import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LABEL_ROW_WIDTHS, PriceStrip, dollarTicks, labelRows, labelWidthPx } from "./memo";

describe("labelRows", () => {
  const w = (labels: string[]) => labels.map(labelWidthPx);

  it("keeps labels that are far apart on one row and moves close ones down", () => {
    expect(labelRows([10, 50, 90], w(["$10", "$50", "$90"]), 900)).toEqual([0, 0, 0]);
    expect(labelRows([60, 63, 66, 90], w(["$60", "$63", "$66", "$90"]), 900)).toEqual([0, 1, 0, 0]);
    expect(labelRows([60, 62, 64, 90], w(["$60", "$62", "$64", "$90"]), 900)).toEqual([0, 1, 2, 0]);
  });

  it("splits Today $30 and $25 onto two rows on a phone, and keeps one row on a desktop (#1896)", () => {
    // $25 and Today $30 on a $0 to $36 axis: centres about 70.8% and 84.7%.
    const xs = [70.8, 84.7];
    const widths = w(["$25", "Today $30"]);
    expect(labelRows(xs, widths, 232)).toEqual([0, 1]);
    expect(labelRows(xs, widths, 340)).toEqual([0, 1]);
    expect(labelRows(xs, widths, 896)).toEqual([0, 0]);
  });

  it("never lets two labels on a row overlap, at any width the rows are computed for", () => {
    const labels = ["No fee", "$5", "$10", "Today $27", "$29", "$30", "$32", "$35"];
    const xs = [1, 15, 29, 76, 81, 84, 90, 98];
    const widths = w(labels);
    for (const width of [...LABEL_ROW_WIDTHS, 1000]) {
      const rows = labelRows(xs, widths, width);
      for (let i = 0; i < xs.length; i++) {
        for (let j = i + 1; j < xs.length; j++) {
          if (rows[i] !== rows[j]) continue;
          const gap = (xs[j] / 100) * width - widths[j] / 2 - ((xs[i] / 100) * width + widths[i] / 2);
          expect(gap).toBeGreaterThanOrEqual(6);
        }
      }
    }
  });

  it("over-estimates a label's width rather than under-estimating it", () => {
    // Widths measured in Chromium with the app's CSS and Geist (polish-screens, #1896).
    expect(labelWidthPx("Today $30")).toBeGreaterThanOrEqual(71);
    expect(labelWidthPx("$25")).toBeGreaterThanOrEqual(35);
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

  it("sets each label's row for every chart width, and the band's height to match", () => {
    const html = renderToStaticMarkup(
      createElement(PriceStrip, {
        amounts: [],
        marks: [
          { label: "Today $30", price: 30, today: true },
          { label: "$25", price: 25 },
          { label: "$35", price: 35 },
        ],
      }),
    );
    expect(html).toContain("@container");
    // Below 512px Today $30 drops under $25 and $35 (two rows); from 512px up all three fit on one.
    expect(html).toContain('style="--h0:2;--h1:2;--h2:2;--h3:1;--h4:1;--h5:1"');
    expect(html).toMatch(/--r0:1;--r1:1;--r2:1;--r3:0;--r4:0;--r5:0">Today \$30</);
    expect(html).toContain("@4xl:top-[calc(var(--r5)*1.6rem)]");
  });

  it("names the tallest bar when there are amounts", () => {
    expect(text([25, 30, 30])).toContain("(3 in all; the tallest bar is 2 at $30)");
  });
});
