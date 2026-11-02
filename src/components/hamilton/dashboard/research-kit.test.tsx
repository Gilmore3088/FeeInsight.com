import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

import { KpiCard, PriceHistogram, SortableTable, StateTileMap, LABEL_SORT_KEY, pageOf, sortRows, type SortableRow } from "./index";
import { binLabel } from "./PriceHistogram";
import { tileShade, US_TILE_GRID } from "./StateTileMap";

describe("KpiCard additions", () => {
  it("marks the subject's card and pairs its pill's colour with a mark", () => {
    const { container } = render(<KpiCard label="Test Bank" value="$35" pill={{ text: "Above", position: "above" }} highlight />);
    expect(container.querySelector(".hd-kpi--subject")).not.toBeNull();
    expect(screen.getByText("▲ Above")).toBeTruthy();
  });
});

describe("SortableTable paging, name sort and positions", () => {
  const rows: SortableRow[] = Array.from({ length: 30 }, (_, i) => ({
    id: String(i),
    label: `Test Bank ${String(i).padStart(2, "0")}`,
    values: { price: i },
    positions: { price: i > 20 ? "above" : i < 5 ? "below" : "in_range" },
    highlight: i === 3,
    href: `/x/${i}`,
    links: i === 0 ? [{ label: "Fee schedule ↗", href: "https://example.test/s.pdf" }] : [],
  }));

  it("pages, finds the subject's row and sorts by name", () => {
    expect(pageOf(30, 12, 9)).toEqual({ pages: 3, page: 2 });
    expect(sortRows(rows, LABEL_SORT_KEY, "descending")[0].label).toBe("Test Bank 29");
    render(<SortableTable caption="Prices" columns={[{ key: "price", label: "Price", format: "money" }]} rows={rows} defaultSort={{ key: "price", direction: "descending" }} pageSize={12} findLabel="Find Test Bank 03" labelSortable linksHeader="Source" />);
    expect(screen.getByText("Page 1 of 3")).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(13);
    expect(screen.queryByText("Test Bank 03")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Find Test Bank 03" }));
    expect(screen.getByText("Page 3 of 3")).toBeTruthy();
    const subject = screen.getByText("Test Bank 03").closest("tr")!;
    expect(subject.className).toContain("hd-subject");
    expect(within(subject).getByText("(below)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Page 3 of 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Institution/ }));
    expect(screen.getByText("Page 1 of 3")).toBeTruthy();
    expect(screen.getAllByRole("columnheader")[0].getAttribute("aria-sort")).toBe("ascending");
    expect(screen.getByRole("link", { name: "Fee schedule ↗" }).getAttribute("href")).toBe("https://example.test/s.pdf");
  });
});

describe("PriceHistogram", () => {
  const bins = Array.from({ length: 20 }, (_, i) => ({ from: i * 2.5, to: i === 19 ? null : (i + 1) * 2.5, count: i === 12 ? 8 : i === 13 ? 4 : 1 }));
  it("labels the image, starts on the subject's band and reads a hovered band", () => {
    expect(binLabel(bins[0])).toBe("$0 to $2.49");
    expect(binLabel(bins[19])).toBe("$47.50 and up");
    render(<PriceHistogram bins={bins} total={30} p25={30} median={31} p75={33} subjectBin={13} subjectName="Test Bank" label="Overdraft prices" />);
    expect(screen.getByRole("img", { name: "Overdraft prices" })).toBeTruthy();
    expect(screen.getByText("$32.50 to $34.99 · Test Bank")).toBeTruthy();
    fireEvent.mouseEnter(screen.getByRole("button", { name: "$30 to $32.49: 8 institutions" }));
    expect(screen.getByText("8 institutions (27%)")).toBeTruthy();
  });
  it("says so when nothing is published", () => {
    render(<PriceHistogram bins={[]} total={0} p25={null} median={null} p75={null} label="x" />);
    expect(screen.getByText("No institution in this scope publishes this fee.")).toBeTruthy();
  });
});

describe("StateTileMap", () => {
  it("places every state and DC, shades by median and reads the chosen state against the subject", () => {
    expect(Object.keys(US_TILE_GRID)).toHaveLength(51);
    expect(tileShade(25, 25, 35)).toBe(0);
    expect(tileShade(35, 25, 35)).toBe(4);
    const tiles = [
      { code: "FL", name: "Florida", n: 40, median: 30 },
      { code: "GA", name: "Georgia", n: 22, median: 35 },
      { code: "AL", name: "Alabama", n: 4, median: null },
    ];
    render(<StateTileMap tiles={tiles} feeName="Overdraft" subjectState="FL" subject={{ name: "Test Bank", price: 36 }} hrefs={{ GA: "/pro/intelligence?ga" }} openLabel="Show" />);
    expect(screen.getByRole("group", { name: /States by median overdraft price/ })).toBeTruthy();
    expect(screen.getByText("▲ +$6")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Georgia: median $35, 22 institutions" }));
    expect(screen.getByRole("button", { name: /^Georgia/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("▲ +$1")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Show Georgia" }).getAttribute("href")).toBe("/pro/intelligence?ga");
    fireEvent.focus(screen.getByRole("button", { name: "Alabama: too few for a median, 4 institutions" }));
    expect(screen.getAllByText("Too few").some((el) => el.tagName === "DD")).toBe(true);
  });
});
