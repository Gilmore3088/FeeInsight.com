// @vitest-environment node
import { describe, expect, it } from "vitest";
import { runFreeSpecialists } from "@/lib/agents/knox/specialists";

// #2137: stored texts, verbatim (prod, read-only, Oct 27). Each went live as a fee at a reward the bank
// pays its customer, and v136 still read each one except Fremont's, whose read came from an older
// rules version (artifact 5610); Fremont stays as the case the issue was opened on.
const CASES: [string, string, number, RegExp][] = [
  // [bank, stored text, reward, the reward read's words]
  ["inst 247 / doc 34282 (Fremont, fee 36519)", "Paper statement fee9 $2\n\nMore Cornerstone Checking details\n\n10 Offer valid for new Fremont Bank Cornerstone personal checking clients only. Clients who currently have a personal checking account with Fremont Bank as a primary or secondary account holder are not eligible for this bonus. To receive up to a $150 bonus you must open a new Cornerstone checking account; AND complete each of the following within 60 days of account opening: 1) Earn $50 when you establish a recurring direct deposit of $500 or more; 2) Earn $50 when you complete two or more online bill payments through Fremont Bank online or mobile banking; 3) Earn $50 when you make 25 or more qualifying debit card purchases of $5 or more. Account bonus will be credited automatically to your Fremont Bank Cornerstone Checking account within 90 days of meeting all of the qualifications and will appear on your account statement.", 50, /earn|bill pay/i],
  ["inst 8664 / doc 31848 (fee 141028)", "Complete Banzai Teen course | $5 reward\n\nEnroll In Online Banking | $5 reward\n\nEnroll In eStatements | $5 reward\n\nSubmit A Mobile Deposit | $5 reward\n\nReceive Direct Deposit | $5 reward", 5, /./],
  ["inst 1028 / doc 35312 (fee 111070)", "Free Safe Deposit Box: No. However, receive a $25 credit toward the rental of a safe deposit box.", 25, /./],
  ["inst 62 / doc 24929 (fee 111041)", "Additional Gift Card Reward. Earn a $5 Starbucks Card for every ten (10) referrals made within the AUB Referral Center (limit: five (5) per calendar year).", 5, /./],
  ["inst 4381 / doc 14385 (fee 63286)", "the period. The average daily balance is computed by adding the | you may request a one-time service charge refund of $50.", 50, /./],
  ["inst 659 (fee 147528)", "Relationship Checking: for the person looking to get the most out of their checking account. Enjoy free check reorders, earn interest and benefit from higher rates on Savings, CD and Money Market accounts, receive a $100 rebate after mortgage closing, and get 50% off on the first year of your Safe D", 100, /./],
];

describe("Knox v137: a reward paid to the customer is no fee (#2137)", () => {
  it.each(CASES)("%s: no read at the reward", (_bank, text, reward, words) => {
    const read = runFreeSpecialists(text);
    expect(read.candidates.filter((fee) => fee.amount === reward && words.test(fee.feeName))).toEqual([]);
    expect(read.held.filter((fee) => fee.amount === reward && words.test(fee.feeName))).toEqual([]);
  });

  it("still reads the fees beside a reward, and a fee the customer receives", () => {
    expect(runFreeSpecialists(CASES[0][1]).candidates.some((fee) => fee.amount === 2 && /paper statement/i.test(fee.feeName))).toBe(true);
    // inst 5141, verbatim: "receive a $20.00 late fee" is a fee.
    const late = runFreeSpecialists("Credit Report Fee | $20.00\nConsumer Loan Late Fee | A payment over 10 days past due will receive a $20.00 late fee PER month past due");
    expect(late.candidates.some((fee) => fee.amount === 20 && /late fee/i.test(fee.feeName))).toBe(true);
    // inst 8386 / doc 14750, verbatim: the charge's own row beside its reward-status row still reads.
    const stcu = runFreeSpecialists("Monthly service charge | $5 reward status: not qualified\nRecurring payment stop | $5 | 5 in. × 5 in. box | $45 per year\nMonthly service charge | $5 | 9 in. × 10 in. box | $100 per year");
    expect(stcu.candidates.some((fee) => fee.amount === 5 && /monthly service charge/i.test(fee.feeName))).toBe(true);
  });

  // Review of f96afa452: a service named "Receive" (or a bare "get") is a fee, and v137 keeps the read.
  it.each([
    ["Fax Service\nSend $2.00\nReceive $1.00", 1],
    ["Fax\nReceive $1.00 per page", 1],
    ["Wire Transfer Fees\nIncoming wire\nReceive $15.00", 15],
    ["Incoming wire transfer: to receive $15.00", 15],
    ["Domestic wire, receive $15", 15],
    ["International incoming wire and receive $20", 20],
    ["Incoming Domestic Wire; you receive $15", 15],
    ["Collection items you receive $20 each", 20],
    ["Paper statement: members get $2 per statement", 2],
    ["Rush card - get a $25 card", 25],
    ["Stop payment ... you will receive $15 deducted", 15],
  ] as const)("keeps the fee in %j", (text, amount) => {
    const read = runFreeSpecialists(text);
    expect(read.candidates.some((fee) => fee.amount === amount)).toBe(true);
  });
});
