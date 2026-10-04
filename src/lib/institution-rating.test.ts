import { describe, it, expect } from "vitest";
import {
  NO_VERDICT_LABEL,
  computeInstitutionRating,
  deriveStrengthsAndWatch,
  detectPaidItemFee,
  generateInterpretation,
} from "./institution-rating";
import type { IndexEntry } from "./data-store/fee-index";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEntry(category: string, median: number): IndexEntry {
  return {
    fee_category: category,
    fee_family: null,
    institution_count: 100,
    median_amount: median,
    p25_amount: median * 0.75,
    p75_amount: median * 1.25,
    min_amount: 0,
    max_amount: median * 2,
    approved_count: 80,
    observation_count: 100,
    bank_count: 60,
    cu_count: 40,
    maturity_tier: "strong",
    last_updated: null,
  };
}

const NATIONAL_INDEX: IndexEntry[] = [
  makeEntry("overdraft", 35),
  makeEntry("monthly_maintenance", 12),
  makeEntry("wire_domestic_outgoing", 25),
  makeEntry("nsf", 32),
  makeEntry("atm_non_network", 3),
];

// ---------------------------------------------------------------------------
// computeInstitutionRating
// ---------------------------------------------------------------------------

function rated(fees: Parameters<typeof computeInstitutionRating>[0]) {
  const result = computeInstitutionRating(fees, NATIONAL_INDEX);
  if (result === null) throw new Error("expected a rating");
  return result;
}

describe("computeInstitutionRating", () => {
  it("returns green/Consumer-Friendly when the overdraft fee is ≤ $20", () => {
    const result = rated([
      { id: 1, fee_name: "overdraft", amount: 15, fee_category: "overdraft", conditions: null },
    ]);
    expect(result.color).toBe("green");
    expect(result.label).toBe("Consumer-Friendly");
    expect(result.bullets.length).toBeGreaterThan(0);
  });

  it("returns green when the overdraft fee is exactly $20", () => {
    const result = rated([
      { id: 1, fee_name: "Overdraft Fee", amount: 20, fee_category: "overdraft", conditions: null },
    ]);
    expect(result.color).toBe("green");
  });

  it("returns yellow/Average Fee Structure when overdraft is $30 with 18 total fees", () => {
    const result = rated([
      { id: 1, fee_name: "overdraft", amount: 30, fee_category: "overdraft", conditions: null },
      ...Array.from({ length: 17 }, (_, i) => ({
        id: i + 2,
        fee_name: `fee_${i}`,
        amount: 5,
        fee_category: `other_${i}`,
        conditions: null,
      })),
    ]);
    expect(result.color).toBe("yellow");
    expect(result.label).toBe("Average Fee Structure");
    expect(result.bullets.length).toBeGreaterThan(0);
  });

  it("returns yellow when overdraft is in range 20.01-36", () => {
    const result = rated([
      { id: 1, fee_name: "overdraft fee", amount: 28, fee_category: "overdraft", conditions: null },
    ]);
    expect(result.color).toBe("yellow");
  });

  it("returns red/Above-Average Fees when overdraft > $36", () => {
    const result = rated([
      { id: 1, fee_name: "overdraft", amount: 40, fee_category: "overdraft", conditions: null },
    ]);
    expect(result.color).toBe("red");
    expect(result.label).toBe("Above-Average Fees");
    expect(result.bullets.length).toBeGreaterThan(0);
  });

  it("ignores transfer/protection overdraft rows and falls back to the NSF fee", () => {
    const fees = [
      {
        id: 1,
        fee_name: "Overdraft Fee - Per Transfer from Another Deposit Account",
        amount: 5,
        fee_category: "overdraft",
        conditions: null,
      },
      { id: 2, fee_name: "Overdraft Protection Enrollment", amount: 3, fee_category: "overdraft", conditions: null },
      { id: 3, fee_name: "NSF Fee", amount: 33, fee_category: "nsf", conditions: null },
    ];
    expect(detectPaidItemFee(fees)).toEqual({ amount: 33, conditions: null, kind: "nsf" });
    const result = rated(fees);
    expect(result.color).toBe("yellow");
    expect(result.bullets[0]).toBe("NSF fee: $33");
    expect(result.bullets.some((b) => /aligned with the national median/.test(b))).toBe(true);
  });

  it("returns null (no verdict) when no paid-item overdraft or NSF fee is verified", () => {
    const fees = [
      { id: 1, fee_name: "monthly_maintenance", amount: 5, fee_category: "monthly_maintenance", conditions: null },
      { id: 2, fee_name: "wire_domestic_outgoing", amount: 20, fee_category: "wire_domestic_outgoing", conditions: null },
      { id: 3, fee_name: "Overdraft Transfer Fee", amount: 5, fee_category: "overdraft", conditions: null },
    ];
    expect(computeInstitutionRating(fees, NATIONAL_INDEX)).toBeNull();
    expect(NO_VERDICT_LABEL).toBe("Overdraft fee not published");
  });

  it("returns null when fees array is empty", () => {
    expect(computeInstitutionRating([], NATIONAL_INDEX)).toBeNull();
  });

  it("bonus signals: fee cap in conditions can upgrade yellow-border overdraft toward green", () => {
    // overdraft at $22 (technically yellow) with a daily cap policy
    const result = rated([
      {
        id: 1,
        fee_name: "overdraft",
        amount: 22,
        fee_category: "overdraft",
        conditions: "maximum 4 fees per day cap applies",
      },
    ]);
    // Should still be yellow or green -- importantly should NOT be red
    expect(result.color).not.toBe("red");
    // Bullets should mention the cap signal
    expect(result.bullets.some((b) => /cap|limit/i.test(b))).toBe(true);
  });

  it("returns at most 3 bullets", () => {
    const result = rated([
      { id: 1, fee_name: "overdraft", amount: 35, fee_category: "overdraft", conditions: "daily cap" },
      { id: 2, fee_name: "monthly_maintenance", amount: 5, fee_category: "monthly_maintenance", conditions: null },
      { id: 3, fee_name: "nsf", amount: 25, fee_category: "nsf", conditions: null },
    ]);
    expect(result.bullets.length).toBeLessThanOrEqual(3);
  });

  it("validates fee amounts are finite before comparison (threat T-30.1-01)", () => {
    const fees = [
      { id: 1, fee_name: "overdraft", amount: NaN, fee_category: "overdraft", conditions: null },
      { id: 2, fee_name: "monthly_maintenance", amount: -5, fee_category: "monthly_maintenance", conditions: null },
    ];
    // Should not throw; NaN overdraft is not a usable paid-item fee, so no verdict
    expect(computeInstitutionRating(fees, NATIONAL_INDEX)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// deriveStrengthsAndWatch
// ---------------------------------------------------------------------------

describe("deriveStrengthsAndWatch", () => {
  it("returns max 2 strengths and max 2 watch items when fees above/below median", () => {
    const fees = [
      { id: 1, fee_name: "monthly_maintenance", amount: 5, fee_category: "monthly_maintenance", conditions: null },
      { id: 2, fee_name: "wire_domestic_outgoing", amount: 5, fee_category: "wire_domestic_outgoing", conditions: null },
      { id: 3, fee_name: "nsf", amount: 5, fee_category: "nsf", conditions: null },
      { id: 4, fee_name: "atm_non_network", amount: 10, fee_category: "atm_non_network", conditions: null },
      { id: 5, fee_name: "overdraft", amount: 50, fee_category: "overdraft", conditions: null },
    ];
    const { strengths, watch } = deriveStrengthsAndWatch(fees, NATIONAL_INDEX);
    expect(strengths.length).toBeLessThanOrEqual(2);
    expect(watch.length).toBeLessThanOrEqual(2);
  });

  it("derives from fee count only when no category matches exist", () => {
    const fees = [
      { id: 1, fee_name: "unique_fee_xyz", amount: 10, fee_category: "unique_xyz", conditions: null },
    ];
    const { strengths, watch } = deriveStrengthsAndWatch(fees, NATIONAL_INDEX);
    // Should return some content without throwing
    expect(Array.isArray(strengths)).toBe(true);
    expect(Array.isArray(watch)).toBe(true);
  });

  it("returns empty arrays when fees array is empty", () => {
    const { strengths, watch } = deriveStrengthsAndWatch([], NATIONAL_INDEX);
    expect(strengths.length).toBe(0);
    expect(watch.length).toBe(0);
  });

  it("identifies fees significantly below median (>10% below) as strengths", () => {
    const fees = [
      // monthly_maintenance median=12, this is $5 = 58% below → strong candidate
      { id: 1, fee_name: "monthly_maintenance", amount: 5, fee_category: "monthly_maintenance", conditions: null },
    ];
    const { strengths } = deriveStrengthsAndWatch(fees, NATIONAL_INDEX);
    expect(strengths.length).toBeGreaterThan(0);
  });

  it("identifies fees significantly above median (>10% above) as watch items", () => {
    const fees = [
      // overdraft median=35, this is $60 = 71% above → watch item
      { id: 1, fee_name: "overdraft", amount: 60, fee_category: "overdraft", conditions: null },
    ];
    const { watch } = deriveStrengthsAndWatch(fees, NATIONAL_INDEX);
    expect(watch.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// generateInterpretation
// ---------------------------------------------------------------------------

describe("generateInterpretation", () => {
  it("returns 2-3 sentences for a typical green institution", () => {
    const text = generateInterpretation({
      rating: { label: "Consumer-Friendly", color: "green", bullets: [] },
      feeCount: 18,
      overdraftAmount: 15,
      charterType: "credit_union",
    });
    const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
    expect(sentences.length).toBeGreaterThanOrEqual(2);
    expect(sentences.length).toBeLessThanOrEqual(3);
  });

  it("works with null overdraftAmount (uses fee count only)", () => {
    const text = generateInterpretation({
      rating: { label: "Average Fee Structure", color: "yellow", bullets: [] },
      feeCount: 22,
      overdraftAmount: null,
      charterType: "bank",
    });
    expect(text.length).toBeGreaterThan(20);
    expect(typeof text).toBe("string");
  });

  it("contains no jargon terms like APR, bps, basis points, CAGR", () => {
    const text = generateInterpretation({
      rating: { label: "Above-Average Fees", color: "red", bullets: [] },
      feeCount: 45,
      overdraftAmount: 40,
      charterType: "bank",
    });
    const jargon = ["APR", "bps", "basis points", "CAGR", "YoY", "QoQ"];
    for (const term of jargon) {
      expect(text).not.toContain(term);
    }
  });

  it("returns a non-empty string for zero fees", () => {
    const text = generateInterpretation({
      rating: { label: "Average Fee Structure", color: "yellow", bullets: [] },
      feeCount: 0,
      overdraftAmount: null,
      charterType: null,
    });
    expect(text.length).toBeGreaterThan(10);
  });
});
