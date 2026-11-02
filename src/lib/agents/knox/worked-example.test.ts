import { describe, expect, it } from "vitest";
import { examplePriceNotAFee, extractCandidatesFromText, inWorkedExample, workedExampleAmountAt } from "./rules";
import { findWorkedExamples } from "@/lib/agents/darwin/worked-example-check";

// Prod sample, Nov 2: Community Choice CU (institution 7751, Rosetta artifact 32044) explains overdraft
// protection with a worked example; Knox v157 read the $10 linked-account balance as an overdraft
// transfer fee and it went live as 89920.
const LEAD = "Limits on Overdraft Protection Service. We will not transfer more than the available account balance in designated linked account if the amount of the overdraft exceeds the available amount. The following example illustrates how this works if you have elected both Overdraft Protection Service and Overdraft Privilege Overdraft Service:";
const EXAMPLE = `Assume your actual and available balances in your checking account are both $50, and your available balance in your designated linked account is $10. You write a check for $80. When the check is presented for payment, because you don’t have $80 available in your checking account or designated linked account, the item cannot be fully paid using the Overdraft Protection Service from the designated linked account. However, if you have also elected Overdraft Privilege, we may elect to transfer the $10 in your
designated linked account and pay the remaining $20.00 portion of the item using Overdraft Privilege. In such case, you will be assessed an Overdraft Privilege Fee (because the amount of the transaction exceeded $10.00 – please refer to Section D).`;
const COMMUNITY_CHOICE = `${LEAD}\n${EXAMPLE}`;
const EXCERPT = "However, if you have also elected Overdraft Privilege, we may elect to transfer the $10 in your designated linked account and pay the remaining $20.00 portion of the item using Ove";

describe("a worked example's figure is never a charge (fee 89920)", () => {
  it("Knox reads no fee from the example", () => {
    const read = extractCandidatesFromText(COMMUNITY_CHOICE);
    expect(read.candidates).toEqual([]);
    expect(read.dropped?.worked_example).toBe(2);
  });

  it("an example that quotes the bank's own price keeps it", () => {
    // Live 135705 (inst 5169) and 51683 (inst 4778) read this way and stay.
    expect(examplePriceNotAFee("In this case, we may pay the $40 check, but you will be charged an overdraft fee of $25.", 25)).toBe(false);
    expect(examplePriceNotAFee("You would then be charged a Courtesy Pay fee of $12 on the $30 item bringing your balance to ‐$54", 12)).toBe(false);
    expect(examplePriceNotAFee("There is a $5 per month service fee for Shield Checking account.", 5)).toBe(false);
    expect(examplePriceNotAFee(EXCERPT, 10)).toBe(true);
  });

  it("a sentence is in an example only after the paragraph opens one or the line above leads into one", () => {
    expect(inWorkedExample("Assume your balance is $50. You write a check for $80. ", "However, we may transfer the $10 in your account.", null)).toBe(true);
    expect(inWorkedExample("", "For example, if you have 3 overdrafts, you pay $105.", null)).toBe(true);
    expect(inWorkedExample("", "A. If your balance begins at -$5 at the time a $2 item is presented.", "For example:")).toBe(true);
    expect(inWorkedExample("Some fees may be waived. For example, ATM fees. ", "The overdraft fee is $35.", null)).toBe(false);
    expect(inWorkedExample("", "Wire transfer | $25.00", "For example:")).toBe(false);
    // The sentence the example sits in is not reached by an example later in the paragraph.
    expect(inWorkedExample("", "We may transfer the $10 in your account.", "Overdraft Protection Service")).toBe(false);
  });

  it("Darwin's live re-check finds 89920 in its stored text and nothing beside it", () => {
    const before = COMMUNITY_CHOICE.slice(0, COMMUNITY_CHOICE.indexOf("However, if you have also"));
    expect(workedExampleAmountAt(before, EXCERPT, 10)).toBe(true);
    const found = findWorkedExamples([
      { fee_published_id: 89920, fee_verified_id: 172668, institution_id: 7751, fee_name: "If you have also elected Overdraft Privilege, we may elect to transfer the", amount: "10.00", canonical_fee_key: "od_protection_transfer", excerpt: EXCERPT, text_before: before },
      { fee_published_id: 130189, fee_verified_id: 1, institution_id: 4907, fee_name: "Shield Checking Monthly Service Fee", amount: "5.00", canonical_fee_key: "monthly_maintenance",
        excerpt: "There is a $5 per month service fee for Shield Checking account.", text_before: "Example: a $1,000 balance earns the premium rate. Rates are subject to change without notice. " },
    ]);
    expect(found.matches.map((match) => match.feePublishedId)).toEqual([89920]);
    expect(found.matches[0].reason).toMatch(/^worked_example: \$10 /);
  });
});
