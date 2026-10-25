// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runFreeSpecialists } from "@/lib/agents/knox/specialists";
import { boxSectionLateFeeRead } from "@/lib/agents/knox/rules";
import type { ExtractedFeeCandidate } from "@/lib/agents/knox/rules";

// #1916: Advia FCU (doc 32751). "page | Safe Deposit Box 30 Day" over "Courtesy Pay Coverage | Late
// Payment (by credit union | $10": the box's 30-day late fee, read before v111 as a loan's late payment.
const advia = readFileSync(new URL("../../custom-report/__fixtures__/advia-two-column-source.txt", import.meta.url), "utf8");

function lateReads(text: string) {
  return runFreeSpecialists(text).candidates.filter((read) => /\blate\b/i.test(read.feeName));
}

describe("Knox v111 files a late charge in a safe deposit box section as the box's (#1916)", () => {
  it("reads Advia's two-column box late fee under the box", () => {
    const reads = lateReads(advia);
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((read) => read.canonicalHint === "safe_deposit_box")).toBe(true);
    expect(reads.some((read) => read.amount === 10)).toBe(true);
  });

  it("reads a late fee under the box heading with a box row before it, and a long name", () => {
    const text = [
      "OTHER SERVICE FEES",
      "Cashier's Check | $10.00",
      "Personal Money Orders | $5.00",
      "SAFE DEPOSIT BOX FEES",
      "Drilling Charge | $300.00",
      "Late Payment after 30 days (per month) | $20.00",
      "LOAN FEES",
      "Late Payment Fee | $25.00",
    ].join("\n");
    const reads = lateReads(text);
    expect(reads.find((read) => read.amount === 20)?.canonicalHint).toBe("safe_deposit_box");
    // The loan section's own late fee stays a late payment.
    expect(reads.find((read) => read.amount === 25)?.canonicalHint).toBe("late_payment");
  });

  it("re-files only a late payment read", () => {
    const text = "Safe Deposit Box Fees\nLate Payment (per month) | $10.00";
    const read = { feeName: "Late Payment (per month)", amount: 10, canonicalHint: "late_payment", excerpt: "Late Payment (per month) | $10.00" } as ExtractedFeeCandidate;
    expect(boxSectionLateFeeRead(read, text).canonicalHint).toBe("safe_deposit_box");
    const stop = { ...read, feeName: "Stop Payment", canonicalHint: "stop_payment" } as ExtractedFeeCandidate;
    expect(boxSectionLateFeeRead(stop, text)).toBe(stop);
  });
});
