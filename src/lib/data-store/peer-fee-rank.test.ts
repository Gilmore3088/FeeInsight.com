import { describe, expect, it } from "vitest";
import { rankAgainstPeers } from "./peer-fee-rank";

describe("rankAgainstPeers", () => {
  it("counts lower, equal and higher values among the other institutions", () => {
    expect(rankAgainstPeers(30, [25, 28, 30, 30.001, 35, 36])).toEqual({ lower: 2, same: 2, higher: 2, peers: 6 });
  });

  it("handles a $0 fee as the lowest", () => {
    expect(rankAgainstPeers(0, [0, 5, 10])).toEqual({ lower: 0, same: 1, higher: 2, peers: 3 });
  });
});
