import { describe, expect, it } from "vitest";
import { checkPosition, namedPeers, parseProposedFee, type PositionPeer } from "./position-check";

const peers: PositionPeer[] = [
  { institutionId: 5, name: "U.S. Bank", amount: 36 },
  { institutionId: 21, name: "M&T Bank", amount: 37 },
  { institutionId: 4956, name: "Navy Federal Credit Union", amount: 20 },
  { institutionId: 6741, name: "SchoolsFirst Federal Credit Union", amount: 25 },
  { institutionId: 9001, name: "Example Savings Bank", amount: 25 },
  { institutionId: 9002, name: "Example Community Bank", amount: 30 },
];

describe("checkPosition", () => {
  it("places a price and names the nearest peers on each side", () => {
    const check = checkPosition(28, peers);
    expect(check).toMatchObject({ n: 6, less: 3, same: 0, more: 3, percentile: 50 });
    expect(check.placement).toBe("at the 50th percentile of 6 peers");
    expect(check.below).toEqual({ amount: 25, peers: [peers[4], peers[3]] });
    expect(check.above?.amount).toBe(30);
    expect(check.above?.peers.map((p) => p.name)).toEqual(["Example Community Bank"]);
  });

  it("counts a tie as the same and keeps it out of either side", () => {
    const check = checkPosition(30, peers);
    expect(check).toMatchObject({ less: 3, same: 1, more: 2 });
    expect(check.atPrice.map((p) => p.institutionId)).toEqual([9002]);
    expect(check.below?.amount).toBe(25);
    expect(check.above?.amount).toBe(36);
  });

  it("says when every peer charges more, and when there is nothing on one side", () => {
    const check = checkPosition(10, peers);
    expect(check.placement).toBe("below all 6 peers");
    expect(check.below).toBeNull();
  });

  it("gives no percentile for too few peers or none", () => {
    expect(checkPosition(30, peers.slice(0, 3))).toMatchObject({ percentile: null, n: 3 });
    expect(checkPosition(30, peers.slice(0, 3)).placement).toMatch(/Too few peers/);
    expect(checkPosition(30, []).placement).toBe("No peer publishes this fee");
  });
});

describe("parseProposedFee", () => {
  it("reads typed dollar amounts and refuses anything else", () => {
    expect(parseProposedFee("$35")).toBe(35);
    expect(parseProposedFee(" 2.50 ")).toBe(2.5);
    expect(parseProposedFee("0")).toBe(0);
    expect(parseProposedFee("-5")).toBeNull();
    expect(parseProposedFee("thirty")).toBeNull();
    expect(parseProposedFee("99999")).toBeNull();
    expect(parseProposedFee(undefined)).toBeNull();
  });
});

describe("namedPeers", () => {
  it("names a few and counts the rest", () => {
    expect(namedPeers(peers.slice(0, 2))).toBe("U.S. Bank and M&T Bank");
    expect(namedPeers(peers.slice(0, 5))).toBe("U.S. Bank, M&T Bank, Navy Federal Credit Union and 2 others");
    expect(namedPeers([])).toBe("None found");
  });
});
