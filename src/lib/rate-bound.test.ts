import { describe, expect, it } from "vitest";
import { pricesRateBound, rateBoundOf } from "@/lib/rate-bound";

// Each row is a live flat fee's stored name, amount and line (prod, read-only, Oct 27; #2067).
const BOUNDS: [number, string, number, string, "min" | "max", number][] = [
  [13509, "7% Research Fee", 5, "7% Research Fee (Minimum charge $5.00", "min", 7],
  [13617, "Additional fees will apply as follows: Late Payment Fee 5% of the amount of the regularly scheduled payment, subject to", 15,
    "Additional fees will apply as follows: Late Payment Fee 5% of the amount of the regularly scheduled payment, subject to a minimum charge of $15.00. Returned Check Fee $25. Returned Payment Fee $25.", "min", 5],
  [21948, "Cash advance transaction fee 4% of advance", 5, "Cash advance transaction fee | 4% of advance (min. of $5) | Business Checking", "min", 4],
  [47480, "Garnishments", 50, "Garnishments (Minimum charge of $50.00, maximum charge of $100.00) 10.000% of Amount Paid to Court", "min", 10],
  [50916, "1% of check amount", 15, "Check Cashing Fee (Applies to share savings balances less than $100 and no other ETPCU services) | 1% of check amount ($2.00 minimum / $15.00 maximum)", "max", 1],
  [68096, "Non-member check cashing min or 1% with max of", 25, "NSF return fee $30 Non-member check cashing $5 min or 1% with max of $25", "max", 1],
  [82016, "Coin Counting Customer 1% of coin (or minimum of)", 3, "Coin Counting • Customer 1% of coin (or minimum of) | $3.00", "min", 1],
  [130060, "Visa® cash advance", 50, "Visa® cash advance ($50 maximum) | 3% of each | Return deposit/Chargeback", "max", 3],
  [133556, "Non-Sufficient Funds (NSF): Non-Member", 10, "Non-Sufficient Funds (NSF) | Non-Member ($10 Max) | 5% of Total", "max", 5],
  [140649, "Check cashing (non-customer) 2% of amount - minimum fee", 10, "Accrual of interest on noncash deposits - Interest begins to accrue no | Check cashing (non-customer).............2% of amount - minimum fee $10.00", "min", 2],
  [161450, "Cash Advance Applied on the day of the transaction", 3, "Cash Advance Applied on the day of the transaction (Minimum of $3.00) 3.00%", "min", 3],
  [40319, "On-Us Check Cashing (non-customers) 1% of check", 10, "On-Us Check Cashing (non-customers) 1% of check, $10 max.", "max", 1],
  [42088, "Official Checks: 1.00% of check purchased", 10, "Official Checks | 1.00% of check purchased, $10.00 maximum", "max", 1],
  [44294, "Coin Counting Fee", 10, "Coin Counting Fee | 5%/$10. Max.", "max", 5],
  [20370, "Coin Counting Fee", 25, "Coin Counting Fee | 5% with a max. Of $25.00 | Credit Report Fees | $4.00 per report", "max", 5],
  [95234, "On-Us Check Cashing", 20, "On-Us Check Cashing | 3% / $20 Max", "max", 3],
  [32970, "10.00% of the payment due after 7 days past due", 30, "Late Payment | 10.00% of the payment due after 7 days past due, $30.00 maximum", "max", 10],
  [134873, "Cash Advance", 5, "Non-Member Cash Advance | 2.00% of advance amount; minimum of $5.00", "min", 2],
];

// Lines that carry min/max words and a percentage but price the fee on its own: kept.
const KEPT: [number, string, number, string][] = [
  // The fee's own price stands alone; the bound belongs to the cash advance after it.
  [107933, "Stop Payment on an ACH Item", 20, "Stop Payment on an ACH Item ..............................................................$20.00 | Cash Advance Fee ............................ 3% of Cash Advance (min $5/max $75)"],
  [63749, "Wire-Out Domestic", 20, "WIRE-OUT DOMESTIC | $20.00 | VISA CASH ADVANCE | 2%, min $3"],
  [60916, "ATM/Debit Card (Replacement)", 20, "ATM/DEBIT CARD (REPLACEMENT) $20.00/CARD NON-CUSTOMER 2%($2 MIN)"],
  [68095, "NSF return fee", 30, "NSF return fee $30 Non-member check cashing $5 min or 1% with max of $25"],
  // The overdraft's own $5 follows its name; the $5 minimum before it is the cash advance's.
  [151896, "Checking account overdraft fee", 5, "2% charged on all cash advances (minimum $5.00, maximum $50.00) and $5.00 checking account overdraft fee"],
  [56202, "Skip-A-Payment (per loan per month)", 30, "Skip-A-Payment (per loan per month) $ 30 $ 30 | (16) 3% of advanced amount, minimum $30"],
  [56154, "New member fee (1 time)", 5, "$5 or 6% Late charge: 6% of payment; $5 minimum | $5.00 New member fee (1 time)"],
  // A balance, a minimum payment, an interest rate or a reward is no charge's bound.
  [145217, "Maintenance fee (daily balance falls below $1,500)", 10, "Business Interest Checking | $1,500 | $1,500 – $49,999 | 1.00% | 1.00% | – $1,500 minimum balance to avoid $10 monthly maintenance fee."],
  [134351, "Rewards Checking Monthly service charge", 10, "Up to $20,000.001 | 3.55% | $100.00 minimum balance to avoid a $10.00 monthly service charge Rate received if qualifications in Rewards Checking"],
  [151942, "Domestic rush fee", 45, "Minimum payment: 3.00% or $20.00**** | Domestic rush fee: $45.00"],
  [80375, "Loan Documentation Fee", 75, "APR is 3.99%, which includes a $75.00 Loan Documentation Fee, estimated payment of $1,473.89, with a maximum LTV of 100%, and a minimum credit score of 775"],
  [60846, "Monthly maintenance service charge", 10, "Earn 1.00% of the monthly debit card spend on the account up to a maximum of $10 when you spend at least $500 with your debit card from the account each month."],
  [156985, "Monthly service charge", 10, "will receive 4% cash back on up to a total of $250.00 debit card purchases that post and settle to the account during that cycle period. A maximum of $10.00 cash back payments may be earned per Monthly Qualification Cycle."],
  [73941, "Account Balancing/Research", 25, "Account Balancing/Research: | $25.00 per hour (1 hr. min.) | - Initiated in Foreign Currency: | 2.00% of settlement"],
  [155122, "Coin Machine (Members) 5%", 5, "Coin Machine (Members) ……………………………..…………..……. 5% | Plus, $5 per statement copy. Minimum one hour."],
];

describe("rateBoundOf (#2067): a percentage charge's minimum or maximum is not a flat fee", () => {
  it.each(BOUNDS)("live %s states a bound", (_id, name, amount, line, kind, percent) => {
    expect(rateBoundOf(line, amount, name)).toMatchObject({ bound: amount, kind, ratePercent: percent });
    expect(pricesRateBound(line, amount, name)).toBe(true);
  });

  it.each(KEPT)("live %s keeps its own price", (_id, name, amount, line) => {
    expect(rateBoundOf(line, amount, name)).toBeNull();
  });

  it("needs a positive amount, min/max words and a percentage", () => {
    expect(rateBoundOf("Wire | $25 minimum", 25)).toBeNull();
    expect(rateBoundOf("Cash advance 3% (min $5)", 0)).toBeNull();
    expect(rateBoundOf(null, 5)).toBeNull();
  });
});
