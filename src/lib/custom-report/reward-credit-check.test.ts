import { afterEach, describe, expect, it } from "vitest";
import { checkFeeAgainstSource, REWARD_CREDIT_SWITCH, rewardCreditRefusalLive } from "./source-check";

// Fremont Bank (inst 247), text 32292 for doc 34282, verbatim: footnote 10, the promotion live fee
// 36519 ("2 Earn", $50, bill_pay) was read from (#2137).
const FREMONT = "Paper statement fee9 $2\n\nMore Cornerstone Checking details\n\n10 Offer valid for new Fremont Bank Cornerstone personal checking clients only. Clients who currently have a personal checking account with Fremont Bank as a primary or secondary account holder are not eligible for this bonus. To receive up to a $150 bonus you must open a new Cornerstone checking account; AND complete each of the following within 60 days of account opening: 1) Earn $50 when you establish a recurring direct deposit of $500 or more; 2) Earn $50 when you complete two or more online bill payments through Fremont Bank online or mobile banking; 3) Earn $50 when you make 25 or more qualifying debit card purchases of $5 or more. Account bonus will be credited automatically to your Fremont Bank Cornerstone Checking account within 90 days of meeting all of the qualifications and will appear on your account statement.\n\n11 Receive $10 each month, up to $120 annually, when you are enrolled in Automatic Loan Payments and complete any three of the following qualifying activities on this account: 1) Receive account e-Statements; 2) Receive a recurring direct deposit of $500 or more; 3) Complete at least one online bill payment; or 4) Make five or more qualifying debit card purchases of $5 or more. Rewards will be credited to the account and reported as interest, and Fremont Bank may issue an Internal Revenue Service Form 1099 (or another appropriate form) to you that reflects the value of the account credit.";

// Stored texts, verbatim (prod, read-only, Oct 27; #2137): every line of the fee's own text that prints
// its amount. Each live flat fee is a reward paid to the customer, and the shared check traced each one
// before v28.
const BANKS: [string, string, string, number, string][] = [
  // [institution / document / fee, stored text, fee name, amount, canonical key]
  ["inst 247 / doc 34282 / fee 36519", FREMONT, "2 Earn", 50, "bill_pay"],
  ["inst 8664 / doc 31848 / fee 141028", "Special Delivery Outpost ($5 reward ): Make sure all your mail goes to the right spot by confirming the email address with your Junior Smart Saver Account.\nEducation Station 1 ($5 reward ): Complete the Banzai Junior course.\nMt. Money ($5 reward ): Save $100 in your Junior Smart Saver Account.\nComplete Banzai Teen course | $5 reward\nEnroll In Online Banking | $5 reward\nEnroll In eStatements | $5 reward\nSubmit A Mobile Deposit | $5 reward\nReceive Direct Deposit | $5 reward\nOpen A Checking Account With Debit Card | $5 reward",
    "Submit A Mobile Deposit", 5, "mobile_deposit"],
  ["inst 1028 / doc 35312 / fee 111070", "Free Safe Deposit Box: No. However, receive a $25 credit toward the rental of a safe deposit box.",
    "Free Safe Deposit Box: No. However, receive", 25, "safe_deposit_box"],
  ["inst 62 / doc 24929 / fee 111041", "Additional Gift Card Reward. Earn a $5 Starbucks Card for every ten (10) referrals made within the AUB Referral Center (limit: five (5) per calendar year). Each referral must be to a unique non-customer (name and/or email address).",
    "Additional Gift Card Reward. Earn", 5, "gift_card_purchase"],
  ["inst 1453 / doc 28718 / fee 133387", "$100 credit on a New Arbor Bank Mortgage**\n**$100 credit toward closing costs (for example, appraisal or title insurance fees) on a secondary market mortgage loan, which is a closed-end, consumer-purpose, 1-4 family dwelling-secured, fixed-rate, long-term, fully-amortizing loan. All loans are subject to credit approval.",
    "credit toward closing costs (for example, appraisal or title insurance fees) on a secondary market mortgage loan, which", 100, "appraisal_fee"],
  ["inst 4381 / doc 14385 / fee 63286", "Opportunity Checking 0.000% 0.00% $50 NA NA\nPercentage Yield. For all dividend bearing accounts, dividends are | Opportunity Checking accounts require a $50 minimum opening\nthe period. The average daily balance is computed by adding the | you may request a one-time service charge refund of $50.\nVisa Debit Card Replacement Rush ...........$50.00 ($25.00 for Teen\nGarnishment/Levy Processing ............................................ $50.00",
    "the period. The average daily balance is computed by adding the | you may request a one-time service charge refund of", 50, "monthly_maintenance"],
  ["inst 659 / fee 147528", "Relationship Checking: for the person looking to get the most out of their checking account. Enjoy free check reorders, earn interest and benefit from higher rates on Savings, CD and Money Market accounts, receive a $100 rebate after mortgage closing, and get 50% off on the first year of your Safe D\n(5) Maintain a $100 minimum average daily balance to waive the $6 monthly maintenance service charge.",
    "Enjoy free check reorders", 100, "check_printing"],
];

const traces = (result: ReturnType<typeof checkFeeAgainstSource>) => result.ok || result.reason === "tiered_fee";

describe("source check v28: a reward paid to the customer is not a fee (#2137)", () => {
  afterEach(() => { delete process.env[REWARD_CREDIT_SWITCH]; });

  it.each(BANKS)("%s: traced as before with the refusal off, refused as reward_credit with it on", (_bank, text, name, amount, key) => {
    expect(traces(checkFeeAgainstSource(text, name, amount, ".", key, { rewardCredits: false }))).toBe(true);
    expect(checkFeeAgainstSource(text, name, amount, ".", key, { rewardCredits: true })).toEqual({ ok: false, reason: "reward_credit" });
  });

  it("is off unless SOURCE_CHECK_REWARD_CREDIT=on, and the switch sets the default", () => {
    const [, text, name, amount, key] = BANKS[0];
    expect(rewardCreditRefusalLive()).toBe(false);
    expect(traces(checkFeeAgainstSource(text, name, amount, ".", key))).toBe(true);
    process.env[REWARD_CREDIT_SWITCH] = "on";
    expect(rewardCreditRefusalLive()).toBe(true);
    expect(checkFeeAgainstSource(text, name, amount, ".", key)).toEqual({ ok: false, reason: "reward_credit" });
  });

  it("keeps a fee the schedule also prices on a row of its own, and the rows around a reward", () => {
    // inst 8386 / doc 14750 (fee 15666), verbatim: the reward-status row sits beside the charge's own row.
    const stcu = "Monthly service charge | $5 reward status: not qualified\nMember fee (payable to other) | $5 per item | Research | $25 per hour w/$5 minimum\nRecurring payment stop | $5 | 5 in. × 5 in. box | $45 per year\nMonthly service charge | $5 | 9 in. × 10 in. box | $100 per year";
    expect(checkFeeAgainstSource(stcu, "Monthly service charge", 5, ".", "monthly_maintenance", { rewardCredits: true }).ok).toBe(true);
    expect(checkFeeAgainstSource(FREMONT, "Paper statement fee", 2, ".", "paper_statement", { rewardCredits: true }).ok).toBe(true);
    // A fee word after the figure keeps it a fee (inst 5141, verbatim).
    const late = "Consumer Loan Late Fee | A payment over 10 days past due will receive a $20.00 late fee PER month past due";
    expect(checkFeeAgainstSource(late, "Consumer Loan Late Fee", 20, ".", "late_payment", { rewardCredits: true }).ok).toBe(true);
  });
});
