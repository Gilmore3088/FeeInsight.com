import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PeerRankTeaser, peerGroupLabel } from "./peer-rank-teaser";
import type { InstitutionPeerRank } from "@/lib/data-store/peer-fee-rank";

const RANK: InstitutionPeerRank = {
  scope: "state",
  state_code: "TX",
  fed_district: 11,
  charter_type: "bank",
  lines: [
    { key: "overdraft", own: 35, lower: 30, same: 4, higher: 8, peers: 42 },
    { key: "monthly_maintenance", own: 10, lower: 12, same: 0, higher: 20, peers: 32 },
  ],
};

describe("PeerRankTeaser", () => {
  it("names the peer group and counts lower and higher fees, with no institution names", () => {
    render(<PeerRankTeaser rank={RANK} reportOfferHref="/for-institutions#report" />);
    expect(screen.getByRole("heading", { name: "Against Texas banks" })).toBeInTheDocument();
    expect(screen.getByText(/Of 42 others that publish it/)).toHaveTextContent("30 lower, 4 the same and 8 higher.");
    expect(screen.getByText(/Of 32 others that publish it/)).toHaveTextContent("12 lower and 20 higher.");
    expect(screen.getByRole("link", { name: /local competitors/ })).toHaveAttribute("href", "/for-institutions#report");
  });

  it("labels district peers and says why", () => {
    expect(peerGroupLabel({ ...RANK, scope: "district", charter_type: "credit_union" })).toBe("Dallas Fed district credit unions");
    render(<PeerRankTeaser rank={{ ...RANK, scope: "district" }} reportOfferHref="/x" />);
    expect(screen.getByText(/too few comparable institutions/)).toBeInTheDocument();
  });
});
