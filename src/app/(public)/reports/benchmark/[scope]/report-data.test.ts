import { describe, expect, it } from "vitest";
import type { IndexEntry } from "@/lib/data-store/fee-index";
import {
  buildReportCharterPairs,
  buildReportRows,
  computeDistrictFindings,
  computeNationalFindings,
  MIN_BENCHMARK_INSTITUTIONS,
  MIN_CHARTER_INSTITUTIONS,
} from "./report-data";

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

describe("buildReportRows", () => {
  it("keeps headline fees in headline order and drops thin or non-headline lines", () => {
    const rows = buildReportRows(
      [
        entry("nsf", 30, 163),
        entry("overdraft", 32, 107),
        entry("monthly_maintenance", 10, MIN_BENCHMARK_INSTITUTIONS - 1),
        entry("coin_counting", 5, 400),
        entry("stop_payment", null, 90),
      ],
      null,
    );
    expect(rows.map((row) => row.fee_category)).toEqual(["overdraft", "nsf"]);
    expect(rows[0].national_median).toBeNull();
    expect(rows[0].delta_pct).toBeNull();
  });

  it("compares a district line with the national median", () => {
    const [row] = buildReportRows([entry("overdraft", 33, 107)], [entry("overdraft", 30, 1200)]);
    expect(row.national_median).toBe(30);
    expect(row.delta_pct).toBeCloseTo(10);
  });
});

describe("report findings", () => {
  const rows = buildReportRows([entry("overdraft", 30, 107), entry("nsf", 32, 90)], [entry("overdraft", 25, 1200), entry("nsf", 32, 1100)]);

  it("compares a charter only where both have enough institutions", () => {
    const pairs = buildReportCharterPairs(
      [entry("overdraft", 32, 60), entry("nsf", 32, MIN_CHARTER_INSTITUTIONS - 1)],
      [entry("overdraft", 25, 40), entry("nsf", 25, 40)],
      rows,
    );
    expect(pairs.map((p) => p.fee_category)).toEqual(["overdraft"]);
  });

  it("leads a district report with its overdraft median against national", () => {
    const [first] = computeDistrictFindings("St. Louis district", rows, []);
    expect(first.headline).toBe("The typical St. Louis district overdraft fee");
    expect(first.detail).toContain("20% above the national median of $25.00");
  });

  it("words the district charter finding with an article", () => {
    const pairs = [{ fee_category: "overdraft", bank_median_amount: 32, cu_median_amount: 25 }];
    const charter = computeDistrictFindings("St. Louis district", [], pairs).find((f) => f.key === "charter-gap");
    expect(charter?.detail.startsWith("In the St. Louis district,")).toBe(true);
  });

  it("leads the national report with overdraft and NSF, then the charter gap", () => {
    const national = buildReportRows([entry("overdraft", 30, 1200), entry("nsf", 32, 1100)], null);
    const pairs = [{ fee_category: "overdraft", bank_median_amount: 32, cu_median_amount: 25 }];
    const findings = computeNationalFindings(national, pairs);
    expect(findings.map((f) => f.key)).toEqual(["overdraft", "nsf", "charter-gap"]);
    expect(findings[2].headline).toBe("Credit unions charge less for overdraft");
  });
});
