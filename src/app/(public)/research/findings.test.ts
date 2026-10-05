import { describe, expect, it } from "vitest";
import type { FeeCategorySummary } from "@/lib/data-store";
import { computeFindings, lowerName } from "./findings";

function fee(fee_category: string, o: Partial<FeeCategorySummary> = {}): FeeCategorySummary {
  return {
    fee_category, institution_count: 100, total_observations: 120, min_amount: 0, max_amount: 50, avg_amount: 25,
    median_amount: 25, p25_amount: 20, p75_amount: 30, bank_count: 60, cu_count: 40, zero_count: 2,
    bank_median_amount: 28, cu_median_amount: 22, ...o,
  };
}

describe("computeFindings", () => {
  it("builds findings only from what the data supports", () => {
    const findings = computeFindings([
      fee("overdraft", { median_amount: 25, bank_median_amount: 30, cu_median_amount: 20 }),
      fee("wire_intl_outgoing", { p25_amount: 10, p75_amount: 45, bank_median_amount: 40, cu_median_amount: 38 }),
      fee("atm_non_network", { zero_count: 30 }),
    ]);
    const byKey = Object.fromEntries(findings.map((f) => [f.key, f]));
    expect(byKey.overdraft.figure).toBe("$25.00");
    expect(byKey["charter-gap"].figure).toBe("$10.00");
    expect(byKey["charter-gap"].headline).toBe("Credit unions charge less for overdraft");
    expect(byKey["charter-gap"].detail).toContain("cheaper on 3 of 3");
    expect(byKey.spread.figure).toBe("4.5×");
    expect(byKey.free.figure).toBe("30%");
  });

  it("skips charter findings when a charter median is missing", () => {
    const findings = computeFindings([fee("nsf", { cu_median_amount: null })]);
    expect(findings.map((f) => f.key)).not.toContain("charter-gap");
  });

  it("returns nothing for no data", () => {
    expect(computeFindings([])).toEqual([]);
  });
});

describe("lowerName", () => {
  it("keeps acronyms and drops the OD tag", () => {
    expect(lowerName("overdraft")).toBe("overdraft");
    expect(lowerName("nsf")).toBe("NSF / returned item");
    expect(lowerName("atm_non_network")).toBe("non-network ATM");
  });
});
