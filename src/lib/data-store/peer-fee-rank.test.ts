import { describe, expect, it } from "vitest";
import type { ReportRuleCheck } from "./market-readiness";
import {
  peerFiltersForRule,
  peerGroupValuesFrom,
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
    [1, "overdraft", 30, "bank", "TX", 11],
    [2, "overdraft", 25, "credit_union", "TX", 11],
    [3, "overdraft", 35, "bank", "OK", 10],
    [4, "overdraft", 20, "bank", "NM", 11],
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
});
