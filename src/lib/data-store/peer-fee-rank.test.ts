import { describe, expect, it } from "vitest";
import type { ReportRuleCheck } from "./market-readiness";
import {
  MIN_PEERS_FOR_PEER_SET_MEDIAN,
  comparePeerSet,
  peerFiltersForRule,
  peerGroupValuesFrom,
  ownFeeCoverage,
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
    [1, "monthly_maintenance", 10, "bank", "TX", 11, "community_mid", 3],
    ...[20, 22, 25, 28, 30, 32, 35, 35, 38].map((amount, i): PeerRankValue => [100 + i, "overdraft", amount, "bank", "TX", 11, "community_mid"]),
    ...[5, 6, 8, 10, 12].map((amount, i): PeerRankValue => [200 + i, "monthly_maintenance", amount, "bank", "TX", 11, "community_large"]),
  ];
  const state = { key: "state", label: "Banks in TX", filters: { charter_type: "bank", states: ["TX"] } };
  const size = { key: "size", label: "Banks with $300M to $1B in assets", filters: { charter_type: "bank", asset_tiers: ["community_mid"] } };
  const metro = { key: "metro", label: "Banks with branches in the Austin metro", filters: { institutionIds: [100, 101, 102] } };

  it("shows a median and peer count only at eight peers or more, with how many prices its own value is built from", () => {
    const result = comparePeerSet(1, state, all);
    expect(MIN_PEERS_FOR_PEER_SET_MEDIAN).toBe(8);
    expect(result.lines).toEqual([
      { key: "overdraft", own: 30, ownPrices: 1, median: 30, peers: 9, lower: 4, same: 1, higher: 4 },
      { key: "monthly_maintenance", own: 10, ownPrices: 3, median: null, peers: 5, lower: 0, same: 0, higher: 0 },
    ]);
  });

  it("offers only sets that clear the floor, leaving out the report rule's group the findings already show", () => {
    const rule = { passes: true, charter_type: "bank", state_code: "TX", fed_district: 11, peerScope: "state" } as ReportRuleCheck;
    const picked = pickPeerSet(1, rule, [state, metro, size], all, null)!;
    expect(picked.options.map((o) => o.key)).toEqual(["size"]);
    expect(picked.selected.key).toBe("size");
    // A set below the floor, or the rule's own group, is never shown, even when asked for.
    expect(pickPeerSet(1, rule, [state, metro, size], all, "metro")!.selected.key).toBe("size");
    expect(pickPeerSet(1, rule, [state, metro, size], all, "state")!.selected.key).toBe("size");
    // Without a report rule group, every set that clears the floor is offered.
    expect(pickPeerSet(1, null, [state, metro, size], all, null)!.options.map((o) => o.key)).toEqual(["state", "size"]);
    expect(pickPeerSet(1, null, [metro], all, null)).toBeNull();
  });

  it("keeps the institution's own fees the same under every peer set it offers", () => {
    // Resolved sets (metro, regulator, nearest) list only the other institutions, never the subject.
    const bigMetro = { key: "metro", label: "Banks with branches in the Austin metro", filters: { institutionIds: [100, 101, 102, 103, 104, 105, 106, 107, 108, 200] } };
    const nearest = { key: "nearest", label: "The 25 banks closest in assets", filters: { institutionIds: [101, 102, 103, 104, 105, 106, 107, 108, 200, 201, 202, 203, 204] } };
    const district = { key: "district", label: "Banks in the Dallas Fed district", filters: { charter_type: "bank", fed_districts: [11] } };
    const choices = [state, district, size, bigMetro, nearest];
    const offered = pickPeerSet(1, null, choices, all, null)!.options.map((o) => o.key);
    expect(offered).toEqual(["state", "district", "size", "metro", "nearest"]);
    const subject = (key: string) =>
      pickPeerSet(1, null, choices, all, key)!.selected.lines.map(({ key: fee, own, ownPrices }) => ({ fee, own, ownPrices }));
    for (const key of offered) {
      expect(pickPeerSet(1, null, choices, all, key)!.selected.key).toBe(key);
      expect(subject(key)).toEqual([
        { fee: "overdraft", own: 30, ownPrices: 1 },
        { fee: "monthly_maintenance", own: 10, ownPrices: 3 },
      ]);
    }
    // Only the comparison population moves: one metro peer publishes monthly maintenance, five state peers do.
    expect(pickPeerSet(1, null, choices, all, "metro")!.selected.lines[1].peers).toBe(1);
    expect(pickPeerSet(1, null, choices, all, "state")!.selected.lines[1].peers).toBe(5);
  });

  it("counts a chosen set's institutions and hands the explorer the selected set's filters", () => {
    const nearest = { key: "nearest", label: "The 25 banks closest in assets", filters: { institutionIds: [101, 102, 103, 104, 105, 106, 107, 108, 200, 201, 202, 203, 204] } };
    const picked = pickPeerSet(1, null, [nearest, state], all, null)!;
    expect(picked.options).toEqual([
      { key: "nearest", label: "The 25 banks closest in assets", count: 13 },
      { key: "state", label: state.label },
    ]);
    expect(picked.selected.key).toBe("nearest");
    expect(picked.selectedFilters).toEqual(nearest.filters);
    expect(pickPeerSet(1, null, [nearest, state], all, "state")!.selectedFilters).toEqual(state.filters);
  });

  it("should_default_to_the_first_set_that_compares_its_own_fees_and_widen_when_too_few_publish", () => {
    // Three more Texas banks publish monthly maintenance, so the state set compares both own fees.
    const wider: PeerRankValue[] = [
      ...all,
      ...[7, 9, 11].map((amount, i): PeerRankValue => [300 + i, "monthly_maintenance", amount, "bank", "TX", 11, "community_mid"]),
    ];
    const nearest = { key: "nearest", label: "The 25 banks closest in assets", filters: { institutionIds: [101, 102, 103, 104, 105, 106, 107, 108, 200] } };
    // Nearest compares overdraft only (1 of 2 own fees); the state set compares both, so it is the default.
    expect(ownFeeCoverage(comparePeerSet(1, nearest, wider))).toEqual({ compared: 1, fits: false });
    expect(ownFeeCoverage(comparePeerSet(1, state, wider))).toEqual({ compared: 2, fits: true });
    const picked = pickPeerSet(1, null, [nearest, state], wider, null)!;
    expect(picked.options.map((o) => o.key)).toEqual(["nearest", "state"]);
    expect(picked.selected.key).toBe("state");
    // A visitor's choice still wins.
    expect(pickPeerSet(1, null, [nearest, state], wider, "nearest")!.selected.key).toBe("nearest");
    // With no own ranked fee, a set where overdraft has a median fits.
    expect(ownFeeCoverage(comparePeerSet(999, nearest, wider))).toEqual({ compared: 0, fits: true });
  });
});
