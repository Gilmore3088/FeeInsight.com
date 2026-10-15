// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DimensionBreakdown, FeeCategorySummary } from "@/lib/data-store/fees";
import type { PublicStatsSummary } from "@/lib/public-stats";
import { DistrictMap, MyFeesChart, PriceSlider, firstDistrict, gapWords, stepOf } from "./landing-charts";
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
    expect(group(1).getAttribute("tabindex")).toBe("0");
    fireEvent.keyDown(group(12), { key: "Enter" });
    expect(panelName()).toBe("San Francisco");
    fireEvent.mouseEnter(group(1));
    expect(panelName()).toBe("Boston");
    fireEvent.mouseLeave(group(1));
    expect(panelName()).toBe("San Francisco");
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

  it("shades by institutions on request", () => {
    render(<DistrictMap data={data} />);
    fireEvent.click(screen.getByRole("radio", { name: "Institutions" }));
    expect(group(12).querySelector("path")?.getAttribute("fill")).toBe("var(--fi-viz-5)");
    expect(group(2).querySelector("path")?.getAttribute("fill")).toBe("var(--fi-viz-1)");
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
});

describe("try a price", () => {
  it("moves the readout with the slider", () => {
    render(<PriceSlider data={data} />);
    const slider = screen.getByRole("slider");
    expect(slider.getAttribute("aria-valuetext")).toBe("$25.00");
    fireEvent.change(slider, { target: { value: "31" } });
    expect(document.querySelector("[data-price]")?.textContent).toBe("$31.00");
    const text = document.querySelector("[data-price-slider]")?.textContent ?? "";
    expect(text).toContain("+$1.00");
    // Medians under $31: Boston, Dallas and San Francisco; Philadelphia ($32) is not, and New York has none.
    expect(text).toContain("3 of 4");
  });
});
