import { describe, expect, it } from "vitest";
import { rewardCreditOf } from "./reward-credit";

// #2137: money a bank pays its customer is no fee. Lines verbatim from stored texts (prod, read-only,
// Oct 27) unless marked.
describe("rewardCreditOf (#2137)", () => {
  it.each([
    // [line, amount, fee name]
    ["AND complete each of the following within 60 days of account opening: 1) Earn $50 when you establish a recurring direct deposit of $500 or more;", 50, "2 Earn"],
    ["2) Earn $50 when you complete two or more online bill payments through Fremont Bank online or mobile banking", 50, "2 Earn"],
    ["To receive up to a $150 bonus you must open a new Cornerstone checking account;", 150, null],
    ["11 Receive $10 each month, up to $120 annually, when you are enrolled in Automatic Loan Payments", 10, null],
    ["Submit A Mobile Deposit | $5 reward", 5, "Submit A Mobile Deposit"],
    ["Mt. Money ($5 reward ): Save $100 in your Junior Smart Saver Account.", 5, "Mt. Money"],
    ["Free Safe Deposit Box: No. However, receive a $25 credit toward the rental of a safe deposit box.", 25, "Free Safe Deposit Box: No. However, receive a $25"],
    ["Additional Gift Card Reward. Earn a $5 Starbucks Card for every ten (10) referrals made within the AUB Referral Center", 5, "Additional Gift Card Reward. Earn"],
    ["the period. The average daily balance is computed by adding the | you may request a one-time service charge refund of $50.", 50, "you may request a one-time service charge refund of"],
    // Not verbatim: the other shapes the class takes.
    ["Get a $300 bonus when you open a new checking account", 300, null],
    ["We'll credit $25 to your account after your first direct deposit", 25, null],
  ] as const)("%s: a reward", (line, amount, name) => {
    expect(rewardCreditOf(line, amount, name)).not.toBeNull();
  });

  it.each([
    ["Consumer Loan Late Fee | A payment over 10 days past due will receive a $20.00 late fee PER month past due", 20, "Consumer Loan Late Fee"],
    ["You must maintain a minimum balance of $1,000 to earn interest. You will receive a $25 service charge if you don't keep an average balance of $15,000", 25, "Service charge"],
    ["Many of our checking products offer overdraft coverage, based upon qualification. Qualifying accounts receive a $31 fee for every overdrawn check", 31, null],
    ["and (4) You will receive reimbursement of our $2.95 Consumer Bill Pay Fee per monthly statement cycle", 2.95, "Consumer Bill Pay Fee"],
    ["Receive: $45 per wire transfer", 45, "International Wire Transfers - Receive"],
    ["garnishment received $75.00 per each", 75, "garnishment received"],
    ["Legal Orders/Levies Received $35.00", 35, "Legal Orders/Levies Received"],
    ["Send/Receive fax……..$2.00 per page", 2, "Send/Receive fax"],
    ["Wire Receive (Domestic and Int’l): Domestic $15 / Foreign $40", 15, "Wire Receive (Domestic and Int’l): Domestic"],
    ["$5 Monthly Service Charge - Waived with $1,000 in Daily Minimum Balance OR receive $1,000 or more in Monthly Direct Deposits", 5, "Monthly Service Charge"],
    ["$8 monthly service charge; earn $4 credits up to $8 for each of the following:", 8, "monthly service charge; earn credits up to"],
    ["Monthly service charge of $9.95; customers who have a direct deposit into this account during the monthly cycle will receive a $1.00 credit", 9.95, "Monthly service charge"],
    ["Replacement card fee $10.00 You may get a replacement card for $10.00.", 10, "Replacement card fee"],
    ["Money Order Copy or Refund $2", 2, "Money Order Copy or Refund"],
    ["How Can I Get Up To $150 in Cover Me Now Overdraft Privilege? / $50", 50, "Cover Me Now Overdraft Privilege?"],
    ["Mastercard Gift Card | $3.00 each (Elite Reward Member $1.50 each)", 3, "Mastercard Gift Card"],
  ] as const)("%s: a fee", (line, amount, name) => {
    expect(rewardCreditOf(line, amount, name)).toBeNull();
  });
});
