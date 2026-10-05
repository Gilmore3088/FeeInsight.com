import { describe, expect, it } from "vitest";
import type { IndexEntry } from "@/lib/data-store/fee-index";
import { benchmarkReportPath, parseBenchmarkScope } from "./benchmark-report";
import { buildBenchmarkRows, MIN_BENCHMARK_INSTITUTIONS } from "./benchmark-report-rows";

function entry(fee_category: string, median: number | null, institution_count: number): IndexEntry {
  return {
    fee_category,
    fee_family: null,
    median_amount: median,
    p25_amount: median === null ? null : median - 5,
    p75_amount: median === null ? null : median + 5,
    min_amount: null,
    max_amount: null,
    institution_count,
    observation_count: institution_count,
    approved_count: institution_count,
    bank_count: 0,
    cu_count: 0,
    maturity_tier: "strong",
    last_updated: null,
  };
}

describe("benchmark report scope", () => {
  it("parses national and the 12 districts only", () => {
    expect(parseBenchmarkScope("national")).toEqual({ kind: "national" });
    expect(parseBenchmarkScope("district-12")).toEqual({ kind: "district", district: 12 });
    expect(parseBenchmarkScope("district-13")).toBeNull();
    expect(parseBenchmarkScope("district-0")).toBeNull();
    expect(parseBenchmarkScope("state-tx")).toBeNull();
  });

  it("round-trips a scope through its path", () => {
    expect(benchmarkReportPath({ kind: "district", district: 7 })).toBe("/reports/benchmark/district-7");
    expect(benchmarkReportPath({ kind: "national" })).toBe("/reports/benchmark/national");
  });
});

describe("buildBenchmarkRows", () => {
  it("keeps headline categories in order and drops thin or non-headline lines", () => {
    const rows = buildBenchmarkRows(
      [
        entry("nsf", 30, 163),
        entry("overdraft", 32, 107),
        entry("monthly_maintenance", 10, MIN_BENCHMARK_INSTITUTIONS - 1),
        entry("coin_counting", 5, 400),
        entry("stop_payment", null, 90),
      ],
      null,
    );
    expect(rows.map((row) => row.category)).toEqual(["overdraft", "nsf"]);
    expect(rows[0].nationalMedian).toBeNull();
  });

  it("compares a district line with the national median", () => {
    const [row] = buildBenchmarkRows([entry("overdraft", 33, 107)], [entry("overdraft", 30, 1200)]);
    expect(row.nationalMedian).toBe(30);
    expect(row.deltaPct).toBeCloseTo(10);
  });
});
