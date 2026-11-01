import { describe, expect, it } from "vitest";

import { classifyFeeText, extractFromSegment } from "./rules";

/**
 * v101: rows Knox read at the answer key's own price but held unclassified, because no name rule
 * knew the wording (shadow lab, Oct 22). Each positive line is the key's own source line (state key
 * tid noted). Each rule has a near miss beside it that must stay unfiled or keep its own category.
 */
const hint = (line: string) => extractFromSegment(line).candidates.map((c) => [c.canonicalHint, c.amount]);

describe("v101: held names the shadow lab showed Knox reading at the right price", () => {
  it("reads a bill payer as bill pay", () => {
    expect(classifyFeeText("Bill Payer")).toBe("bill_pay"); // tid 7450
    expect(classifyFeeText("Automated (Recurring) Loan Transfer Bill Payer")).toBe("bill_pay"); // tid 9308
    expect(hint("Bill Payer | $2.00")).toEqual([["bill_pay", 2]]);
  });

  it("leaves a payer that is not a bill payer unfiled", () => {
    expect(classifyFeeText("Payer Change Request")).toBeNull();
    expect(classifyFeeText("Bill Payer Stop Payment")).toBe("stop_payment");
  });

  it("reads a cash advanced fee as a cash advance", () => {
    expect(hint("Cash Advanced Fee | $5.00")).toEqual([["cash_advance", 5]]); // tid 3141 (keyed at None)
  });

  it("keeps an account named Cash Advantage out of cash advance", () => {
    expect(classifyFeeText("Cash Advantage Checking")).toBeNull();
  });

  it("keeps a cash advanced limit or cap out of cash advance (review of #2547)", () => {
    expect(hint("Maximum cash advanced per day: $1,000")).toEqual([]);
    expect(hint("Cash advanced limit $500")).toEqual([]);
    expect(classifyFeeText("Cash advanced up to $500")).toBeNull();
    expect(classifyFeeText("Cash advanced limit")).toBeNull();
    expect(classifyFeeText("Cash advanced per transaction fee")).toBeNull();
  });

  it("reads gift cards sold with other cards as a gift card purchase", () => {
    expect(hint("Gift and Reloadable Travel Cards | $3.00")).toEqual([["gift_card_purchase", 3]]); // tid 11477
    expect(classifyFeeText("Gift & Prepaid Cards")).toBe("gift_card_purchase");
  });

  it("leaves reloadable travel cards alone and a gift of funds unfiled", () => {
    expect(classifyFeeText("Reloadable Travel Cards")).toBeNull();
    expect(classifyFeeText("Gift and Estate Tax Letters")).toBeNull();
    // Review of #2547: a gift card beside a debit, Visa or credit card names no gift card purchase.
    expect(classifyFeeText("Gift and Debit Cards")).toBeNull();
    expect(classifyFeeText("Gift & Visa Cards")).toBeNull();
    expect(classifyFeeText("Gift or Credit Cards")).toBeNull();
  });

  it("leaves a bare monthly account maintenance row held: the name cannot tell an account's from a card's", () => {
    // tid 7450 keys it as the account's; tid 3141 prints it under a "Gift Card" heading (unmapped).
    expect(classifyFeeText("Monthly Account Maintenance")).toBeNull();
    expect(classifyFeeText("Inactive Account Maintenance (after 1 year inactivity)")).toBe("dormant_account"); // tid 10358
  });

  it("reads an ACH file or template as ACH origination", () => {
    expect(hint("ACH File Fee (per file) | $15.00")).toEqual([["ach_origination", 15]]); // tid 1338
    expect(hint("ACH Payments - template (per item) | $0.21")).toEqual([["ach_origination", 0.21]]); // tid 1338
  });

  it("keeps a returned ACH file a return and an ACH debit received unfiled", () => {
    expect(classifyFeeText("ACH File Returned")).toBe("ach_return");
    expect(classifyFeeText("ACH Debit Received")).toBeNull();
    // Review of #2547: receiving, reversing or deleting a file is not sending one.
    expect(classifyFeeText("ACH File Received")).toBeNull();
    expect(classifyFeeText("Incoming ACH File")).toBeNull();
    expect(classifyFeeText("ACH File Reversal")).toBeNull();
    expect(classifyFeeText("ACH File Delete")).toBeNull();
    expect(hint("ACH files received after 4:00 PM are processed the next business day; late file fee $25.00")).toEqual([]);
  });

  it("reads balancing or research and a records look-up as account research", () => {
    expect(hint("After balancing or research | $25.00")).toEqual([["account_research", 25]]); // tid 5703
    expect(hint("Special Request Look Up | $10.00 per account")).toEqual([["account_research", 10]]); // tid 4677
    expect(classifyFeeText("Account Lookup")).toBe("account_research");
  });

  it("keeps a balance look-up and a research note that names no fee out of research", () => {
    expect(classifyFeeText("Balance Look Up")).not.toBe("account_research");
    expect(classifyFeeText("Look Up Your Routing Number")).toBeNull();
    // Review of #2547: a look-up by phone is usually a balance inquiry.
    expect(classifyFeeText("Account Look-up via phone")).toBeNull();
    expect(classifyFeeText("Telephone Account Lookup")).toBeNull();
  });

  it("reads a bare account closure row as early closure", () => {
    expect(hint("Account Closure $20.00 if account closed within 30 days")).toEqual([["early_closure", 20]]); // tid 60
    expect(hint("Account Closure | $5.00 if account is closed within 180 days")).toEqual([["early_closure", 5]]); // tid 12816
    expect(classifyFeeText("Account Closing")).toBe("early_closure");
  });

  it("keeps a loan's or a certificate's closure and a closure notice out of early closure", () => {
    expect(classifyFeeText("Loan Account Closure")).not.toBe("early_closure");
    expect(classifyFeeText("Certificate Account Closure")).not.toBe("early_closure");
    expect(classifyFeeText("Account Closure Notice Letter")).not.toBe("early_closure");
  });

  it("reads a refinance of a loan or line and a home equity line's early closure as other lending", () => {
    expect(hint("Refinance to reduce loan rate | $200 each refinance")).toEqual([["other_lending_fee", 200]]); // tid 8034
    expect(hint("Early closure fee for home equity loan/line within two years of opening | $100")).toEqual([
      ["other_lending_fee", 100],
    ]); // tid 8034
    expect(classifyFeeText("Early termination of HELOC")).toBe("other_lending_fee");
  });

  it("keeps a deposit account's early closure and a refinance with no loan named where they were", () => {
    expect(classifyFeeText("Early Account Closure")).toBe("early_closure");
    expect(classifyFeeText("Refinance Seminar")).toBeNull();
    // tid 9308: a rate sheet's prose about a loan names no refinance fee.
    expect(classifyFeeText("Land loans: loan to value of 90%. Can be used for refinances or purchase loans")).toBeNull();
  });

  it("reads a card's expedited order behind a service-charge label as a rush card", () => {
    expect(
      hint("Debit Card or PIN (Personal Identification Number) Expedited Order (EFT Service Charge) | $75.00"),
    ).toEqual([["rush_card", 75]]); // tid 12752
  });

  it("still keeps a card's own monthly service charge out of monthly maintenance", () => {
    expect(classifyFeeText("Debit Card Monthly Service Charge")).toBeNull();
    expect(classifyFeeText("Loan Service Charge")).toBeNull();
  });
});
