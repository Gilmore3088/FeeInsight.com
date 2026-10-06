import { describe, expect, it } from "vitest";

import type { PeerLevel } from "@/lib/agents/state-expert/memory";

import { districtOfState, holdsForPeerReview, peerCheck, peerOutlierReason, type WiderPeerLevels } from "./peer-checks";

const level = (tier: string, count: number, p25 = 30, p75 = 34): PeerLevel => ({
  canonicalFeeKey: "overdraft",
  tier,
  p25,
  median: 32,
  p75,
  count,
});

const wider: WiderPeerLevels = {
  district: new Map([[1, [level("all", 40, 20, 30)]]]),
  national: [level("community_mid", 300, 25, 35), level("all", 1500)],
};

describe("Darwin peer check fallback", () => {
  it("uses the state when it has enough peers", () => {
    const check = peerCheck([level("all", 9)], "overdraft", "community_mid", 5, wider, 1);
    expect(check).toMatchObject({ scope: "state", outlier: true, peerCount: 9 });
    expect(holdsForPeerReview(check)).toBe(true);
  });

  it("falls back to the Fed district, then the nation, and never holds on a fallback", () => {
    const district = peerCheck([level("all", 7)], "overdraft", "community_mid", 5, wider, 1);
    expect(district).toMatchObject({ scope: "district", levelTier: "all", outlier: true, peerCount: 40 });
    expect(holdsForPeerReview(district)).toBe(false);
    expect(peerOutlierReason(district!, 5)).toContain("outside the district peer range");

    const national = peerCheck([], "overdraft", "community_mid", 5, wider, 9);
    expect(national).toMatchObject({ scope: "national", levelTier: "community_mid", peerCount: 300 });
    expect(peerOutlierReason(national!, 5)).toContain("community mid national peer range");
  });

  it("finds no comparison without peers anywhere, or for a free fee", () => {
    expect(peerCheck([], "overdraft", "community_mid", 5)).toBeNull();
    expect(peerCheck([], "overdraft", "community_mid", 0, wider, 1)).toBeNull();
  });

  it("maps a state to its Fed district", () => {
    expect(districtOfState(" vt ")).toBe(1);
    expect(districtOfState("TX")).toBe(11);
    expect(districtOfState("ZZ")).toBeNull();
    expect(districtOfState(null)).toBeNull();
  });
});
