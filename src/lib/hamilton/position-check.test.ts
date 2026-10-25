import { describe, expect, it } from "vitest";
import { MIN_PEERS_FOR_POSITION } from "./workspace/scenario";
import { checkPosition, namedPeers, parseProposedFee, type PositionPeer } from "./position-check";

const peers: PositionPeer[] = [
  { institutionId: 5, name: "U.S. Bank", amount: 36 },
  { institutionId: 21, name: "M&T Bank", amount: 37 },
  { institutionId: 4956, name: "Navy Federal Credit Union", amount: 20 },
  { institutionId: 6741, name: "SchoolsFirst Federal Credit Union", amount: 25 },
  { institutionId: 9001, name: "Example Savings Bank", amount: 25 },
  { institutionId: 9002, name: "Example Community Bank", amount: 30 },
  { institutionId: 9003, name: "Example Thrift", amount: 18 },
  { institutionId: 9004, name: "Example Federal Credit Union", amount: 22 },
  { institutionId: 9005, name: "Example National Bank", amount: 38 },
  { institutionId: 9006, name: "Example Trust Company", amount: 40 },
];

describe("checkPosition", () => {
  it("places a price and names the nearest peers on each side", () => {
    const check = checkPosition(28, peers);
    expect(check).toMatchObject({ n: 10, less: 5, same: 0, more: 5, percentile: 50 });
    expect(check.placement).toBe("at the 50th percentile of 10 peers");
    expect(check.below).toEqual({ amount: 25, peers: [peers[4], peers[3]] });
    expect(check.above?.amount).toBe(30);
    expect(check.above?.peers.map((p) => p.name)).toEqual(["Example Community Bank"]);
  });

  it("counts a tie as the same and keeps it out of either side", () => {
    const check = checkPosition(30, peers);
    expect(check).toMatchObject({ less: 5, same: 1, more: 4 });
    expect(check.atPrice.map((p) => p.institutionId)).toEqual([9002]);
    expect(check.below?.amount).toBe(25);
    expect(check.above?.amount).toBe(36);
  });

  it("says when every peer charges more, and when there is nothing on one side", () => {
    const check = checkPosition(10, peers);
    expect(check.placement).toBe("below all 10 peers");
    expect(check.below).toBeNull();
  });

  it("gives no percentile for too few peers or none", () => {
    const tooFew = peers.slice(0, MIN_PEERS_FOR_POSITION - 1);
    expect(checkPosition(30, tooFew)).toMatchObject({ percentile: null, n: MIN_PEERS_FOR_POSITION - 1 });
    expect(checkPosition(30, tooFew).placement).toBe(`too few peers for a percentile: ${MIN_PEERS_FOR_POSITION - 1} publish this fee, and a percentile needs ${MIN_PEERS_FOR_POSITION}`);
    expect(checkPosition(30, []).placement).toBe("not found in any peer's published schedule");
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
