import { afterEach, describe, expect, it } from "vitest";
import { checkFeeAgainstSource, RATE_BOUND_SWITCH, rateBoundRefusalLive } from "./source-check";

// Stored texts, verbatim (prod, read-only, Oct 27; #2067). Each live flat fee is a percentage charge's
// minimum or maximum, and the shared check traced each one before v27.
const BANKS: [string, string, string, number, string][] = [
  // [institution / document, stored text, fee name, amount, canonical key]
  ["inst 7395 / doc 14350", "Late fee | Up to $28.00\nCredit card rush fee | $25.00 | Business Services**\nCash advance transaction fee | 4% of advance (min. of $5) | Business Checking\nStop payment for convenience checks | $30.00 | 150 deposited items per month | Free\nor balance transfer",
    "Cash advance transaction fee 4% of advance", 5, "cash_advance"],
  ["inst 8693 / doc 27732", "Multiple currency - per US Dollar | 1.00% | Online Banking stop payment | $ | 29.00\nSingle currency - per US Dollar | 0.80% | Return mail - per month | $ | 5.00\nVisa® cash advance ($50 maximum) | 3% of each | Return deposit/Chargeback\ncash advance\nDrawn on your account | $ | 15.00",
    "Visa® cash advance", 50, "cash_advance"],
  ["inst 7936 / doc 28799", "Account Reinstatement | $20.00 | Coin Counting\n(Within 90 days of close) | Member** | Free\nNon-Sufficient Funds (NSF) | Non-Member ($10 Max) | 5% of Total\nTransfer from Savings (manual/automatic) | $5.00 | Credit Card Cash Advance Fee | $3.00\nOverdraft/Return | $30.00 | CUSB Transaction Fee** | $2.00",
    "Non-Sufficient Funds (NSF): Non-Member", 10, "nsf"],
  ["inst 8272 / doc 15604", "Cashier Checks | $5.00\n\nCheck Cashing Fee (Applies to share savings balances less than $100 and no other ETPCU services) | 1% of check amount ($2.00 minimum / $15.00 maximum)\n\nCheck Copy | $2.00",
    "1% of check amount", 15, "check_cashing"],
  ["inst 585 / doc 6426", "number of days in the period. The period we use is the monthly statement\ncycle. | Special handling fee (limited, lost checkbook, watch on account).......$25.00\nAccrual of interest on noncash deposits - Interest begins to accrue no | Check cashing (non-customer).............2% of amount - minimum fee $10.00\nlater than the business day we receive credit for the deposit of noncash | Coin Machine Fee - customers ..............................10% of total coin counted",
    "Check cashing (non-customer) 2% of amount - minimum fee", 10, "check_cashing"],
  ["inst 4542 / doc 14911", "Visa Fees Explanation Fee\nReplacement Card Not for an automatic reorder $ | 5.00\nCash Advance Applied on the day of the transaction (Minimum of $3.00) 3.00%\nInternet Banking-Bill Payer Fees Free\nLoan Servicing Charges Explanation Fee",
    "Cash Advance Applied on the day of the transaction", 3, "cash_advance"],
  ["inst 1552 / doc 16457", "year you have initiated no activity on the account. (Per month charge, not to exceed\n$60.00 total)\nGarnishments (Minimum charge of $50.00, maximum charge of $100.00) 10.000% of Amount Paid to Court\nInterim Statements $3.00\nMedallion Stamp (Per Item) $50.00",
    "Garnishments", 50, "garnishment_levy"],
  ["inst 1052 / doc 1393", "Counter Check (per sheet) $2\nMoney Orders $2\nOn-Us Check Cashing (non-customers) 1% of check, $10 max.\nDebit Card Withdrawal Limit",
    "On-Us Check Cashing (non-customers) 1% of check", 10, "check_cashing"],
  ["inst 3388 / doc 1830", "Notary | $25.00\n\nOfficial Checks | 1.00% of check purchased, $10.00 maximum\n\nOnline Banking | FREE",
    "Official Checks: 1.00% of check purchased", 10, "cashiers_check"],
  ["inst 8195 / doc 3122", "\nNon-Member Fees\nOn-Us Check Cashing | 3% / $20 Max\nMoney Order | $5.00\nCash Advance | $10.00",
    "On-Us Check Cashing", 20, "check_cashing"],
  ["inst 5983 / doc 7639", "Pay Advance Fee | $20.00\n\nLate Payment | 10.00% of the payment due after 7 days past due, $30.00 maximum\n\nVerification of Deposit | $15.00",
    "10.00% of the payment due after 7 days past due", 30, "late_payment"],
  ["inst 5747 / doc 21046", "HELOC Application Fee | $50.00\n\nLate Fee | 5% of the payment amount (minimum of $25.00)\n\nLoan Payment by Phone | $9.00 per transaction using a credit card or debit card",
    "Late Payment Fee", 25, "late_payment"],
];

const traces = (result: ReturnType<typeof checkFeeAgainstSource>) => result.ok || result.reason === "tiered_fee";

describe("source check v27: a percentage charge's minimum or maximum is not a flat fee (#2067)", () => {
  afterEach(() => { delete process.env[RATE_BOUND_SWITCH]; });

  it.each(BANKS)("%s: traced as before with the refusal off, refused as rate_bound with it on", (_bank, text, name, amount, key) => {
    expect(traces(checkFeeAgainstSource(text, name, amount, ".", key, { rateBounds: false }))).toBe(true);
    expect(checkFeeAgainstSource(text, name, amount, ".", key, { rateBounds: true })).toEqual({ ok: false, reason: "rate_bound" });
  });

  it("is on unless SOURCE_CHECK_RATE_BOUND=off (James's yes, 2026-10-31), and the switch sets the default", () => {
    const [, text, name, amount, key] = BANKS[0];
    expect(rateBoundRefusalLive()).toBe(true);
    expect(checkFeeAgainstSource(text, name, amount, ".", key)).toEqual({ ok: false, reason: "rate_bound" });
    process.env[RATE_BOUND_SWITCH] = "on";
    expect(rateBoundRefusalLive()).toBe(true);
    process.env[RATE_BOUND_SWITCH] = " Off ";
    expect(rateBoundRefusalLive()).toBe(false);
    expect(traces(checkFeeAgainstSource(text, name, amount, ".", key))).toBe(true);
  });

  it("keeps a fee the schedule also prices flat on a row of its own", () => {
    // Kansas inst 8543 (doc 37194) and inst 2136 (doc 39836): the bound row sits beside the fee's own row.
    const kcu = "Non-KCU ATM Use $2.00 per transaction (waived for participating CO-OP ATM transactions)\nNon-Member Check Cashing $10.00 (waived for checks less than $150 or if payable to a minor)\nNon-Member Corporate Check 2% of check amount ($10.00 minimum)\nNSF (non-sufficient funds) $27.00 per declined transaction";
    expect(checkFeeAgainstSource(kcu, "Non-Member Check Cashing", 10, ".", "check_cashing", { rateBounds: true }).ok).toBe(true);
    const clearing = "Foreign Bank Check Clearing Fee | $10.00\n\nForeign Funds Check Clearing Fee | 1% of US Equivalent, minimum $10.00\n\nGift Card | $4.95";
    expect(checkFeeAgainstSource(clearing, "Foreign Bank Check Clearing Fee", 10, ".", "cashiers_check", { rateBounds: true }).ok).toBe(true);
    // The rows around a refused bound still trace.
    const [, text] = BANKS[0];
    expect(checkFeeAgainstSource(text, "Credit card rush fee", 25, ".", null, { rateBounds: true }).ok).toBe(true);
    expect(checkFeeAgainstSource(BANKS[2][1], "Overdraft/Return", 30, ".", null, { rateBounds: true }).ok).toBe(true);
  });
});
