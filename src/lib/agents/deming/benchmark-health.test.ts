import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import { STATS_METHOD_VERSION } from "@/lib/data-store/fee-stats";
import {
  categoryHealth,
  findCollapses,
  groupHealth,
  medianRangeRanks,
  runBenchmarkHealth,
  summarizeBenchmarkHealth,
} from "./benchmark-health";

describe("95% range around the median by order statistics (fee-benchmarking skill)", () => {
  it("runs from the 2nd to the 9th of 10 values and the 10th to the 21st of 30", () => {
    expect(medianRangeRanks(10)).toEqual({ low: 2, high: 9 });
    expect(medianRangeRanks(30)).toEqual({ low: 10, high: 21 });
    expect(medianRangeRanks(9)).toBeNull();
  });

  it("shows a benchmark from 10 institutions and marks it limited below 30", () => {
    const ten = categoryHealth("nsf", [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(ten).toEqual({ category: "nsf", institutions: 10, median: 55, range: { low: 20, high: 90 }, limitedSample: true });
    expect(categoryHealth("nsf", [1, 2, 3]).median).toBeNull();
    expect(categoryHealth("nsf", Array.from({ length: 30 }, (_, i) => i)).limitedSample).toBe(false);
  });
});

describe("collapse alarm", () => {
  it("names a category that kept less than 70% of its institutions", () => {
    const now = [categoryHealth("overdraft", Array(13).fill(30)), categoryHealth("nsf", Array(900).fill(30))];
    expect(findCollapses(now, [
      { category: "overdraft", institutions: 3100 },
      { category: "nsf", institutions: 1000 },
      { category: "wire_domestic_outgoing", institutions: 400 },
      { category: "tiny", institutions: 5 },
    ])).toEqual([
      { category: "overdraft", before: 3100, now: 13 },
      { category: "wire_domestic_outgoing", before: 400, now: 0 },
    ]);
  });
});

describe("state and size groups", () => {
  const base = { coveredMedianAssets: null, uncoveredMedianAssets: null };
  it("falls back from the state to the district at the same size, then the whole state", () => {
    const groups = groupHealth([
      { state: "TN", district: 6, size: "under_300m", total: 100, covered: 31, ...base },
      { state: "TN", district: 6, size: "1b_10b", total: 12, covered: 4, ...base },
      { state: "WY", district: 10, size: "1b_10b", total: 3, covered: 2, ...base },
      { state: "WY", district: 10, size: "under_300m", total: 30, covered: 9, ...base },
      { state: "VT", district: 1, size: "300m_1b", total: 5, covered: 1, ...base },
    ], new Map([["6|1b_10b", 40], ["10|1b_10b", 3], ["10|under_300m", 9], ["1|300m_1b", 2]]));
    const by = (state: string, size: string) => groups.find((row) => row.state === state && row.size === size)!;
    expect(by("TN", "under_300m")).toMatchObject({ fallback: "state", meetsTarget: true, share: 0.31 });
    expect(by("TN", "1b_10b")).toMatchObject({ fallback: "district", meetsTarget: false });
    expect(by("WY", "1b_10b")).toMatchObject({ fallback: "state_all_sizes", meetsTarget: false });
    expect(by("VT", "300m_1b").fallback).toBe("none");
  });

  it("flags a group whose covered banks are clearly larger", () => {
    const [group] = groupHealth([{ state: "TX", district: 11, size: "under_300m", total: 200, covered: 40, coveredMedianAssets: 180_000, uncoveredMedianAssets: 60_000 }], new Map());
    expect(group.biased).toBe(true);
  });
});

describe("runBenchmarkHealth", () => {
  it("compares with the last check on the same statistics method and raises the alarm", async () => {
    const db = Object.assign(vi.fn(async (parts: TemplateStringsArray) => {
      const text = parts.join("?");
      if (text.includes("FROM agent_run_steps")) {
        return [{ message: "", created_at: "2026-10-11T06:00:00Z", detail: { stats_method_version: STATS_METHOD_VERSION, categories: [{ category: "overdraft", institutions: 3100 }] } }];
      }
      if (text.includes("UNION ALL")) {
        return [
          { level: "state", state_code: "TN", fed_district: 6, size_group: "under_300m", total: 50, covered: 30, covered_median: 120000, uncovered_median: 80000 },
          { level: "district", state_code: null, fed_district: 6, size_group: "under_300m", total: 400, covered: 200, covered_median: null, uncovered_median: null },
        ];
      }
      return Array.from({ length: 13 }, (_, i) => ({ fee_category: "overdraft", amount: 30 + i, institution_id: i + 1 }));
    }), { unsafe: (text: string) => text }) as unknown as Parameters<typeof runBenchmarkHealth>[0] extends { db?: infer T } ? T : never;
    const result = await runBenchmarkHealth({ db });
    expect(result.collapses).toEqual([{ category: "overdraft", before: 3100, now: 13 }]);
    expect(result.comparedWith).toBe("2026-10-11T06:00:00.000Z");
    expect(result.groupsMeetingTarget).toBe(1);
    expect(summarizeBenchmarkHealth(result)).toContain("ALARM: overdraft fell from 3,100 to 13 institutions");
  });
});
