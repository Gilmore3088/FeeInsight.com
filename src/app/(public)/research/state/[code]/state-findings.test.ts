import { describe, expect, it } from "vitest";
import type { IndexEntry } from "@/lib/data-store";
import { buildCharterPairs, buildComparisons, computeStateFindings, formatDelta } from "./state-findings";

function entry(fee_category: string, o: Partial<IndexEntry> = {}): IndexEntry {
  return {
    fee_category, fee_family: null, median_amount: 20, p25_amount: 15, p75_amount: 25, min_amount: 0, max_amount: 40,
    institution_count: 30, observation_count: 30, approved_count: 30, bank_count: 15, cu_count: 15,
    maturity_tier: "strong", last_updated: null, ...o,
  };
}

const national = [
  entry("overdraft", { median_amount: 29 }),
  entry("stop_payment", { median_amount: 26 }),
  entry("card_replacement", { median_amount: 10 }),
  entry("monthly_maintenance", { median_amount: 6 }),
];

describe("buildComparisons", () => {
  it("keeps only state medians under the contract and computes the delta", () => {
    const rows = buildComparisons(
      [entry("overdraft", { median_amount: 29.75 }), entry("stop_payment", { median_amount: null, institution_count: 3 })],
      national,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].national_median).toBe(29);
    expect(rows[0].delta_pct).toBeCloseTo(2.586, 2);
  });
});

describe("computeStateFindings", () => {
  const comparisons = buildComparisons(
    [
      entry("overdraft", { median_amount: 29.75, institution_count: 28 }),
      entry("stop_payment", { median_amount: 30, institution_count: 33 }),
      entry("card_replacement", { median_amount: 6.25, institution_count: 24 }),
      entry("monthly_maintenance", { median_amount: 12, institution_count: 6 }),
    ],
    national,
  );

  it("headlines overdraft, the biggest premium and the biggest discount", () => {
    const pairs = buildCharterPairs(
      [entry("overdraft", { median_amount: 32 })],
      [entry("overdraft", { median_amount: 25 })],
      ["overdraft"],
    );
    const byKey = Object.fromEntries(computeStateFindings("Texas", comparisons, pairs).map((f) => [f.key, f]));
    expect(byKey.overdraft.figure).toBe("$29.75");
    expect(byKey.overdraft.detail).toContain("3% above the national median of $29.00");
    expect(byKey.premium.figure).toBe("+15%");
    expect(byKey.premium.headline).toBe("Stop Payment runs furthest above national");
    expect(byKey.discount.figure).toBe("−38%");
    expect(byKey["charter-gap"].figure).toBe("$7.00");
  });

  it("never headlines a fee with fewer than 10 state institutions", () => {
    const findings = computeStateFindings("Texas", comparisons, []);
    // Monthly maintenance is +100% but only 6 institutions, so the premium stays stop payment.
    expect(findings.find((f) => f.key === "premium")?.figure).toBe("+15%");
    expect(findings.find((f) => f.key === "tally")?.figure).toBe("2 of 3");
  });

  it("returns nothing when the state has no solid medians", () => {
    expect(computeStateFindings("Wyoming", buildComparisons([entry("overdraft", { institution_count: 6 })], national), [])).toEqual([]);
  });
});

describe("formatDelta", () => {
  it("formats signs and tiny gaps", () => {
    expect(formatDelta(15.4)).toBe("+15%");
    expect(formatDelta(-37.5)).toBe("−38%");
    expect(formatDelta(0.3)).toBe("<1%");
    expect(formatDelta(0)).toBe("same");
  });
});
