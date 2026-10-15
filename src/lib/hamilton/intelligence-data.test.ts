import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ getSql: () => { throw new Error("no database in unit tests"); } }));

import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
import { buildFeeMap, buildFeeSpread, joinSeries, loadComplaintTrend, percentChange, yearOverYear } from "./intelligence-data";

describe("buildFeeMap", () => {
  it("withholds a state under the cohort floor instead of reporting its median", () => {
    const thick = Array.from({ length: MIN_INSTITUTIONS_FOR_MEDIAN }, (_, i) => ({ state_code: "TX", amount: 30 + i }));
    const map = buildFeeMap("overdraft", [...thick, { state_code: "VT", amount: 10 }, { state_code: null, amount: 99 }]);
    expect(map.states.find(s => s.stateCode === "TX")?.median).toBe(32);
    expect(map.states.find(s => s.stateCode === "VT")).toEqual({ stateCode: "VT", institutions: 1, median: null });
    expect(map.nationalInstitutions).toBe(MIN_INSTITUTIONS_FOR_MEDIAN + 2);
  });
});

describe("buildFeeSpread", () => {
  it("bins every value into even bands and withholds a cohort under the floor", () => {
    const spread = buildFeeSpread([25, 27, 30, 30, 32, 35, 36, 38]);
    expect(spread).toMatchObject({ count: 8, low: 25, high: 38, median: 31 });
    expect(spread!.bins.reduce((n, b) => n + b.count, 0)).toBe(8);
    expect(spread!.bins.length).toBeLessThanOrEqual(10);
    expect(buildFeeSpread(Array(MIN_INSTITUTIONS_FOR_MEDIAN - 1).fill(10))).toBeNull();
  });
});

describe("series helpers", () => {
  it("computes twelve-month change only where the prior month exists", () => {
    const out = yearOverYear([
      { date: "2025-01-01", value: 100 },
      { date: "2025-02-01", value: 100 },
      { date: "2026-01-01", value: 110 },
    ]);
    expect(out).toEqual([{ date: "2026-01-01", value: expect.closeTo(10, 6) }]);
    expect(percentChange(5, 0)).toBeNull();
  });

  it("joins series by date and leaves gaps as null", () => {
    const rows = joinSeries({ a: [{ date: "2026-01-01", value: 1 }], b: [{ date: "2026-02-01", value: 2 }] });
    expect(rows).toEqual([{ period: "2026-01", a: 1, b: null }, { period: "2026-02", a: null, b: 2 }]);
  });
});

it("returns null rather than zeros when the complaint reader fails", async () => {
  await expect(loadComplaintTrend("TX")).resolves.toBeNull();
});
