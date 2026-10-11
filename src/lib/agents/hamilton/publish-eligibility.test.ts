import { describe, expect, it } from "vitest";
import { publishSkipReason as publicSkipReason, type VerifiedFeeRow } from "./publish";
import {
  normalizedAmount,
  normalizedConfidence,
  publishSkipReason,
} from "./publish-eligibility";

const eligibleFee: VerifiedFeeRow = {
  fee_verified_id: 801,
  fee_raw_id: 701,
  institution_id: 42,
  source_url: "https://testbank.example/fees",
  document_r2_key: null,
  extraction_confidence: "0.92",
  canonical_fee_key: "overdraft",
  variant_type: null,
  outlier_flags: ["agentic_darwin_verified"],
  verified_by_agent_event_id: "00000000-0000-4000-8000-000000000801",
  fee_name: "Overdraft fee",
  amount: 35,
  frequency: "per_item",
  raw_agent_event_id: null,
};

describe("R06 publication eligibility extraction", () => {
  it("preserves the original public export and accepted published-fee path", () => {
    expect(publicSkipReason).toBe(publishSkipReason);
    expect(publishSkipReason(eligibleFee, 0.8, false)).toBeNull();
  });

  it("retains hard blockers before confidence and lineage checks", () => {
    expect(publishSkipReason({ ...eligibleFee, outlier_flags: [] }, 0.8, false))
      .toBe("Not verified by the agentic Darwin path");
    expect(publishSkipReason({ ...eligibleFee, outlier_flags: ["agentic_darwin_verified", "needs_human"], source_url: null }, 0.8, false))
      .toBe("Blocking flag: needs_human");
    expect(publishSkipReason({ ...eligibleFee, source_url: null }, 0.8, false))
      .toBe("Missing source lineage");
    expect(publishSkipReason({ ...eligibleFee, extraction_confidence: 0.79 }, 0.8, false))
      .toBe("Below publish confidence threshold");
  });

  it("keeps fee-rate and dollar-amount safety checks separate", () => {
    expect(publishSkipReason({ ...eligibleFee, amount: 0 }, 0.8, false))
      .toBe("Missing or invalid amount");
    expect(publishSkipReason({ ...eligibleFee, amount_kind: "percent", amount: null, rate_percent: 1 }, 0.8, false))
      .toBe("Rate in a category that does not publish rates");
  });

  it("preserves numeric normalization without coercing invalid amounts", () => {
    expect(normalizedAmount("18.5")).toBe(18.5);
    expect(normalizedAmount("invalid")).toBeNull();
    expect(normalizedAmount(null)).toBeNull();
    expect(normalizedConfidence("0.8")).toBe(0.8);
    expect(normalizedConfidence(Infinity)).toBe(0);
    expect(normalizedConfidence("1.4")).toBe(1);
  });
});
