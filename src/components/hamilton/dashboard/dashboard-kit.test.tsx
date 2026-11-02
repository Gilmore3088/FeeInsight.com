import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

import {
  DashboardCard,
  FeePositionChart,
  FilterChips,
  KpiCard,
  PositionDonut,
  SegmentedControl,
  SortableTable,
  TrendChart,
  columnExtremes,
  countPositions,
  donutArcs,
  feePosition,
  formatFigure,
  furthestAbove,
  signedMoney,
  sortFeeRows,
  sortRows,
  yearOnYear,
  type FeePositionDatum,
  type TrendSeries,
} from "./index";

const fee = (key: string, yours: number, band: Partial<FeePositionDatum> = {}): FeePositionDatum => ({
  key, name: key[0].toUpperCase() + key.slice(1), yours, n: 12, min: 0, max: 50, p25: 20, median: 25, p75: 30, ...band,
});

describe("format", () => {
  it("prints fees, large dollars and percents", () => {
    expect(formatFigure(35, "money")).toBe("$35");
    expect(formatFigure(7.95, "money")).toBe("$7.95");
    expect(formatFigure(22_900_000, "dollars")).toBe("$22.9M");
    expect(formatFigure(4_450_000_000, "dollars")).toBe("$4.45B");
    expect(formatFigure(1.534, "percent")).toBe("1.53%");
    expect(formatFigure(64.73, "percent1")).toBe("64.7%");
    expect(formatFigure(null, "money")).toBe("—");
    expect(signedMoney(10)).toBe("+$10");
    expect(signedMoney(-2.5)).toBe("−$2.50");
  });

  it("places a fee only against a band", () => {
    expect(feePosition(35, { p25: 20, p75: 30 })).toBe("above");
    expect(feePosition(25, { p25: 20, p75: 30 })).toBe("in_range");
    expect(feePosition(10, { p25: 20, p75: 30 })).toBe("below");
    expect(feePosition(10, { p25: null, p75: null })).toBe("too_few");
  });
});

describe("DashboardCard", () => {
  it("is a section labelled by its heading, with a footnote", () => {
    const html = renderToStaticMarkup(<DashboardCard title="Peer scorecard" titleId="t1" footnote="Source: call reports.">x</DashboardCard>);
    expect(html).toContain('aria-labelledby="t1"');
    expect(html).toContain('<h2 id="t1" class="hd-card-title">Peer scorecard</h2>');
    expect(html).toContain("Source: call reports.");
    expect(html).not.toContain("<details");
  });

  it("folds the caveats under the source line in a collapsed details element", () => {
    const html = renderToStaticMarkup(<DashboardCard title="Fees" footnote="Source: schedules." footnoteDetails="A median needs 10 institutions.">x</DashboardCard>);
    expect(html).toContain('<p class="hd-card-note">Source: schedules.</p><details class="hd-more"><summary>About these figures</summary><div class="hd-card-note">A median needs 10 institutions.</div></details>');
  });
});

describe("SegmentedControl and FilterChips", () => {
  it("press one option at a time and report it", () => {
    const onChange = vi.fn();
    render(<SegmentedControl label="Compare with" options={[{ value: "a", label: "Texas" }, { value: "b", label: "Peer group" }]} onChange={onChange} />);
    const group = screen.getByRole("group", { name: "Compare with" });
    expect(within(group).getByRole("button", { name: "Texas" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(group).getByRole("button", { name: "Peer group" }));
    expect(onChange).toHaveBeenCalledWith("b");
    expect(within(group).getByRole("button", { name: "Peer group" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("chips show their counts", () => {
    render(<FilterChips label="Show" options={[{ value: "all", label: "All", count: 3 }, { value: "above", label: "▲ Above", count: 1 }]} />);
    expect(screen.getByRole("button", { name: "▲ Above 1" }).getAttribute("aria-pressed")).toBe("false");
  });
});

describe("KpiCard", () => {
  it("is a toggle button when selectable, a panel otherwise", () => {
    const onSelect = vi.fn();
    render(<KpiCard label="Return on assets" value="1.53%" sub="▲ 0.07 pts on the year" subTone="good" spark={[1.4, null, 1.5, 1.53]} selected onSelect={onSelect} />);
    const button = screen.getByRole("button", { name: /Return on assets/ });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalled();
    expect(renderToStaticMarkup(<KpiCard label="Assets" value="$4.45B" />)).not.toContain("<button");
  });
});

describe("TrendChart", () => {
  const series: TrendSeries[] = [
    { key: "fees", tab: "Service charges", title: "Service charges by quarter", format: "dollars", values: [100, 110, 120, 130, 150], better: "up", change: "percent" },
    { key: "eff", tab: "Efficiency", title: "Efficiency ratio", format: "percent1", values: [66, 65, 64, 63, 64.5], better: "down", change: "points" },
  ];
  const quarters = ["Q2 2025", "Q3 2025", "Q4 2025", "Q1 2026", "Q2 2026"];

  it("reads the change on the year with an arrow and its tone", () => {
    expect(yearOnYear(series[0], 4)).toEqual({ text: "▲ 50.0% on the year", tone: "good" });
    expect(yearOnYear(series[1], 4)).toEqual({ text: "▼ 1.50 pts on the year", tone: "good" });
    expect(yearOnYear(series[0], 2).text).toBe("No year-earlier quarter on file");
  });

  it("labels the chart image, reads out the hovered quarter and switches measure", () => {
    render(<TrendChart series={series} quarters={quarters} />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("Service charges by quarter by quarter: Q2 2025 $100");
    fireEvent.focus(screen.getByRole("button", { name: "Q3 2025: $110" }));
    expect(screen.getByText("$110", { selector: ".hd-kpi-value" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Efficiency" }));
    expect(screen.getByRole("heading", { name: "Efficiency ratio" })).toBeTruthy();
    expect(screen.getByText("64.5%")).toBeTruthy();
  });
});

describe("FeePositionChart", () => {
  const rows = [fee("overdraft", 35), fee("wire", 25), fee("stop", 10), fee("rare", 5, { n: 3, p25: null, median: null, p75: null, min: 4, max: 9 })];

  it("counts, sorts and ranks rows", () => {
    expect(countPositions(rows)).toEqual({ above: 1, in_range: 1, below: 1, too_few: 1 });
    expect(sortFeeRows(rows, "gap").map((r) => r.key)).toEqual(["overdraft", "wire", "stop", "rare"]);
    expect(sortFeeRows(rows, "amount")[0].key).toBe("overdraft");
    expect(furthestAbove(rows).map((r) => r.key)).toEqual(["overdraft"]);
  });

  it("filters by position, expands a row and shows a compare peer", () => {
    render(<FeePositionChart rows={rows} groupLabel="institutions in Texas" compare={{ name: "Lakeside Test Bank", values: { overdraft: 30 } }} />);
    expect(screen.getByText(/Lakeside Test Bank/)).toBeTruthy();
    expect(screen.getByText("3 publish")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "▲ Above 1" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    const row = screen.getByRole("button", { expanded: false });
    fireEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("$20 to $30")).toBeTruthy();
    expect(screen.getByText("+$10")).toBeTruthy();
  });

  it("says when no fee matches", () => {
    render(<FeePositionChart rows={[fee("wire", 25)]} groupLabel="peers" filter="above" />);
    expect(screen.getByText("No fees match this filter.")).toBeTruthy();
  });
});

describe("PositionDonut", () => {
  it("draws one arc per position and toggles from its legend", () => {
    const arcs = donutArcs({ above: 1, in_range: 2, below: 1 });
    expect(arcs.map((a) => a.key)).toEqual(["above", "in_range", "below"]);
    expect(arcs[1].offset).toBeCloseTo(-(2 * Math.PI * 40) / 4);
    const onSelect = vi.fn();
    render(<PositionDonut counts={{ above: 1, in_range: 2, below: 1 }} selected="above" onSelect={onSelect} />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("1 fees above the middle half, 2 in it, 1 below");
    fireEvent.click(screen.getByRole("button", { name: /above the middle half/ }));
    expect(onSelect).toHaveBeenCalledWith(null);
    fireEvent.click(screen.getByRole("button", { name: /below the middle half/ }));
    expect(onSelect).toHaveBeenCalledWith("below");
  });
});

describe("SortableTable", () => {
  const rows = [
    { id: "1", label: "Harbor Ridge Test Bank", values: { assets: 4e9, od: 35 }, highlight: true },
    { id: "2", label: "Lakeside Test Bank", values: { assets: 2e9, od: 30 } },
    { id: "3", label: "Pine Test Bank", values: { assets: 9e9, od: null } },
  ];
  const columns = [{ key: "assets", label: "Assets", format: "dollars" as const }, { key: "od", label: "Overdraft", format: "money" as const, mark: true }];

  it("sorts with empty values last and finds the marks", () => {
    expect(sortRows(rows, "od", "ascending").map((r) => r.id)).toEqual(["2", "1", "3"]);
    expect(columnExtremes(rows, "od")).toEqual({ hi: 35, lo: 30 });
    expect(columnExtremes(rows.slice(0, 1), "od")).toBeNull();
  });

  it("sets aria-sort, marks highs and lows and selects a row to compare", () => {
    const onRowSelect = vi.fn();
    render(<SortableTable caption="Peers" columns={columns} rows={rows} defaultSort={{ key: "assets", direction: "descending" }} onRowSelect={onRowSelect} />);
    const header = screen.getByRole("columnheader", { name: /Assets/ });
    expect(header.getAttribute("aria-sort")).toBe("descending");
    fireEvent.click(within(header).getByRole("button"));
    expect(header.getAttribute("aria-sort")).toBe("ascending");
    expect(screen.getByText("(highest)")).toBeTruthy();
    expect(screen.getByText("(lowest)")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Harbor Ridge Test Bank" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Lakeside Test Bank" }));
    expect(onRowSelect).toHaveBeenCalledWith("2");
  });
});
