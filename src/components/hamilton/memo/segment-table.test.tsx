import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SegmentTable, fmtAssets, type SegmentData } from "./segment-table";

function member(i: number, amount: number, assets: number, cap: number | null = null) {
  return { institutionId: i, institutionName: `Bank ${i}`, amount, stateCode: "TX", documentUrls: [`https://example.com/${i}.pdf`], totalAssets: assets, dailyCap: cap };
}

const data: SegmentData = {
  segment: { label: "institutions with $10 billion or more in assets" },
  institutionsInSegment: 140,
  members: Array.from({ length: 18 }, (_, i) => member(i + 1, i % 3 === 0 ? 0 : 25 + i, 3_000_000_000 - i * 100_000_000, i % 2 ? 3 : null)),
  band: { p25: 15, median: 29, p75: 35, n: 18 },
  zeroCount: 6,
  withDailyCap: 9,
  problem: null,
  source: { label: "Bank Fee Index, published fee schedules", asOf: "2026-10-01" },
};

describe("SegmentTable", () => {
  it("formats assets stored in thousands", () => {
    expect(fmtAssets(3_400_000_000)).toBe("$3.4T");
    expect(fmtAssets(48_300_000)).toBe("$48.3B");
    expect(fmtAssets(950_000)).toBe("$950M");
    expect(fmtAssets(null)).toBe("—");
  });

  it("lists the largest first with assets, fee, cap and source, the rest folded", () => {
    const html = renderToStaticMarkup(<SegmentTable data={data} own={32} ownLabel="Example Bank" />);
    expect(html).toContain("Exhibit 2");
    expect(html).toContain("The 18 institutions with $10 billion or more in assets that publish this fee, largest first");
    expect(html).toContain("Example Bank");
    expect(html).toContain("Bars in terra charge less than Example Bank.");
    expect(html).not.toContain("charge less than you");
    expect(html).toContain("$3.0T");
    expect(html).toContain("3 a day");
    expect(html).toContain("https://example.com/1.pdf");
    expect(html).toContain("The other 3");
    expect(html).toContain(">140<");
  });

  it("draws nothing when the slice could not be built", () => {
    expect(renderToStaticMarkup(<SegmentTable data={{ ...data, problem: "No institution fits.", members: [] }} own={32} ownLabel="You" />)).toBe("");
  });
});
