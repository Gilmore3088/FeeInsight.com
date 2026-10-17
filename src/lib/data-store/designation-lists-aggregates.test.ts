import { describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({ sql: Object.assign(vi.fn(), { unsafe: vi.fn() }) }));

import { compareDesignated, countByDimension, type FeeRowWithDims, type InstitutionDimRow } from "./designation-lists-aggregates";

const inst = (id: number, designated: boolean, state: string | null, tier = "community_small"): InstitutionDimRow => ({
  institution_id: id,
  charter_type: "bank",
  state_code: state,
  fed_district: 6,
  asset_size_tier: tier,
  designated,
});

describe("countByDimension", () => {
  it("counts designated and total per group and skips institutions without a value", () => {
    const counts = countByDimension([inst(1, true, "MS"), inst(2, false, "MS"), inst(3, true, "AL"), inst(4, true, null)], "state");
    expect(counts).toEqual([
      { dimension: "state", key: "AL", designated: 1, institutions: 1, share: 1 },
      { dimension: "state", key: "MS", designated: 1, institutions: 2, share: 0.5 },
    ]);
  });
});

describe("compareDesignated", () => {
  const fee = (id: number, designated: boolean, amount: number, state = "MS"): FeeRowWithDims => ({
    ...inst(id, designated, state),
    institution_id: id,
    fee_category: "overdraft",
    amount,
  });

  it("splits designated from the rest and carries institution counts", () => {
    const rows = [
      ...Array.from({ length: 6 }, (_, i) => fee(i + 1, true, 25)),
      ...Array.from({ length: 6 }, (_, i) => fee(i + 100, false, 35)),
    ];
    const [row] = compareDesignated(rows);
    expect(row.fee_category).toBe("overdraft");
    expect(row.designated.institution_count).toBe(6);
    expect(row.others.institution_count).toBe(6);
    expect(row.designated.median_amount).toBe(25);
    expect(row.median_gap).toBe(-10);
  });

  it("leaves the gap null when a side is too small for a median", () => {
    const [row] = compareDesignated([fee(1, true, 25), ...Array.from({ length: 6 }, (_, i) => fee(i + 100, false, 35))]);
    expect(row.designated.median_amount).toBeNull();
    expect(row.median_gap).toBeNull();
  });

  it("groups by state", () => {
    const out = compareDesignated([fee(1, true, 25, "MS"), fee(2, false, 30, "AL")], "state");
    expect(out.map((r) => r.group)).toEqual(["AL", "MS"]);
  });
});
