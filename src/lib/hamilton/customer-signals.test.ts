import { describe, expect, it } from "vitest";
import { INTERNAL_REVIEW_SIGNAL_TYPES, isCustomerSignal } from "./customer-signals";

describe("isCustomerSignal", () => {
  it("keeps internal review signals out of the Pro feed", () => {
    expect(isCustomerSignal("darwin_verification_needs_review")).toBe(false);
    expect(isCustomerSignal("knox_extraction_needs_review")).toBe(false);
  });

  it("keeps market and fee-change signals", () => {
    expect(isCustomerSignal("hamilton_competitor_fee_change")).toBe(true);
    expect(isCustomerSignal("hamilton_fee_movement_detected")).toBe(true);
    expect(isCustomerSignal("darwin_verification_completed")).toBe(true);
  });

  it("lists every internal *_needs_review type the pipeline raises", () => {
    expect([...INTERNAL_REVIEW_SIGNAL_TYPES].sort()).toEqual([
      "darwin_verification_needs_review",
      "knox_extraction_needs_review",
    ]);
  });
});
