// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const trackMock = vi.fn();
vi.mock("@vercel/analytics", () => ({ track: (...args: unknown[]) => trackMock(...args) }));

import type { DimensionBreakdown, FeeCategorySummary } from "@/lib/data-store/fees";
import type { PublicStatsSummary } from "@/lib/public-stats";
import { DistrictMap, MyFeesChart, PriceSlider, dotLayout, firstDistrict, gapWords, openingPrice, stepOf } from "./landing-charts";
import { demoViews } from "./landing-demo";
import { buildHomeData, type SampleView } from "./landing-shared";
import { buildScenario } from "./subscribe/scenario";

const summary = { freshnessLabel: "Data refreshed Oct 14, 2026" } as PublicStatsSummary;
const overdraft = {
  fee_category: "overdraft",
  institution_count: 321,
  min_amount: 0,
  max_amount: 50,
  median_amount: 30,
  p25_amount: 25,
  p75_amount: 33,
} as FeeCategorySummary;
const district = (n: number, median: number | null, count = 40): DimensionBreakdown => ({
  dimension_value: `District ${n}`,
  count,
  min_amount: 5,
  max_amount: 45,
  avg_amount: 28,
  median_amount: median,
});
const districts = [district(1, 30, 168), district(2, null, 3), district(3, 32, 97), district(11, 30, 238), district(12, 25, 269)];
const data = buildHomeData(summary, [overdraft], districts, { scenario: buildScenario("Overdraft", overdraft) });

const panel = () => document.querySelector("[data-district-panel]") as HTMLElement;
const panelName = () => panel().querySelector("[data-panel-name]")?.textContent;
const group = (n: number) => document.querySelector(`[data-district="${n}"]`) as SVGGElement;

afterEach(() => {
  document.body.innerHTML = "";
  trackMock.mockReset();
});

describe("district map", () => {
  it("opens on the highest median and shades each district from live medians", () => {
    expect(firstDistrict(data.districts)).toBe(3);
    expect([stepOf(25, 25, 32), stepOf(30, 25, 32), stepOf(32, 25, 32), stepOf(30, 30, 30)]).toEqual([1, 4, 5, 3]);
    render(<DistrictMap data={data} />);
    expect(panelName()).toBe("Philadelphia");
    expect(group(3).querySelector("path")?.getAttribute("fill")).toBe("var(--fi-viz-5)");
    expect(group(12).querySelector("path")?.getAttribute("fill")).toBe("var(--fi-viz-1)");
    expect(screen.getByRole("group", { name: /Map of the 12 Federal Reserve districts/ })).toBeTruthy();
  });

  it("updates the panel when a district is clicked, and links to its research page", () => {
    render(<DistrictMap data={data} />);
    fireEvent.click(group(11));
    expect(panelName()).toBe("Dallas");
    expect(group(11).getAttribute("aria-pressed")).toBe("true");
    expect(group(3).getAttribute("aria-pressed")).toBe("false");
    const p = within(panel());
    expect(p.getByText("The same as the national median")).toBeTruthy();
    expect(panel().textContent).toContain("238 institutions publish an overdraft fee");
    expect(p.getByRole("link").getAttribute("href")).toBe("/research/district/11");
    fireEvent.click(group(12));
    expect(panel().querySelector("[data-panel-gap]")?.textContent).toBe(gapWords(25 - 30));
    expect(gapWords(-5)).toBe("$5.00 below the national median");
  });

  it("selects with Enter, moves with the arrow keys and previews on hover", () => {
    render(<DistrictMap data={data} />);
    fireEvent.keyDown(group(12), { key: "Enter" });
    expect(panelName()).toBe("San Francisco");
    expect(trackMock).toHaveBeenCalledWith("demo_district_picked", { district: 12 });
    fireEvent.mouseEnter(group(1));
    expect(panelName()).toBe("Boston");
    fireEvent.mouseLeave(group(1));
    expect(panelName()).toBe("San Francisco");
  });

  it("is one tab stop: only the chosen district is in the tab order, and it follows the arrow keys", () => {
    render(<DistrictMap data={data} />);
    const stops = () => [...document.querySelectorAll("[data-district]")].filter((g) => g.getAttribute("tabindex") === "0").map((g) => g.getAttribute("data-district"));
    expect(stops()).toEqual(["3"]);
    fireEvent.keyDown(group(3), { key: "ArrowRight" });
    expect(stops()).toHaveLength(1);
    expect(stops()[0]).not.toBe("3");
    expect(document.activeElement?.getAttribute("data-district")).toBe(stops()[0]);
  });

  it("announces a pick, never a hover", () => {
    render(<DistrictMap data={data} />);
    const live = () => document.querySelector("[data-district-announce]");
    expect(live()?.getAttribute("aria-live")).toBe("polite");
    expect(panel().getAttribute("aria-live")).toBeNull();
    expect(live()?.textContent).toContain("Philadelphia");
    fireEvent.mouseEnter(group(1));
    expect(panelName()).toBe("Boston");
    expect(live()?.textContent).toContain("Philadelphia");
    fireEvent.click(group(11));
    expect(live()?.textContent).toContain("Dallas");
  });

  it("marks a thin district with no median and says so, with a legend entry", () => {
    render(<DistrictMap data={data} />);
    expect(group(2).querySelector("path")?.getAttribute("fill")).toBe("var(--fi-viz-none)");
    expect(group(2).getAttribute("aria-label")).toContain("too few institutions for a median");
    fireEvent.click(group(2));
    expect(panelName()).toBe("New York");
    expect(panel().textContent).toContain("Too few institutions here for a median.");
    expect(panel().querySelector("[data-panel-bars]")).toBeNull();
    expect(document.querySelector("[data-map-legend]")?.textContent).toContain("Too few institutions");
  });

  it("shades by institutions on request, and keeps the median colors where medians are plotted", () => {
    render(<DistrictMap data={data} />);
    const bar = () => (panel().querySelector("[data-panel-bars] span.block") as HTMLElement).style.background;
    const medianBar = bar();
    fireEvent.click(screen.getByRole("radio", { name: "Institutions" }));
    expect(group(12).querySelector("path")?.getAttribute("fill")).toBe("var(--fi-viz-5)");
    expect(group(2).querySelector("path")?.getAttribute("fill")).toBe("var(--fi-viz-1)");
    // Philadelphia's bar and dot plot its median, so they keep the median ramp's top step.
    expect(bar()).toBe(medianBar);
    expect(medianBar).toBe("var(--fi-viz-5)");
  });

  it("moves the shade-by radio group with the arrow keys, one tab stop", () => {
    render(<DistrictMap data={data} />);
    const median = screen.getByRole("radio", { name: "Median fee" });
    const inst = screen.getByRole("radio", { name: "Institutions" });
    expect([median.tabIndex, inst.tabIndex]).toEqual([0, -1]);
    fireEvent.keyDown(median, { key: "ArrowRight" });
    expect(inst.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(inst);
    expect([median.tabIndex, inst.tabIndex]).toEqual([-1, 0]);
    fireEvent.keyDown(inst, { key: "ArrowRight" });
    expect(median.getAttribute("aria-checked")).toBe("true");
  });

  it("leaves the map out of the demo when no district figures were read, and opens on My fees", () => {
    const views = demoViews(buildHomeData(summary, [overdraft], null)).map((v) => v.key);
    expect(views[0]).toBe("fees");
    expect(views).not.toContain("map");
    expect(demoViews(data)[0].key).toBe("map");
  });
});

const sample: SampleView = {
  institutionName: "Sample Bank",
  competitors: 29,
  fees: [{ key: "wire_intl_outgoing", label: "Wire Transfer (Int'l Out)", amount: 75, quote: "Outgoing International Fee | $75", readOn: "2026-10-03" }],
  rows: [
    { key: "overdraft", label: "Overdraft (OD)", amount: 35, median: 35, p25: 33, p75: 36, competitors: 19, position: "in_market" },
    { key: "wire_intl_outgoing", label: "Wire Transfer (Int'l Out)", amount: 75, median: 50, p25: 45, p75: 50, competitors: 16, position: "above_market" },
    { key: "paper_statement", label: "Paper Statement", amount: 2, median: 3, p25: 3, p75: 5, competitors: 10, position: "below_market" },
  ],
};

describe("my fees", () => {
  it("opens the fee furthest from its median, and a clicked bar opens its own", () => {
    render(<MyFeesChart sample={sample} freshness={summary.freshnessLabel} />);
    const detail = () => document.querySelector("[data-fee-detail]")?.textContent ?? "";
    expect(detail()).toContain("$75.00");
    expect(detail()).toContain("Outgoing International Fee | $75");
    fireEvent.click(document.querySelector('[data-fee="paper_statement"]') as HTMLElement);
    expect(detail()).toContain("$2.00");
    expect(detail()).toContain("Below the local middle half");
    expect(detail()).toContain("middle half of 10 local competitors");
    expect(detail()).not.toContain("Outgoing International");
  });

  it("puts the fee card before the bars, so a phone shows it above them", () => {
    render(<MyFeesChart sample={sample} freshness={summary.freshnessLabel} />);
    const card = document.querySelector("[data-fee-detail]") as HTMLElement;
    const firstBar = document.querySelector("[data-fee]") as HTMLElement;
    expect(card.compareDocumentPosition(firstBar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("try a price", () => {
  it("opens on a live price that lights at least one district", () => {
    // The national median passes San Francisco's $25.00.
    expect(openingPrice(overdraft as never, [30, 32, 30, 25])).toBe(30);
    // When no district median sits under the national median, the national p75 opens.
    expect(openingPrice(overdraft as never, [30, 31])).toBe(33);
    render(<PriceSlider data={data} />);
    expect(screen.getByRole("slider").getAttribute("aria-valuetext")).toBe("$30.00");
    expect(document.querySelector("[data-price-slider]")?.textContent).toContain("1 of 4");
  });

  it("says the band is the middle half of every institution counted", () => {
    render(<PriceSlider data={data} />);
    expect(document.querySelector("[data-price-slider]")?.textContent).toContain("Middle half of 321 institutions");
  });

  it("stacks a district dot above a cluster it would touch on a phone", () => {
    const medians = [30, 30, 30, 30, 30, 30, 30, 30, 30, 29, 25, 32];
    const boxes = (width: number) =>
      dotLayout(medians, 50, width).map((l, i) => ({ x: (Math.round(medians[i] * 2) / 2 / 50) * width + l.dx, row: l.row }));
    for (const width of [330, 1000]) {
      const b = boxes(width);
      for (let i = 0; i < b.length; i++)
        for (let j = i + 1; j < b.length; j++) {
          if (b[i].row === b[j].row) expect(Math.abs(b[i].x - b[j].x)).toBeGreaterThanOrEqual(12);
        }
    }
  });

  it("moves the readout with the slider", () => {
    render(<PriceSlider data={data} />);
    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "31" } });
    expect(document.querySelector("[data-price]")?.textContent).toBe("$31.00");
    const text = document.querySelector("[data-price-slider]")?.textContent ?? "";
    expect(text).toContain("+$1.00");
    // Medians under $31: Boston, Dallas and San Francisco; Philadelphia ($32) is not, and New York has none.
    expect(text).toContain("3 of 4");
  });
});
