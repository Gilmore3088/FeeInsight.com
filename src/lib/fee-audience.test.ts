import { describe, expect, it } from "vitest";
import { conflictsWithAudienceStatement, feeApplicability, isConsumerFee, scopedFeeStatements } from "./fee-audience";

export const PINNACLE_NSF = "- We've eliminated Non-sufficient Funds (NSF) Returned Item fees for consumer clients and lowered them from $38 to $30 for business clients.";

describe("fee applicability", () => {
  it("splits Pinnacle's current consumer zero and business price, keeping original evidence", () => {
    const fees = scopedFeeStatements(PINNACLE_NSF);
    expect(fees.map((fee) => [fee.feeAudience, fee.amount, fee.feeTreatment])).toEqual([
      ["consumer", 0, "eliminated"], ["business", 30, "charged"],
    ]);
    expect(fees.every((fee) => fee.excerpt === PINNACLE_NSF)).toBe(true);
    expect(fees.some((fee) => fee.amount === 38)).toBe(false);
  });
  it("keeps the business value when the old and new prices are reversed", () => {
    expect(scopedFeeStatements(PINNACLE_NSF.replace("lowered them from $38 to $30", "raised them from $30 to $38"))[1]?.amount).toBe(38);
  });
  it.each([
    PINNACLE_NSF.replace("We've eliminated", "We will eliminate"),
    PINNACLE_NSF.replace("We've eliminated", "We have not eliminated"),
    PINNACLE_NSF.replace("We've eliminated", "We may have eliminated"),
    PINNACLE_NSF.replace(".", " if you maintain a minimum balance."),
    PINNACLE_NSF.replace("consumer clients", "business clients"),
    "Effective next month, we've eliminated NSF fees for consumer clients.",
  ])("does not assert an unconditional current zero from %s", (text) => {
    expect(scopedFeeStatements(text)).toEqual([]);
  });
  it("supports a completed standalone elimination, not merely an absent price", () => {
    expect(scopedFeeStatements("We've eliminated NSF fees for consumer accounts.")[0]).toMatchObject({ amount: 0, feeAudience: "consumer", feeTreatment: "eliminated" });
    expect(scopedFeeStatements("We could not find an NSF fee.")).toEqual([]);
  });
  it("does not approve Pinnacle's legacy unsplit $30 consumer-sounding name", () => {
    expect(conflictsWithAudienceStatement("We've eliminated Non-sufficient Funds (NSF) Returned Item fees for consumer clients and lowered them from", 30, PINNACLE_NSF)).toBe(true);
    for (const fee of scopedFeeStatements(PINNACLE_NSF)) {
      expect(conflictsWithAudienceStatement(fee.feeName, fee.amount, PINNACLE_NSF)).toBe(false);
    }
  });
  it.each([
    ["Courier Pick-Up (business clients only)", "$15 per item", "business"],
    ["NSF fee", "Consumer accounts only. $0", "consumer"],
    ["Overdraft Paid Item fees", "We've lowered Overdraft Paid Item fees from $38 to $30 for ***all*** clients.", "both"],
    ["Rush card replacement", "Delivered within 3 business days", "unknown"],
    ["NSF fee", "Consumer accounts $0; business accounts $30", "unknown"],
    ["NSF fee", "For all clients except business accounts", "unknown"],
  ])("reads explicit scope without guessing: %s", (name, excerpt, expected) => {
    expect(feeApplicability(name, excerpt, 30).feeAudience).toBe(expected);
  });
  it("never treats unknown, missing, or business audience as consumer", () => {
    expect(["consumer", "business", "both", "unknown", null, undefined].map((scope) => isConsumerFee(scope as Parameters<typeof isConsumerFee>[0]))).toEqual([true, false, true, false, false, false]);
  });
});


describe("audience review false positives", () => {
  it("does not confuse credit-union business with business accounts", () => {
    expect(feeApplicability("Notary Service (Credit Union Business Only)", "Notary Service (Credit Union Business Only) | FREE", 0).feeAudience).toBe("unknown");
  });
  it("does not borrow a neighboring statement fee's business audience", () => {
    expect(feeApplicability("NSF Paid Item(s) Charge", "NSF Paid Item(s) Charge $25 / Item | Monthly Statement (Business accounts only) $8 / Month", 25).feeAudience).toBe("unknown");
  });
  it("retains scope explicitly in the fee's own name despite neighboring prices", () => {
    expect(feeApplicability("NSF Fees (Business accounts only)", "NSF Fees (Business accounts only) $30 | $35", 30).feeAudience).toBe("business");
  });
});
