import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import { groupKey, medianWithCount, ratioMediansBy, splitFeeKey, type UbprBankRow } from "./ubpr-peer-groups-aggregates";

const row = (over: Partial<UbprBankRow>): UbprBankRow => ({
  institution_id: 1,
  peer_group: "1",
  ratios: {},
  state_code: "TX",
  fed_district: 11,
  asset_size_tier: "community_mid",
  charter_type: "bank",
  ...over,
});

describe("medianWithCount", () => {
  it("carries the count and withholds a median below the minimum", () => {
    expect(medianWithCount([3, 1, 2], 3)).toEqual({ median: 2, institution_count: 3 });
    expect(medianWithCount([4, 1, 3, 2], 3)).toEqual({ median: 2.5, institution_count: 4 });
    expect(medianWithCount([1, 2], 3)).toEqual({ median: null, institution_count: 2 });
  });
});

describe("ratioMediansBy", () => {
  it("groups by peer group and skips banks without a value instead of counting zero", () => {
    const rows = [
      row({ peer_group: "2", ratios: { roa: 1 } }),
      row({ peer_group: "2", ratios: { roa: 3 } }),
      row({ peer_group: "2", ratios: {} }),
      row({ peer_group: "10", ratios: { roa: 0 } }),
      row({ peer_group: null, ratios: { roa: 9 } }),
    ];
    const groups = ratioMediansBy(rows, "peer_group", 2);
    expect(groups.map((g) => g.group)).toEqual(["2", "10"]);
    expect(groups[0]).toMatchObject({ banks: 3, ratios: { roa: { median: 2, institution_count: 2 } } });
    expect(groups[1].ratios.roa).toEqual({ median: null, institution_count: 1 });
  });

  it("groups by the shared institution dimensions", () => {
    expect(groupKey(row({ fed_district: 6 }), "fed_district")).toBe("6");
    expect(groupKey(row({ state_code: null }), "state")).toBeNull();
    expect(groupKey(row({}), "asset_tier")).toBe("community_mid");
  });
});

describe("splitFeeKey", () => {
  it("splits a peer group and category key", () => {
    expect(splitFeeKey("4\u0000overdraft")).toEqual({ peer_group: "4", fee_category: "overdraft" });
  });
});
