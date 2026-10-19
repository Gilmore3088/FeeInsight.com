import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { NationalIndicators } from "@/lib/data-store/economic-context";
import { DATA_GROUPS, DISTRICT_LIST_ANCHOR, DISTRICT_REPORT_LINKS, EconomicData, nationalIndicatorTiles } from "./economic-data";

const PUBLIC_APP = path.resolve(__dirname, "..");

/** The page file for a public path, allowing route groups such as (index) and (directory). */
function hasPublicPage(href: string): boolean {
  let dirs = [PUBLIC_APP];
  for (const segment of href.split("/").filter(Boolean)) {
    const next: string[] = [];
    for (const dir of dirs) {
      const expand = (d: string): string[] => {
        const out: string[] = [];
        if (existsSync(path.join(d, segment))) out.push(path.join(d, segment));
        const dynamic = readdirSync(d).find((n) => /^\[[^\].]+\]$/.test(n));
        if (/^\d+$/.test(segment) && dynamic) out.push(path.join(d, dynamic));
        for (const group of readdirSync(d).filter((n) => /^\(.+\)$/.test(n))) out.push(...expand(path.join(d, group)));
        return out;
      };
      next.push(...expand(dir));
    }
    dirs = next;
  }
  const withPage = (d: string): boolean =>
    existsSync(path.join(d, "page.tsx")) ||
    readdirSync(d)
      .filter((n) => /^\(.+\)$/.test(n))
      .some((g) => withPage(path.join(d, g)));
  return dirs.some(withPage);
}

const INDICATORS: NationalIndicators = {
  unemployment: { series_id: "UNRATE", latest: { date: "2026-09-01", value: 4.3 }, year_ago: null },
  fed_funds: { series_id: "FEDFUNDS", latest: { date: "2026-09-01", value: 4.08 }, year_ago: null },
  cpi_all_items: {
    series_id: "CUUR0000SA0",
    latest: { date: "2026-09-01", value: 330 },
    year_ago: { date: "2025-09-01", value: 320 },
  },
  cpi_bank_services: { series_id: "CUUR0000SS68021", latest: { date: "2026-09-01", value: 101 }, year_ago: null },
};

describe("EconomicData", () => {
  it("groups the cards by what a reader wants, each with a line and a named source", () => {
    render(<EconomicData indicators={INDICATORS} />);
    for (const group of DATA_GROUPS) {
      const heading = screen.getByRole("heading", { level: 3, name: group.title });
      const list = heading.parentElement!.querySelector("ul")!;
      expect(within(list).getAllByRole("link")).toHaveLength(group.cards.length);
      for (const card of group.cards) {
        expect(card.line.length).toBeGreaterThan(0);
        expect(card.source.length).toBeGreaterThan(0);
        const link = within(list).getByText(card.title).closest("a")!;
        expect(link.getAttribute("href")).toBe(card.href);
        expect(link.textContent).toContain(card.line);
        expect(link.textContent).toContain(`Source: ${card.source}`);
      }
    }
    expect(DATA_GROUPS.map((g) => g.title)).toEqual(["Fees and prices", "Bank finances and markets", "Economy and policy", "Sources and method"]);
  });

  it("links only to public pages that exist, or to anchors on the hub", () => {
    const hrefs = [...DATA_GROUPS.flatMap((g) => g.cards.map((c) => c.href)), ...DISTRICT_REPORT_LINKS.map((d) => d.href)];
    for (const href of hrefs) {
      if (href.startsWith("#")) {
        expect(["#explore", DISTRICT_LIST_ANCHOR]).toContain(href);
        continue;
      }
      expect(href.startsWith("/"), href).toBe(true);
      expect(href).not.toMatch(/^\/(pro|admin)\b/);
      expect(hasPublicPage(href), href).toBe(true);
    }
    // The paid-only analyses show signed-out readers an upgrade gate, so the hub doesn't send them there.
    expect(hrefs).not.toContain("/research/fee-revenue-analysis");
    expect(hrefs).not.toContain("/research/market-concentration");
  });

  it("lists all 12 district reports under the anchor the district cards point to", () => {
    const { container } = render(<EconomicData indicators={null} />);
    const list = container.querySelector(DISTRICT_LIST_ANCHOR)!;
    expect(list).toBeTruthy();
    const links = within(list as HTMLElement).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(Array.from({ length: 12 }, (_, i) => `/research/district/${i + 1}`));
    expect(links[0].textContent).toContain("Boston");
  });

  it("names the agencies and keeps visible copy free of em-dashes and pipeline names", () => {
    const { container } = render(<EconomicData indicators={INDICATORS} />);
    const text = container.textContent ?? "";
    for (const agency of ["FDIC", "NCUA", "BLS", "BEA", "Federal Reserve", "CFPB", "Census"]) expect(text).toContain(agency);
    expect(text).not.toContain("—");
    expect(text).not.toMatch(/\b(Atlas|Magellan|Rosetta|Knox|Darwin|Hamilton|Deming|Hoovie)\b/);
  });
});

describe("national indicator strip", () => {
  it("shows each figure with its month and source, and leaves out a change it can't compute", () => {
    const tiles = nationalIndicatorTiles(INDICATORS);
    expect(tiles.map((t) => [t.label, t.value, t.date, t.source])).toEqual([
      ["U.S. unemployment rate", "4.3%", "Sep 2026", "BLS"],
      ["Federal funds rate, monthly average", "4.08%", "Sep 2026", "Federal Reserve Board"],
      ["Consumer prices, 12-month change", "+3.1%", "Sep 2026", "BLS CPI"],
    ]);
  });

  it("says the indicators are unavailable instead of showing zeros", () => {
    expect(nationalIndicatorTiles(null)).toEqual([]);
    render(<EconomicData indicators={null} />);
    expect(screen.getByText(/The latest national indicators aren.t available right now/)).toBeTruthy();
    expect(screen.queryByRole("term")).toBeNull();
  });
});
