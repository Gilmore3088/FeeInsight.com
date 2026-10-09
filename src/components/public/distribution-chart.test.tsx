import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DistributionChart, buildHistogram } from "./distribution-chart";

describe("buildHistogram", () => {
  it("bins every institution exactly once", () => {
    const values = [0, 5, 25, 28, 29, 30, 30, 32, 35, 36];
    const bins = buildHistogram(values, 16);
    expect(bins.reduce((n, b) => n + b.count, 0)).toBe(values.length);
    expect(bins[0].low).toBe(0);
  });

  it("puts a far outlier in an open last bin instead of squeezing every bar into the first", () => {
    const values = [...Array.from({ length: 99 }, (_, i) => 20 + (i % 15)), 5000];
    const bins = buildHistogram(values, 16);
    const last = bins[bins.length - 1];
    expect(last.high).toBeNull();
    expect(last.count).toBe(1);
    expect(bins.filter((b) => b.count > 0).length).toBeGreaterThan(3);
  });
});

describe("DistributionChart", () => {
  it("renders its bars in the server HTML, not after hydration", () => {
    const html = renderToStaticMarkup(<DistributionChart values={[10, 20, 25, 30, 30, 35]} median={27.5} />);
    expect(html).toContain("<rect");
    expect(html).toContain("Median $27.50");
    expect(html).toContain("6 institutions in all");
  });

  it("titles both axes in visible text: institutions up the side, dollars along the bottom", () => {
    const html = renderToStaticMarkup(<DistributionChart values={[10, 20, 25, 30, 30, 35]} median={27.5} />);
    expect(html).toContain(">Institutions</p>");
    expect(html).toContain(">Fee amount (US dollars)</p>");
  });

  it("says so when there are too few institutions instead of drawing empty axes", () => {
    const html = renderToStaticMarkup(<DistributionChart values={[10, 20]} median={null} />);
    expect(html).not.toContain("<svg");
    expect(html).toContain("Not enough institutions");
  });
});
