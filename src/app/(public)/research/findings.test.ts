import { describe, expect, it } from "vitest";
import type { FeeCategorySummary } from "@/lib/data-store";
import { computeFindings, evidenceHref, lowerName, shareLabel } from "./findings";

function fee(fee_category: string, o: Partial<FeeCategorySummary> = {}): FeeCategorySummary {
  return {
    fee_category, institution_count: 100, total_observations: 120, min_amount: 0, max_amount: 50, avg_amount: 25,
    median_amount: 25, p25_amount: 20, p75_amount: 30, bank_count: 60, cu_count: 40, zero_count: 2,
    bank_median_amount: 28, cu_median_amount: 22, ...o,
  };
}

describe("computeFindings", () => {
  it("leads with banks against credit unions, never with overdraft alone, and builds only what the data supports", () => {
    const findings = computeFindings([
      fee("overdraft", { median_amount: 25, bank_median_amount: 30, cu_median_amount: 20 }),
      fee("wire_intl_outgoing", { p25_amount: 10, p75_amount: 45, bank_median_amount: 40, cu_median_amount: 38 }),
      fee("atm_non_network", { zero_count: 30 }),
    ]);
    expect(findings.map((f) => f.key)).toEqual(["charter-count", "charter-gap", "spread", "free"]);
    const byKey = Object.fromEntries(findings.map((f) => [f.key, f]));
    expect(byKey["charter-count"].figure).toBe("3 of 3");
    expect(byKey["charter-count"].headline).toBe("Credit unions have the lower median on 3 of 3 everyday fees.");
    expect(byKey["charter-count"].fee_category).toBeUndefined();
    expect(evidenceHref(byKey["charter-count"])).toBe("#benchmarks");
    expect(byKey["charter-gap"].figure).toBe("$10");
    expect(byKey["charter-gap"].headline).toBe("Credit union overdraft fees are $10 lower at the median.");
    expect(evidenceHref(byKey["charter-gap"])).toBe("/fees/overdraft");
    expect(byKey.spread.figure).toBe("4.5×");
    expect(byKey.spread.headline).toBe("Outgoing international wire prices vary the most of these 3 fees.");
    expect(byKey.spread.detail).toBe("The middle 50% of 100 institutions runs from $10 to $45. The 75th percentile is 4.5 times the 25th.");
    expect(byKey.free.figure).toBe("30%");
    expect(byKey.free.headline).toBe("At 30% of institutions, all observed out-of-network ATM prices are $0.");
    expect(byKey.free.about).toContain("doesn't show every account is free");
    for (const f of findings) {
      expect(f.about).toBeTruthy();
      expect(`${f.headline} ${f.detail}`).not.toMatch(/ pay | charge|publish only/);
    }
  });

  it("skips charter findings when a charter median is missing", () => {
    const findings = computeFindings([fee("nsf", { cu_median_amount: null })]);
    expect(findings.map((f) => f.key)).not.toContain("charter-gap");
    expect(findings.map((f) => f.key)).not.toContain("charter-count");
  });

  it("returns nothing for no data", () => {
    expect(computeFindings([])).toEqual([]);
  });
});

describe("shareLabel", () => {
  it("never shows 0% beside a count", () => {
    expect(shareLabel(0, 900)).toBe("0%");
    expect(shareLabel(3, 900)).toBe("<1%");
    expect(shareLabel(54, 900)).toBe("6%");
  });
});

describe("lowerName", () => {
  it("keeps acronyms and drops the OD tag", () => {
    expect(lowerName("overdraft")).toBe("overdraft");
    expect(lowerName("nsf")).toBe("NSF / returned item");
    expect(lowerName("atm_non_network")).toBe("non-network ATM");
  });
});
