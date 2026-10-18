import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/app/landing-serif", () => ({ homeSerif: { variable: "serif-var" } }));

import { PeerExplorerSection, peerSetChipLabel } from "./peer-explorer-section";
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
        { amount: 5, name: "Basic Checking Monthly Service Fee", conditions: "Waived with direct deposit" },
        { amount: 11.9, name: "Premier Checking Monthly Service Fee", conditions: null },
      ],
    },
    overdraft: { amount: 35 },
  }),
  peers: [
    inst(2, "Pine State Bank", 2.1e9, { monthly_maintenance: { amount: 14.5 }, overdraft: { amount: 30 } }),
    inst(3, "Summit Bank", 7.3e9, { monthly_maintenance: { amount: 16.2 } }, "Quincy"),
    inst(4, "First US Bank", 2.2e9, { monthly_maintenance: { amount: 5.9 } }),
  ],
  charterType: "bank",
  medians: { monthly_maintenance: { median: 10, peers: 3 } },
};

const SETS: InstitutionPeerSets = {
  options: [
    { key: "nearest", label: "The 25 banks closest in assets", count: 25 },
    { key: "metro", label: "Banks with branches in the Tallahassee, FL metro", count: 9 },
  ],
  selected: { key: "nearest", label: "The 25 banks closest in assets", lines: [] },
  selectedFilters: { institutionIds: [2, 3, 4] },
};

function renderSection(initial = {}) {
  return render(
    <PeerExplorerSection sets={SETS} set={SET} hrefFor={(key) => `/institution/323?peers=${key}#peers`} initial={initial} isPro={false} />,
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
    expect(screen.getByText("3 peers selected · 3 publish this fee")).toBeTruthy();
  });

  it("shows the subject's fee, the median, the gap, and each price behind the middle value", () => {
    renderSection();
    const panel = screen.getByRole("complementary");
    expect(within(panel).getByText("$8.45")).toBeTruthy();
    expect(within(panel).getByText("$1.55 below the peer median")).toBeTruthy();
    expect(within(panel).getByText("The middle of 2 prices: see each account")).toBeTruthy();
    expect(within(panel).getByText("Basic Checking Monthly Service Fee")).toBeTruthy();
    expect(within(panel).getByText("Waived with direct deposit")).toBeTruthy();
  });

  it("keeps a peer selected from the matrix across views and highlights a finding's peers", () => {
    renderSection({ view: "matrix" });
    fireEvent.click(screen.getByRole("button", { name: "Summit Bank" }));
    const panel = screen.getByRole("complementary");
    expect(within(panel).getByText("Selected peer")).toBeTruthy();
    expect(within(panel).getByText("$6.20 above the peer median")).toBeTruthy();
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

  it("carries the set's peers to Hamilton from both actions", () => {
    renderSection();
    const explore = screen.getByRole("link", { name: /Explore this peer set in Hamilton/ });
    const brief = screen.getByRole("link", { name: "Create a committee brief from this peer set" });
    const href = "/pro/settings?instId=323&peers=2%2C3%2C4&name=The+25+banks+closest+in+assets#peer-sets";
    expect(explore.getAttribute("href")).toBe(href);
    expect(brief.getAttribute("href")).toBe(href);
  });

  it("has short chip names", () => {
    expect(peerSetChipLabel({ key: "nearest", label: "x", count: 25 })).toBe("25 closest in assets");
    expect(peerSetChipLabel({ key: "metro", label: "x" })).toBe("Home metro");
  });
});
