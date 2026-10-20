import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/use-session-chrome", () => ({ useSessionChrome: () => null }));
vi.mock("@/app/landing-serif", () => ({ homeSerif: { variable: "serif-var" } }));

import { PeerExplorerSection, peerSetChipLabel, peerSetHrefs } from "./peer-explorer-section";
import type { InstitutionPeerSets } from "@/lib/data-store/peer-fee-rank";
import type { ExplorerInstitution, PeerExplorerSet } from "@/lib/peer-explorer";

const inst = (id: number, name: string, assets: number, fees: ExplorerInstitution["fees"], city = "Tallahassee"): ExplorerInstitution => ({
  id, name, assets, city, state: "FL", fees,
});

const SET: PeerExplorerSet = {
  subject: inst(323, "Capital City Bank", 4.4e9, {
    monthly_maintenance: {
      amount: 8.45,
      prices: [
        { amount: 5, name: "Basic Checking Monthly Service Fee", account: "Basic Checking", conditions: "Waived with direct deposit" },
        { amount: 11.9, name: "Premier Checking Monthly Service Fee", account: "Premier Checking", conditions: null },
      ],
    },
    overdraft: { amount: 35 },
  }),
  peers: [
    inst(2, "Pine State Bank", 2.1e9, { monthly_maintenance: { amount: 14.5 }, overdraft: { amount: 30 } }),
    inst(3, "Summit Bank", 7.3e9, { monthly_maintenance: { amount: 16.2, source: { url: "https://summit.example/fees.pdf", published: "2026-09-02" } } }, "Quincy"),
    inst(4, "First US Bank", 2.2e9, { monthly_maintenance: { amount: 5.9 } }),
  ],
  charterType: "bank",
  medians: { monthly_maintenance: { median: 10, peers: 3 } },
  asOf: "2026-10-17",
};

const SETS: InstitutionPeerSets = {
  options: [
    { key: "nearest", label: "The 25 banks closest in assets", count: 25 },
    { key: "metro", label: "Banks with branches in the Tallahassee, FL metro", count: 9 },
  ],
  selected: { key: "nearest", label: "The 25 banks closest in assets", lines: [] },
  selectedFilters: { institutionIds: [2, 3, 4] },
};

function renderSection(initial = {}, extra: Partial<typeof SET> = {}) {
  return render(
    <PeerExplorerSection sets={SETS} set={{ ...SET, ...extra }} hrefFor={(key) => `/institution/323?peers=${key}#peers`} initial={initial} />,
  );
}

describe("PeerExplorerSection", () => {
  it("names the institution with its assets, why these peers belong and the coverage apart", () => {
    renderSection();
    expect(screen.getByRole("heading", { name: "Among its peers" })).toBeTruthy();
    expect(screen.getByText("Capital City Bank · $4.4B in assets")).toBeTruthy();
    // The selected nearest set is labelled with the live count of peers on the page.
    expect(screen.getAllByText("3 closest in assets").length).toBeGreaterThan(0);
    expect(screen.getByText("Banks only")).toBeTruthy();
    expect(screen.getByText("$2.1B to $7.3B in assets")).toBeTruthy();
    expect(screen.getByText("Banks of similar size, for comparing published prices. All are headquartered in Florida.")).toBeTruthy();
    expect(screen.getAllByText("Pricing peers").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Market competitors").length).toBeGreaterThan(0);
    expect(screen.getByRole("meter", { name: "3 of 3 peers publish this fee" })).toBeTruthy();
  });

  it("lists exactly who is in the set and which fees each publishes", () => {
    renderSection();
    expect(screen.getByText("See the 3 institutions")).toBeTruthy();
    const list = screen.getByRole("table", { name: /The institutions in this peer set/ });
    expect(within(list).getByText("First US Bank")).toBeTruthy();
    expect(within(list).getAllByText("Publishes Monthly maintenance").length).toBe(4);
    expect(within(list).getAllByText("Overdraft not published").length).toBe(2);
  });

  it("defines one threshold, about the same within 1%, where peers are explained", () => {
    renderSection();
    expect(screen.getByText(/About the same: within 1% of the median, in this section and everywhere on this page/)).toBeTruthy();
    expect(screen.queryByText(/within 10%/)).toBeNull();
  });

  it("says when a large set shows its closest 50 and that medians use every peer", () => {
    renderSection({ view: "matrix" }, { whole: { peers: 1204, publish: { monthly_maintenance: 900 }, states: ["FL", "GA"], assets: { min: 1e8, max: 9e8 } } });
    expect(screen.getByText("Showing the 3 closest in assets of 1,204 peers; medians use all 1,204.")).toBeTruthy();
    expect(screen.getByText("See the 3 institutions shown")).toBeTruthy();
  });

  it("shows the subject's fee, the median, the gap, and each price behind the middle value", () => {
    renderSection();
    const panel = screen.getByRole("complementary");
    expect(within(panel).getByText("$8.45")).toBeTruthy();
    // Below the median is blue, as in the mockups; above is red.
    const gap = within(panel).getByText(/\$1\.55 below the peer median/);
    expect(gap.textContent).toBe("▼ $1.55 below the peer median");
    expect(gap.style.color).toBe("var(--fi-viz-above)");
    expect(within(panel).getByText("Peers publishing")).toBeTruthy();
    expect(within(panel).getByText("Comparison price: middle of 2 account prices, not a fee anyone is charged")).toBeTruthy();
    expect(within(panel).getByText("Basic Checking Monthly Service Fee")).toBeTruthy();
    expect(within(panel).getByText("Waived with direct deposit")).toBeTruthy();
  });

  it("keeps a peer selected from the matrix across views and highlights a finding's peers", () => {
    renderSection({ view: "matrix" });
    fireEvent.click(screen.getByRole("button", { name: "Summit Bank" }));
    const panel = screen.getByRole("complementary");
    expect(within(panel).getByText("Selected peer")).toBeTruthy();
    expect(within(panel).getByText(/\$6\.20 above the peer median/).style.color).toBe("var(--fi-viz-below)");
    expect(window.location.search).toContain("peer=3");
    fireEvent.click(screen.getByRole("tab", { name: "Locations" }));
    expect(within(screen.getByRole("complementary")).getByText("Summit Bank")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Summit Bank, $16.20" }).getAttribute("aria-pressed")).toBe("true");
    // Everyone else charges less than Summit Bank: the finding names them.
    const finding = screen.getByRole("button", { name: "3 peers charge less" });
    fireEvent.click(finding);
    expect(finding.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Pine State Bank, $14.50" }).style.opacity).toBe("1");
  });

  it("previews the set to bring to Hamilton, claiming only that Hamilton opens for the institution", () => {
    renderSection();
    expect(screen.queryByRole("region", { name: "Before you open Hamilton" })).toBeNull();
    expect(screen.queryByText(/briefing/i)).toBeNull();
    // The button names the institution Hamilton opens for, never a set it cannot load.
    for (const control of [...screen.queryAllByRole("button"), ...screen.queryAllByRole("link")]) {
      expect(control.textContent ?? "").not.toMatch(/open this (peer )?set/i);
    }
    fireEvent.click(screen.getByRole("button", { name: /^Open Capital City Bank in Hamilton/ }));
    const preview = screen.getByRole("region", { name: "Before you open Hamilton" });
    // Hamilton's settings page reads only instId today: the panel never says the link loads the set.
    expect(within(preview).getByText("Hamilton opens for Capital City Bank. Add this set under Peer sets:")).toBeTruthy();
    expect(preview.textContent).not.toMatch(/This link opens|opens Hamilton with|briefing/i);
    expect(within(preview).getByText("The 25 banks closest in assets")).toBeTruthy();
    expect(within(preview).getByText("3: Pine State Bank, Summit Bank and First US Bank")).toBeTruthy();
    expect(within(preview).getByText("Monthly maintenance")).toBeTruthy();
    expect(within(preview).getByText("Published prices against the peer median of 3 publishing peers")).toBeTruthy();
    expect(within(preview).getByText("Oct 17, 2026")).toBeTruthy();
    expect(within(preview).getByRole("link", { name: /Continue to Hamilton/ }).getAttribute("href")).toBe(
      "/pro/settings?instId=323&peers=2%2C3%2C4&name=The+25+banks+closest+in+assets&fee=monthly_maintenance&asof=2026-10-17#peer-sets",
    );
    expect(screen.queryByRole("link", { name: /Compare local deposit competitors/ })).toBeNull();
  });

  it("offers the local competitor comparison only for the home metro set", () => {
    render(
      <PeerExplorerSection
        sets={{ ...SETS, selected: { key: "metro", label: "Banks with branches in the Tallahassee, FL metro", lines: [] } }}
        set={SET}
        hrefFor={(key) => `/institution/323?peers=${key}#peers`}
        initial={{}}
      />,
    );
    expect(screen.getByRole("link", { name: /Compare local deposit competitors/ })).toBeTruthy();
  });

  it("summarises the matrix, opens a cell's evidence and compares ticked rows", () => {
    renderSection({ view: "matrix" });
    expect(screen.getByText(/Of 1 compared fee, Capital City Bank is above the peer median on 0, below on 1 and about the same on 0\./)).toBeTruthy();
    fireEvent.click(screen.getByTitle(/^Summit Bank, Monthly maintenance: \$16\.20/));
    expect(screen.getByText("Summit Bank: evidence")).toBeTruthy();
    expect(screen.getByRole("link", { name: "The bank's fee schedule" }).getAttribute("href")).toBe("https://summit.example/fees.pdf");
    expect(screen.getByText(/in the index since Sep 2, 2026/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Compare Summit Bank" }));
    expect(screen.getByText("Tick one more institution to compare side by side.")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Compare Pine State Bank" }));
    expect(screen.getByRole("region", { name: "Side-by-side comparison" })).toBeTruthy();
  });

  it("switches matrix cells to differences from the median", () => {
    renderSection({ view: "matrix" });
    fireEvent.click(screen.getByRole("radio", { name: /Difference/ }));
    expect(screen.getAllByText("+$6.20").length).toBeGreaterThan(0);
    expect(screen.getAllByText("-$1.55").length).toBeGreaterThan(0);
  });

  it("leads with a peer pricing snapshot in fixed words, with the facts and the caveat", () => {
    renderSection();
    const snapshot = screen.getByRole("region", { name: /Monthly maintenance is \$1\.55 \(16%\) below the median of similar-sized banks\./ });
    expect(within(snapshot).getByText("Peer pricing snapshot")).toBeTruthy();
    expect(within(snapshot).getByText("Compared at $8.45, the middle of its two prices, against a peer median of $10 among 3 publishing peers.")).toBeTruthy();
    expect(within(snapshot).getByText("Its two checking prices are $5 and $11.90.")).toBeTruthy();
    expect(within(snapshot).getByText("$8.45 is a comparison price, not a fee anyone is charged.")).toBeTruthy();
    expect(within(snapshot).getByText("This describes published pricing only. Account mix, waivers and actual fee revenue are not represented.")).toBeTruthy();
  });

  it("reads broadly aligned when the comparison price is within 1% of the median", () => {
    renderSection({}, { medians: { monthly_maintenance: { median: 8.48, peers: 16 } } });
    expect(screen.getByRole("region", { name: "Monthly maintenance is broadly aligned with similar-sized banks: within 1% of their median." })).toBeTruthy();
  });

  it("draws each account price apart from the hollow comparison price, beside the peer dots and the median", () => {
    const { container } = renderSection();
    const accounts = [...container.querySelectorAll('[data-mark="account-price"]')];
    expect(accounts.map((mark) => mark.getAttribute("data-amount"))).toEqual(["5", "11.9"]);
    // The comparison price is one hollow marker, apart from the account prices, never filled like them.
    const comparison = container.querySelectorAll('[data-mark="comparison-price"]');
    expect(comparison.length).toBe(1);
    expect(comparison[0].querySelector("rect")?.getAttribute("fill")).toBe("var(--fi-surface-0)");
    expect(accounts[0].querySelector("rect")?.getAttribute("fill")).toBe("var(--fi-ink)");
    expect(container.querySelectorAll('[data-mark="peer"]').length).toBe(3);
    expect(container.querySelector('[data-mark="median"]')?.textContent).toBe("Peer median $10");
    expect(screen.getByText("Capital City Bank: comparison price $8.45")).toBeTruthy();
    expect(screen.getByText("the middle of its two prices, not a fee anyone is charged")).toBeTruthy();
    expect(screen.getByText("Basic Checking $5")).toBeTruthy();
    expect(screen.getByText("Its comparison price, the middle of its prices: not a fee anyone is charged")).toBeTruthy();
    expect(screen.queryByText(/comparison value|midpoint/i)).toBeNull();
    // The subject is never the variance red or blue.
    expect(container.innerHTML).not.toMatch(/fi-brick|fill-brick|text-brick|border-brick/);
  });

  it("draws a single published price as one filled marker, with no comparison price", () => {
    const single = { ...SET, subject: { ...SET.subject, fees: { monthly_maintenance: { amount: 9 } } } };
    const { container } = renderSection({}, { subject: single.subject });
    expect(container.querySelectorAll('[data-mark="account-price"]').length).toBe(0);
    expect(container.querySelectorAll('[data-mark="comparison-price"]').length).toBe(0);
    expect(container.querySelector('[data-mark="subject-price"] rect')?.getAttribute("fill")).toBe("var(--fi-ink)");
    expect(screen.queryByText(/comparison price/i)).toBeNull();
  });

  it("switches the roster to Pricing: the same institutions in the same order, with amounts, gaps and sources", () => {
    renderSection();
    const coverage = screen.getByRole("table", { name: /with the fees each publishes/ });
    const order = within(coverage).getAllByRole("rowheader").map((cell) => cell.textContent);
    fireEvent.click(screen.getByRole("radio", { name: "Pricing" }));
    const list = screen.getByRole("table", { name: /each one's monthly maintenance fee/ });
    expect(within(list).getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual(order);
    const summit = within(list).getByRole("row", { name: /Summit Bank/ });
    expect(within(summit).getByText("$16.20")).toBeTruthy();
    const gap = within(summit).getByText(/\+\$6\.20 \(\+62%\)/);
    expect(gap.style.color).toBe("var(--fi-viz-below)");
    expect(gap.textContent).toContain("▲");
    expect(within(summit).getByRole("link", { name: "Fee schedule" }).getAttribute("href")).toBe("https://summit.example/fees.pdf");
    expect(within(summit).getByText(/Sep 2, 2026/)).toBeTruthy();
    const subject = within(list).getByRole("row", { name: /Capital City Bank/ });
    expect(subject.textContent).toContain("$8.45†");
    expect(subject.textContent).toContain("Prices $5, $11.90");
    expect(screen.getByText(/† Comparison price: the middle of an institution's account prices, not a fee anyone is charged\./)).toBeTruthy();
  });

  it("keeps the fee, the selected institution and view settings across all four views", () => {
    renderSection();
    fireEvent.change(screen.getByRole("combobox", { name: "Fee type" }), { target: { value: "overdraft" } });
    fireEvent.click(screen.getByRole("tab", { name: "Fee matrix" }));
    fireEvent.click(screen.getByRole("button", { name: "Pine State Bank" }));
    for (const tab of ["Distribution", "Landscape", "Locations", "Fee matrix"]) {
      fireEvent.click(screen.getByRole("tab", { name: tab }));
      expect(screen.getByRole("combobox", { name: "Fee type" })).toHaveProperty("value", "overdraft");
      const panel = screen.getByRole("complementary");
      expect(within(panel).getByText("Selected peer")).toBeTruthy();
      expect(within(panel).getByText("Pine State Bank")).toBeTruthy();
      expect(within(panel).getByText("Overdraft")).toBeTruthy();
    }
    expect(window.location.search).toContain("pfee=overdraft");
    expect(window.location.search).toContain("peer=2");
  });

  it("says when the selected institution does not publish the fee, instead of dropping it silently", () => {
    renderSection({ peer: "3", fee: "overdraft" });
    expect(screen.getByText("Summit Bank does not publish an overdraft fee, so it is not on this chart.")).toBeTruthy();
  });

  it("carries a changed fee and view into the other peer-set links", () => {
    renderSection();
    fireEvent.change(screen.getByRole("combobox", { name: "Fee type" }), { target: { value: "overdraft" } });
    fireEvent.click(screen.getByRole("tab", { name: "Landscape" }));
    const metro = screen.getByRole("link", { name: "Home metro" });
    expect(metro.getAttribute("href")).toBe("/institution/323?peers=metro&pfee=overdraft&pview=landscape#peers");
  });

  it("titles an asset-band set as a pricing set apart from the financial cohort, with its actual range and a dated source", () => {
    const sizeSets: InstitutionPeerSets = {
      ...SETS,
      options: [...SETS.options, { key: "size", label: "Banks with $1B to $10B in assets", count: 468 }],
      selected: { key: "size", label: "Banks with $1B to $10B in assets", lines: [] },
    };
    render(<PeerExplorerSection sets={sizeSets} set={SET} hrefFor={(key) => `/institution/323?peers=${key}#peers`} initial={{}} />);
    expect(screen.getByText("Banks with $1B to $10B in assets that publish fees")).toBeTruthy();
    expect(screen.getByText(/A pricing set: it is not the financial cohort under Financial performance, which is drawn from Call Report filings in the band\./)).toBeTruthy();
    expect(screen.getByText("Actual range: $2.1B to $7.3B")).toBeTruthy();
    expect(screen.getByText(/published fee schedules, as of Oct 17, 2026\./)).toBeTruthy();
  });

  it("has short chip names", () => {
    expect(peerSetChipLabel({ key: "nearest", label: "x", count: 25 })).toBe("25 closest in assets");
    expect(peerSetChipLabel({ key: "metro", label: "x" })).toBe("Home metro");
  });
});

describe("peerSetHrefs", () => {
  it("links each set on the bare profile, keeping a fee focus", () => {
    expect(peerSetHrefs(323, null)("metro")).toBe("/institution/323?peers=metro#peers");
    expect(peerSetHrefs(323, "nsf")("state")).toBe("/institution/323?fee=nsf&peers=state#peers");
  });
});
