import { describe, expect, it } from "vitest";
import type { ExtractedFee } from "@/lib/data-store/types";
import { buildAtmTwoFeeExample, pickHolderFee, pickOwnerSurcharge } from "./atm-example";

function fee(overrides: Partial<ExtractedFee>): ExtractedFee {
  return {
    id: 1,
    fee_name: "ATM fee",
    amount: 3,
    frequency: "per_transaction",
    conditions: null,
    extraction_confidence: 1,
    review_status: "approved",
    validation_flags: null,
    institution_name: "Holder Bank",
    institution_id: 1,
    fee_category: "atm_non_network",
    fee_audience: "consumer",
    source_document_id: 1,
    source_url: "https://example.test/fees.pdf",
    ...overrides,
  };
}

describe("the two-fee ATM example", () => {
  it("takes the holder bank's own out-of-network fee, never its non-customer surcharge", () => {
    const picked = pickHolderFee([
      fee({ fee_name: "Non-customer ATM surcharge", amount: 4 }),
      fee({ fee_name: "Withdrawal at non-Holder Bank ATM", amount: 2.5 }),
    ]);
    expect(picked?.amount).toBe(2.5);
  });

  it("takes only a published non-customer surcharge for the machine owner", () => {
    expect(pickOwnerSurcharge([fee({ fee_name: "Withdrawal at another bank's ATM" })])).toBeNull();
    expect(pickOwnerSurcharge([fee({ fee_name: "ATM Surcharge (Non-Customer at FFB ATM)", amount: 4 })])?.amount).toBe(4);
  });

  it("skips rows that are not live, approved dollar fees in the ATM category", () => {
    expect(
      pickHolderFee([
        fee({ review_status: "pending" }),
        fee({ amount: 0 }),
        fee({ amount: null }),
        fee({ fee_category: "card_foreign_txn" }),
      ]),
    ).toBeNull();
  });

  it.each([
    { source_document_id: null },
    { source_url: null },
    { source_url: "javascript:alert(1)" },
    { fee_audience: "business" as const },
    { source_url: "https://example.test/business-fees.pdf" },
    { amount: Infinity },
    { amount: NaN },
    { frequency: null },
    { frequency: "monthly" },
    { frequency: "annual" },
    { frequency: "hourly" },
    { source_line: "ATM withdrawal | $3 per $100 withdrawn" },
    { source_line: "ATM withdrawal | $3 per hundred dollars" },
    { source_line: "ATM withdrawal | 3% of amount" },
  ])("requires sourced consumer prices charged per event: %j", (overrides) => {
    expect(pickHolderFee([fee({ fee_name: "ATM withdrawal at another bank", ...overrides })])).toBeNull();
    expect(pickOwnerSurcharge([fee({ fee_name: "Non-customer ATM surcharge", ...overrides })])).toBeNull();
  });

  it("does not turn inquiry or generic ATM charges into a withdrawal receipt", () => {
    expect(pickHolderFee([
      fee({ fee_name: "ATM balance inquiry" }),
      fee({ fee_name: "ATM network usage fee" }),
    ])).toBeNull();
    expect(pickOwnerSurcharge([fee({ fee_name: "Non-customer ATM balance inquiry" })])).toBeNull();
  });

  it("adds the two fees to the withdrawal and shows nothing when either fee is missing", () => {
    const holder = [fee({ fee_name: "ATM withdrawal at non-Holder ATM", amount: 3 })];
    const owner = [fee({ institution_id: 2, institution_name: "Owner Bank", fee_name: "Non-customer ATM surcharge", amount: 4 })];
    expect(buildAtmTwoFeeExample(holder, owner)).toMatchObject({ withdrawal: 40, fees: 7, total: 47 });
    expect(buildAtmTwoFeeExample(holder, [])).toBeNull();
    expect(buildAtmTwoFeeExample([], owner)).toBeNull();
  });
});
