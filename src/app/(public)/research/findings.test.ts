import { describe, expect, it } from "vitest";
import type { FeeCategorySummary } from "@/lib/data-store";
import { charterCountLine, computeFindings, lowerName, shareLabel } from "./findings";

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
    expect(byKey.overdraft.headline).toBe("The median overdraft fee is $25.");
    expect(byKey["charter-gap"].figure).toBe("$10");
    expect(byKey["charter-gap"].headline).toBe("Credit union overdraft fees are $10 lower at the median.");
    expect(byKey["charter-gap"].detail).toBe("The median is $20 at credit unions and $30 at banks.");
    expect(byKey.spread.figure).toBe("4.5×");
    expect(byKey.free.figure).toBe("30%");
    expect(byKey.spread.headline).toBe("Outgoing international wire fees vary the most of these 3 fees.");
    expect(byKey.spread.detail).toBe("A quarter of institutions list $10 or less, and a quarter list $45 or more.");
    expect(byKey.free.headline).toBe("30% of institutions publish only $0 out-of-network ATM prices.");
    expect(byKey.overdraft.about).toContain("at its highest published overdraft price");
    for (const f of findings) {
      expect(f.about).toBeTruthy();
      expect(`${f.headline} ${f.detail}`).not.toMatch(/ pay | charge/);
    }
  });

  it("skips charter findings when a charter median is missing", () => {
    const findings = computeFindings([fee("nsf", { cu_median_amount: null })]);
    expect(findings.map((f) => f.key)).not.toContain("charter-gap");
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

describe("charterCountLine", () => {
  it("counts the fees where credit unions have the lower median", () => {
    expect(
      charterCountLine([
        fee("overdraft", { bank_median_amount: 30, cu_median_amount: 20 }),
        fee("nsf", { bank_median_amount: 30, cu_median_amount: 32 }),
        fee("stop_payment", { bank_median_amount: 30, cu_median_amount: 25 }),
      ]),
    ).toBe("Credit unions have the lower median on 2 of the 3 everyday fees compared.");
  });

  it("says nothing without a pair", () => {
    expect(charterCountLine([fee("overdraft", { bank_median_amount: null, cu_median_amount: 20 })])).toBeNull();
  });
});
