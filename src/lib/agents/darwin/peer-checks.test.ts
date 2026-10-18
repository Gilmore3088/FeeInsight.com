import { describe, expect, it } from "vitest";

import type { PeerLevel } from "@/lib/agents/state-expert/memory";

import { districtOfState, entersPeerCheck, holdsForPeerReview, peerCheck, peerOutlierReason, type WiderPeerLevels } from "./peer-checks";

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
    expect(holdsForPeerReview(check, "overdraft")).toBe(true);
  });

  it("falls back to the Fed district, then the nation, and never holds on a fallback", () => {
    const district = peerCheck([level("all", 7)], "overdraft", "community_mid", 5, wider, 1);
    expect(district).toMatchObject({ scope: "district", levelTier: "all", outlier: true, peerCount: 40 });
    expect(holdsForPeerReview(district, "overdraft")).toBe(false);
    expect(peerOutlierReason(district!, 5)).toContain("outside the district peer range");

    const national = peerCheck([], "overdraft", "community_mid", 5, wider, 9);
    expect(national).toMatchObject({ scope: "national", levelTier: "community_mid", peerCount: 300 });
    expect(peerOutlierReason(national!, 5)).toContain("community mid national peer range");
  });

  it("holds a state outlier only where an outlier is usually a misread (v5, #1112)", () => {
    const check = peerCheck([level("all", 9)], "overdraft", "community_mid", 5, wider, 1);
    for (const key of ["atm_non_network", "overdraft", "od_protection_transfer", "rush_card", "minimum_balance", "wire_domestic_outgoing"]) {
      expect(holdsForPeerReview(check, key), key).toBe(true);
    }
    // A real fee at an unusual printed price: photocopies, box drilling, a $5 stop payment, returned mail.
    for (const key of ["document_reproduction", "safe_deposit_box", "stop_payment", "account_research", "monthly_maintenance", "notary_fee", "dormant_account"]) {
      expect(holdsForPeerReview(check, key), key).toBe(false);
    }
    expect(holdsForPeerReview(check, null)).toBe(false);
    expect(holdsForPeerReview(null, "overdraft")).toBe(false);
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

describe("which fees enter the peer check (#1112)", () => {
  it("compares consumer, both and unknown fees, as the benchmarks count them, and never a business fee", () => {
    const url = "https://www.examplebank.com/disclosures/fee-schedule.pdf";
    expect(entersPeerCheck("consumer", url)).toBe(true);
    expect(entersPeerCheck("both", url)).toBe(true);
    expect(entersPeerCheck("unknown", url)).toBe(true);
    expect(entersPeerCheck(null, url)).toBe(true);
    expect(entersPeerCheck(undefined, null)).toBe(true);
    expect(entersPeerCheck("business", url)).toBe(false);
  });

  it("leaves out an unknown fee from a business-only schedule, by the benchmarks' address test", () => {
    expect(entersPeerCheck("unknown", "https://www.examplebank.com/business/fee-schedule.pdf")).toBe(false);
    expect(entersPeerCheck("unknown", "https://www.examplebank.com/commercial-banking/fees")).toBe(false);
    // An address that names both keeps it in, as the benchmarks do.
    expect(entersPeerCheck("unknown", "https://www.examplebank.com/personal-and-business/fees")).toBe(true);
    // A stated consumer fee is compared whatever the address says.
    expect(entersPeerCheck("consumer", "https://www.examplebank.com/business/fee-schedule.pdf")).toBe(true);
  });
});
