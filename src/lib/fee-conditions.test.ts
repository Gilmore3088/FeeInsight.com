import { describe, expect, it } from "vitest";
import { readerFeeConditions } from "./fee-conditions";

describe("readerFeeConditions", () => {
  it("drops Knox provenance notes", () => {
    expect(
      readerFeeConditions(
        'Knox deterministic extraction from Rosetta artifact #6560. canonical_hint=nsf; text_hash=abc; excerpt="NSF $35"',
      ),
    ).toBeNull();
    expect(readerFeeConditions("Knox held for review (range) from Rosetta artifact #6540. canonical_hint=none")).toBeNull();
    expect(readerFeeConditions("Knox read a free fee from Rosetta artifact #12. canonical_hint=atm")).toBeNull();
  });

  it("keeps real conditions", () => {
    expect(readerFeeConditions("Waived with $500 minimum balance")).toBe("Waived with $500 minimum balance");
    expect(readerFeeConditions("  per item  ")).toBe("per item");
    expect(readerFeeConditions("")).toBeNull();
    expect(readerFeeConditions(null)).toBeNull();
  });
});
