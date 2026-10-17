import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
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
      { key: "overdraft", own: 35, median: 30, peers: 42, lower: 30, same: 4, higher: 8 },
      { key: "monthly_maintenance", own: 10, median: null, peers: 6, lower: 0, same: 0, higher: 0 },
    ],
  },
};

describe("PeerRankTeaser", () => {
  it("leads with one finding and shows each median beside its peer count", () => {
    render(<PeerRankTeaser sets={SETS} hrefFor={(key) => `/institution/1?peers=${key}#peers`} />);
    expect(screen.getByRole("heading", { name: "Overdraft and maintenance against peers" })).toBeInTheDocument();
    expect(screen.getByText(/^Its overdraft fee, \$35(\.00)?, is \$5(\.00)? above the peer median of \$30(\.00)?\.$/)).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("Too few to compare")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.getByText(/30 of 42 publish a lower fee, 4 the same and 8 a higher one/)).toBeInTheDocument();
  });

  it("offers each peer set as a plain link with its label, the current one marked", () => {
    render(<PeerRankTeaser sets={SETS} hrefFor={(key) => `/institution/1?peers=${key}#peers`} />);
    const size = screen.getByRole("link", { name: "Banks with $300M to $1B in assets" });
    expect(size).toHaveAttribute("href", "/institution/1?peers=size#peers");
    expect(screen.getByRole("link", { name: "Banks in TX" })).toHaveAttribute("aria-current", "true");
  });

  it("says about the same within 1% and never forces a finding", () => {
    expect(peerSetFinding([{ key: "overdraft", own: 30.2, median: 30, peers: 9, lower: 4, same: 0, higher: 5 }])).toMatch(/about the same/);
    expect(peerSetFinding([{ key: "overdraft", own: 30, median: null, peers: 3, lower: 0, same: 0, higher: 0 }])).toBe(
      "Too few peers in this group publish its fees for a median.",
    );
  });

  it("labels district peers for the findings", () => {
    expect(peerGroupLabel({ ...RANK, scope: "district", charter_type: "credit_union" })).toBe("Dallas Fed district credit unions");
    expect(peerGroupLabel(RANK)).toBe("Texas banks");
  });
});
