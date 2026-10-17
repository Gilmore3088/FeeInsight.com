import { describe, expect, it } from "vitest";
import type { ReportRuleCheck } from "./market-readiness";
import {
  MIN_PEERS_FOR_PEER_SET_MEDIAN,
  comparePeerSet,
  peerFiltersForRule,
  peerGroupValuesFrom,
  pickPeerSet,
  peerRankFromGroupValues,
  rankAgainstPeers,
  type PeerGroupValue,
  type PeerRankValue,
} from "./peer-fee-rank";

describe("rankAgainstPeers", () => {
  it("counts lower, equal and higher values among the other institutions", () => {
    expect(rankAgainstPeers(30, [25, 28, 30, 30.001, 35, 36])).toEqual({ lower: 2, same: 2, higher: 2, peers: 6 });
  });

  it("handles a $0 fee as the lowest", () => {
    expect(rankAgainstPeers(0, [0, 5, 10])).toEqual({ lower: 0, same: 1, higher: 2, peers: 3 });
  });
});

const rule: ReportRuleCheck = {
  state_code: "TX",
  charter_type: "bank",
  fed_district: 11,
  ownCategories: 12,
  richCompetitors: 9,
  peerScope: "state",
  stateRichCompetitors: 9,
  districtRichCompetitors: 20,
  passes: true,
};

describe("peerFiltersForRule", () => {
  it("uses the state, or the district when the rule fell back to it", () => {
    expect(peerFiltersForRule(rule)).toEqual({ charter_type: "bank", state_code: "TX" });
    expect(peerFiltersForRule({ ...rule, peerScope: "district" })).toEqual({ charter_type: "bank", fed_districts: [11] });
  });

  it("names no group when the rule fails or has no charter", () => {
    expect(peerFiltersForRule({ ...rule, passes: false })).toBeNull();
    expect(peerFiltersForRule({ ...rule, charter_type: null })).toBeNull();
    expect(peerFiltersForRule(null)).toBeNull();
  });
});

describe("peerRankFromGroupValues", () => {
  const values: PeerGroupValue[] = [
    [1, "overdraft", 30],
    [2, "overdraft", 25],
    [3, "overdraft", 30],
    [4, "overdraft", 35],
    [5, "overdraft", 36],
    [6, "overdraft", 20],
    [1, "monthly_maintenance", 10],
    [2, "monthly_maintenance", 5],
  ];

  it("ranks each fee that has enough other institutions", () => {
    expect(peerRankFromGroupValues(1, rule, { charter_type: "bank", state_code: "TX" }, values)).toEqual({
      scope: "state",
      state_code: "TX",
      fed_district: 11,
      charter_type: "bank",
      lines: [{ key: "overdraft", own: 30, lower: 2, same: 1, higher: 2, peers: 5 }],
    });
  });

  it("returns null when the institution has no ranked fee", () => {
    expect(peerRankFromGroupValues(99, rule, { charter_type: "bank", state_code: "TX" }, values)).toBeNull();
  });
});

describe("peerGroupValuesFrom", () => {
  const all: PeerRankValue[] = [
    [1, "overdraft", 30, "bank", "TX", 11, "community_mid"],
    [2, "overdraft", 25, "credit_union", "TX", 11, "community_mid"],
    [3, "overdraft", 35, "bank", "OK", 10, "community_large"],
    [4, "overdraft", 20, "bank", "NM", 11, "community_mid"],
  ];

  it("keeps the same charter in the state", () => {
    expect(peerGroupValuesFrom(all, { charter_type: "bank", state_code: "TX" })).toEqual([[1, "overdraft", 30]]);
  });

  it("keeps the same charter in the Fed district", () => {
    expect(peerGroupValuesFrom(all, { charter_type: "bank", fed_districts: [11] })).toEqual([
      [1, "overdraft", 30],
      [4, "overdraft", 20],
    ]);
  });


  it("keeps a size band and hand-picked peers the way the fee index does", () => {
    expect(peerGroupValuesFrom(all, { charter_type: "bank", asset_tiers: ["community_mid"] })).toEqual([
      [1, "overdraft", 30],
      [4, "overdraft", 20],
    ]);
    expect(peerGroupValuesFrom(all, { institutionIds: [3, 2] })).toEqual([
      [2, "overdraft", 25],
      [3, "overdraft", 35],
    ]);
  });
});

describe("peer sets on the institution page", () => {
  // Institution 1 and twelve banks in TX; nine publish overdraft, five monthly maintenance.
  const all: PeerRankValue[] = [
    [1, "overdraft", 30, "bank", "TX", 11, "community_mid"],
    [1, "monthly_maintenance", 10, "bank", "TX", 11, "community_mid"],
    ...[20, 22, 25, 28, 30, 32, 35, 35, 38].map((amount, i): PeerRankValue => [100 + i, "overdraft", amount, "bank", "TX", 11, "community_mid"]),
    ...[5, 6, 8, 10, 12].map((amount, i): PeerRankValue => [200 + i, "monthly_maintenance", amount, "bank", "TX", 11, "community_large"]),
  ];
  const state = { key: "state", label: "Banks in TX", filters: { charter_type: "bank", states: ["TX"] } };
  const size = { key: "size", label: "Banks with $300M to $1B in assets", filters: { charter_type: "bank", asset_tiers: ["community_mid"] } };
  const metro = { key: "metro", label: "Banks with branches in the Austin metro", filters: { institutionIds: [100, 101, 102] } };

  it("shows a median and peer count only at eight peers or more", () => {
    const result = comparePeerSet(1, state, all);
    expect(MIN_PEERS_FOR_PEER_SET_MEDIAN).toBe(8);
    expect(result.lines).toEqual([
      { key: "overdraft", own: 30, median: 30, peers: 9, lower: 4, same: 1, higher: 4 },
      { key: "monthly_maintenance", own: 10, median: null, peers: 5, lower: 0, same: 0, higher: 0 },
    ]);
  });

  it("offers only sets that clear the floor and defaults to the report rule's group", () => {
    const rule = { passes: true, charter_type: "bank", state_code: "TX", fed_district: 11, peerScope: "state" } as ReportRuleCheck;
    const picked = pickPeerSet(1, rule, [size, metro, state], all, null)!;
    expect(picked.options.map((o) => o.key)).toEqual(["size", "state"]);
    expect(picked.selected.key).toBe("state");
    expect(pickPeerSet(1, rule, [size, metro, state], all, "size")!.selected.key).toBe("size");
    // A set below the floor is never shown, even when asked for.
    expect(pickPeerSet(1, rule, [size, metro, state], all, "metro")!.selected.key).toBe("state");
    expect(pickPeerSet(1, null, [metro], all, null)).toBeNull();
  });
});
