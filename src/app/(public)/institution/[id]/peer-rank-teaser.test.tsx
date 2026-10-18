import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
import { PeerRankTeaser, peerGroupLabel, peerSetFinding } from "./peer-rank-teaser";
import type { InstitutionPeerRank, InstitutionPeerSets } from "@/lib/data-store/peer-fee-rank";

const RANK: InstitutionPeerRank = {
  scope: "state",
  state_code: "TX",
  fed_district: 11,
  charter_type: "bank",
  lines: [{ key: "overdraft", own: 35, lower: 30, same: 4, higher: 8, peers: 42 }],
};

const SETS: InstitutionPeerSets = {
  options: [
    { key: "state", label: "Banks in TX" },
    { key: "size", label: "Banks with $300M to $1B in assets" },
  ],
  selected: {
    key: "state",
    label: "Banks in TX",
    lines: [
      { key: "overdraft", own: 35, ownPrices: 1, median: 30, peers: 42, lower: 30, same: 4, higher: 8 },
      { key: "monthly_maintenance", own: 10, ownPrices: 3, median: null, peers: 6, lower: 0, same: 0, higher: 0 },
    ],
  },
};

describe("PeerRankTeaser", () => {
  it("leads with one finding that names the group, and shows each median over its peer count", () => {
    render(<PeerRankTeaser sets={SETS} hrefFor={(key) => `/institution/1?peers=${key}#peers`} />);
    expect(screen.getByRole("heading", { name: "Overdraft and maintenance against peers" })).toBeInTheDocument();
    expect(screen.getByText("Its overdraft fee, $35, is $5 above the $30 median of the 42 banks in TX that publish it.")).toBeInTheDocument();
    expect(screen.getByText("of 42 peers")).toBeInTheDocument();
    expect(screen.getByText("Too few to compare")).toBeInTheDocument();
    expect(screen.getByText("6 peers publish it")).toBeInTheDocument();
    expect(screen.queryByText("Peers that publish it")).not.toBeInTheDocument();
    expect(screen.getByText(/30 of 42 publish a lower fee, 4 the same and 8 a higher one/)).toBeInTheDocument();
    expect(screen.getByText("middle of 3 prices")).toBeInTheDocument();
  });

  it("shows the gap from the peer median as a chip, and not compared without a median", () => {
    render(<PeerRankTeaser sets={SETS} hrefFor={(key) => `/institution/1?peers=${key}#peers`} />);
    expect(screen.getByText("$5 above")).toBeInTheDocument();
    expect(screen.getByText("Not compared")).toBeInTheDocument();
  });

  it("puts the peer group picker above the results and ends on one Hamilton action", () => {
    const { container } = render(
      <PeerRankTeaser sets={SETS} hrefFor={(key) => `/institution/1?peers=${key}#peers`} hamiltonHref="/subscribe?inst=1#pro" />,
    );
    const picker = screen.getByRole("navigation", { name: "Peer group" });
    const results = container.querySelector("figure")!;
    expect(picker.compareDocumentPosition(results) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Peer group" })).toHaveValue("state");
    expect(screen.getByRole("link", { name: "See every peer in Hamilton" })).toHaveAttribute("href", "/subscribe?inst=1#pro");
  });

  it("switches group from the phone's select without moving the page, with a plain GET form as the fallback", () => {
    const { container } = render(<PeerRankTeaser sets={SETS} hrefFor={(key) => `/institution/1?fee=overdraft&peers=${key}#peers`} />);
    const form = container.querySelector("form")!;
    expect(form).toHaveAttribute("action", "/institution/1#peers");
    expect(form.querySelector('input[type="hidden"][name="fee"]')).toHaveValue("overdraft");
    fireEvent.change(screen.getByRole("combobox", { name: "Peer group" }), { target: { value: "size" } });
    expect(push).toHaveBeenCalledWith("/institution/1?fee=overdraft&peers=size#peers", { scroll: false });
  });

  it("keeps one short source line and the counting rules in the details", () => {
    render(<PeerRankTeaser sets={SETS} hrefFor={(key) => `/institution/1?peers=${key}#peers`} />);
    expect(screen.getByText(/^Source: .+, published fee schedules\.$/)).toBeInTheDocument();
    expect(screen.getByText("How peers are chosen and counted")).toBeInTheDocument();
    expect(screen.getByText("This institution is not counted in its own group.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /report/i })).not.toBeInTheDocument();
  });

  it("offers each peer set as a short chip, the full name in the caption and the current one marked", () => {
    render(<PeerRankTeaser sets={SETS} hrefFor={(key) => `/institution/1?peers=${key}#peers`} />);
    expect(screen.getByRole("link", { name: "Asset size" })).toHaveAttribute("href", "/institution/1?peers=size#peers");
    expect(screen.getByRole("link", { name: "State" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Banks in TX", { selector: "figcaption span" })).toBeInTheDocument();
  });

  it("shows an empty fee as none found", () => {
    const none: InstitutionPeerSets = {
      ...SETS,
      selected: { ...SETS.selected, lines: [{ ...SETS.selected.lines[0], own: null, ownPrices: 0 }, SETS.selected.lines[1]] },
    };
    render(<PeerRankTeaser sets={none} hrefFor={(key) => `/institution/1?peers=${key}#peers`} />);
    expect(screen.getByText("None found")).toBeInTheDocument();
  });

  it("compares a fee with several prices at their middle, never as its fee", () => {
    expect(
      peerSetFinding("Banks with $1B to $10B in assets", [
        { key: "monthly_maintenance", own: 12, ownPrices: 3, median: 10, peers: 41, lower: 30, same: 1, higher: 10 },
      ]),
    ).toBe("Compared at $12, the middle of its monthly maintenance prices, it sits $2 above the $10 median of the 41 banks with $1B to $10B in assets that publish it.");
    expect(
      peerSetFinding("The 25 banks closest in assets", [
        { key: "overdraft", own: 25, ownPrices: 1, median: 30, peers: 24, lower: 2, same: 0, higher: 22 },
      ]),
    ).toBe("Its overdraft fee, $25, is $5 below the $30 median of the 24 of the 25 banks closest in assets that publish it.");
  });

  it("says about the same within 1% and never forces a finding", () => {
    expect(peerSetFinding("Banks in TX", [{ key: "overdraft", own: 30.2, ownPrices: 1, median: 30, peers: 9, lower: 4, same: 0, higher: 5 }])).toMatch(
      /about the same as the \$30 median of the 9 banks in TX/,
    );
    expect(peerSetFinding("Banks in TX", [{ key: "overdraft", own: 30, ownPrices: 1, median: null, peers: 3, lower: 0, same: 0, higher: 0 }])).toBe(
      "Too few peers in this group publish its fees for a median.",
    );
  });

  it("labels district peers for the findings", () => {
    expect(peerGroupLabel({ ...RANK, scope: "district", charter_type: "credit_union" })).toBe("Dallas Fed district credit unions");
    expect(peerGroupLabel(RANK)).toBe("Texas banks");
  });
});
