import { describe, expect, it } from "vitest";
import { benchmarkReportPath, parseBenchmarkScope } from "./benchmark-report";

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
