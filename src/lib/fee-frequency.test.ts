import { describe, expect, it } from "vitest";
import { borrowedFrequency, frequencyFamily, frequencyFromLine, settledFrequency, wordsAfterPrice } from "./fee-frequency";

describe("frequencyFromLine (live excerpts, Oct 8)", () => {
  it("reads the words right after the fee's own price", () => {
    expect(frequencyFromLine("Copy of Share Draft (Check) Faxed | $6.00 each", 6)).toBe("per_item");
    expect(frequencyFromLine("| Photocopies: | $0.25 per page", 0.25)).toBe("per_item");
    expect(frequencyFromLine("Deposited Item Return | $25/Item", 25)).toBe("per_item");
    expect(frequencyFromLine("Stop Payment | $28.00 | Per request", 28)).toBe("per_item");
    expect(frequencyFromLine("Incoming Wire Transfer | $25.00 per transfer", 25)).toBe("per_item");
    expect(frequencyFromLine("Bill Pay Transactions - Business (per cycle) | $4.95 per cycle *fee waived if (1) bill payment made per cycle", 4.95)).toBe("monthly");
    expect(frequencyFromLine("Dormancy Fee (Maintanence Fee/Account Inactivity Fee) $1.00 per Statement Cycle", 1)).toBe("monthly");
    expect(frequencyFromLine("Late Fee | up to $25.00 | Money Order | $3.00 each", 3)).toBe("per_item");
  });

  it("reads the fee's own name when nothing follows the price", () => {
    expect(frequencyFromLine("Lost Safe Deposit Key (each) | $15.00", 15)).toBe("per_item");
    expect(frequencyFromLine("Inactive/Return Mail Fee (Quarterly) | $10.00", 10)).toBe("quarterly");
    expect(frequencyFromLine("Returned Mail – per piece / $10.00", 10)).toBe("per_item");
    expect(frequencyFromLine("Overdraft Protection Transfer (per occurrence) | $10.00 | Incoming International (per wire) | $20.00", 20)).toBe("per_item");
    expect(frequencyFromLine("Wire Initiation Fee (Outgoing/International) | Each | $50", 50)).toBe("per_item");
  });

  it("leaves a frequency unknown when the line prices by something else or says nothing", () => {
    expect(frequencyFromLine("Checkbook Reconciliation (per hour) | $30.00", 30)).toBeNull();
    expect(frequencyFromLine("Research Fee (per hour): | $25 per hour ($25.00 minimum)", 25)).toBeNull();
    expect(frequencyFromLine("Counter Checks | $1.00 | Per 5 checks", 1)).toBeNull();
    expect(frequencyFromLine("Garnishments, Executions, Levies and other subpoenas | $50.00 plus legal fees, plus $15.00 per hour research, plus $2.00 per copy", 50)).toBeNull();
    expect(frequencyFromLine("Paper Statement | $2.00", 2)).toBeNull();
    expect(frequencyFromLine("Statement Copy (Per Statement) | $2.00", 2)).toBeNull();
    expect(frequencyFromLine("Account Closure Fee ......$10.00 (less than 90 days) | Maximum of 3 Visa Reloadable Cards per member", 10)).toBeNull();
    // A frequency is never borrowed from a line that does not print the fee's price.
    expect(frequencyFromLine("Money Orders | $1.00 each", 2)).toBeNull();
  });

  it("reads the fee's own cell, not a note above it (seven-state keys, Oct 8)", () => {
    expect(frequencyFromLine("(Per month some exclusions apply) | Cashier’s Check (Per item) ...................................... $5.00", 5)).toBe("per_item");
    expect(frequencyFromLine("Escheat Notice-per year ......$2.00 | NSF Fee, Check or Pre-Authorized Debit ...... $14.00 per presentment", 14)).toBe("per_item");
  });

  it("finds a stated frequency read from another fee's row", () => {
    expect(borrowedFrequency("Missing/Bad Address - per year......................................... $10.00 | Reverse Stop Payment Request ........................................ $20.00", 20, "annual")).toBe(true);
    expect(borrowedFrequency("Not to exceed $6.00 per month | Debit Card Replacement ......................................... $5.00", 5, "monthly")).toBe(true);
    expect(borrowedFrequency("GeoPrime Checking (Monthly Low Balance Fee) .. $4.95 | ATM Balance Inquiry ............................................... $0.75 | result in a separate NSF Fee.", 0.75, "monthly")).toBe(true);
    expect(borrowedFrequency("If a minimum daily balance of $2,500 is not maintained. | Returned Deposit | $25.00", 25, "daily")).toBe(true);
    // The fee's own row, a heading above it, or no other wording keep it.
    expect(borrowedFrequency("Monthly Service Fees | Checking | $5.00", 5, "monthly")).toBe(false);
    expect(borrowedFrequency("Missing/Bad Address - per year......................................... $10.00 | Reverse Stop Payment Request ........................................ $20.00", 10, "annual")).toBe(false);
    expect(borrowedFrequency("Account Maintenance | $5.00 per month", 5, "monthly")).toBe(false);
    expect(borrowedFrequency("Paper Statement | $2.00", 2, "monthly")).toBe(false);
    expect(borrowedFrequency("Dormant Account Fee (Per Month)* *No Activity Last 12 Months on Balances Below $1,000.00 | $20.00", 20, "monthly")).toBe(false);
    expect(borrowedFrequency("Passbook Savings-Low Balance Fee (After 30 days, under $25) | $25.00 - Monthly", 25, "monthly")).toBe(false);
    expect(borrowedFrequency("Incoming Domestic Wire Fee | $10.00 | Monthly Service Fee with Average Daily Balance Less Than $250 | $10.00", 10, "monthly")).toBe(false);
    expect(borrowedFrequency("• Paper Statement / $3 per month6 | • Remove the $15 monthly", 3, "monthly")).toBe(false);
    expect(borrowedFrequency("Daily overdraft fee……………$3.00 | Online Cash Management & Bill Pay……...……$19.95/month", 3, "monthly")).toBe(true);
    expect(frequencyFamily("per_transaction")).toBe("per_item");
    expect(frequencyFamily("monthly")).toBe("monthly");
  });

  it("keeps Darwin's reader unchanged", () => {
    expect(wordsAfterPrice("6 withdrawals included per month; $5.00 each after 6", 5)).toBe(" each after 6");
    expect(wordsAfterPrice("no price here", 5)).toBe("no price here");
  });

  it("reads ea., /page, /transfer and per order as per item (v3)", () => {
    expect(frequencyFromLine("Money Orders | $5.00 ea.", 5)).toBe("per_item");
    expect(frequencyFromLine("Stop Payment | $30.00/ea", 30)).toBe("per_item");
    expect(frequencyFromLine("Statement Copy | $2.00/page", 2)).toBe("per_item");
    expect(frequencyFromLine("Internal Transfer | $5.00 / transfer", 5)).toBe("per_item");
    expect(frequencyFromLine("Check Printing | $25.00 per order", 25)).toBe("per_item");
    expect(frequencyFromLine("Easy Checking | $5.00 eastern branches", 5)).toBeNull();
    expect(frequencyFromLine("Account Research | $25.00 per hour", 25)).toBeNull();
  });

  it("reads per loan, per stamp, per file and other per-event nouns (v4)", () => {
    expect(frequencyFromLine("Skip-A-Pay $ 25 per loan", 25)).toBe("per_item");
    expect(frequencyFromLine("Non-Customer Notary Fee - Idaho $5.00 Per Stamp", 5)).toBe("per_item");
    expect(frequencyFromLine("ACH Origination Fee - $15 per file", 15)).toBe("per_item");
    expect(frequencyFromLine("GUASFCU charges a $10.00 fee per stop payment request.", 10)).toBe("per_item");
    expect(frequencyFromLine("Returned Item | $30.00 per occurance", 30)).toBe("per_item");
    expect(frequencyFromLine("Rewards Checking is charged a $7 service fee per calendar month.", 7)).toBe("monthly");
    expect(frequencyFromLine("Inactive Account | $5.00/quarter", 5)).toBe("quarterly");
    expect(frequencyFromLine("Paper Statement | $3.00 per statement period", 3)).toBe("monthly");
    expect(frequencyFromLine("Paper Statement | $2.00 per statement", 2)).toBeNull();
    expect(frequencyFromLine("Account Research | $30 per hour", 30)).toBeNull();
  });

  it("settles Darwin's 211-row eval misses (v4, Oct 9)", () => {
    // A period the line never states, on a fee charged per event, is dropped.
    expect(settledFrequency("Money Orders .......... $3.00", 3, "monthly", "money_order")).toBeNull();
    expect(settledFrequency("Monthly Service Fee | $3.00", 3, "monthly", "monthly_maintenance")).toBe("monthly");
    // An allowance is not the fee's period.
    expect(settledFrequency("Cashier Checks (1 free per month) | $2.00", 2, "monthly", "cashiers_check")).toBeNull();
    expect(settledFrequency("- $1.00 charge for ATM withdrawals at machines we do not own (nonproprietary) after five (5) per month.", 1, "monthly", "atm_non_network")).toBeNull();
    // "/MO" after a word is a money order.
    expect(settledFrequency("Teller’s checks/money order (per check/MO) | $10.00", 10, "monthly", "money_order")).toBe("per_item");
    expect(frequencyFromLine("Bill Pay | $5.00/mo", 5)).toBe("monthly");
    // "every month ... average daily" is a monthly fee on a daily balance.
    expect(settledFrequency("A Minimum Balance Fee of $35 will be imposed every month if the average daily", 35, "daily", "minimum_balance")).toBe("monthly");
    // Per business day, one-time, a price without its leading zero, a price printed twice.
    expect(settledFrequency("Continuous Overdraft Fee per business day (after 7 consecutive business days overdrawn) | $5.00", 5, null, "continuous_od")).toBe("daily");
    expect(frequencyFromLine("Lifetime Membership Fee.......... $5 one-time | Bill Pay/ Zelle", 5)).toBe("one_time");
    expect(frequencyFromLine("ATM Balance Inquiry Fee | $.25 per inquiry", 0.25)).toBe("per_item");
    expect(frequencyFromLine("• Money Order Research Fee - $10.00/money order", 10)).toBe("per_item");
    expect(frequencyFromLine("Starter Checks | $2.00/sheet of 3", 2)).toBe("per_item");
    expect(frequencyFromLine("Garnishment Fee | $100.00 per garnishment", 100)).toBe("per_item");
    expect(settledFrequency("Returned Item: | $6.00 per presentment | Replace Lost Card: | $6.00", 6, "per_item", "card_replacement")).toBe("per_item");
    expect(frequencyFromLine("Returned Item: | $6.00 per presentment | Replace Lost Card: | $6.00", 6)).toBeNull();
  });

  it("reads a count beyond the allowance as an allowance (v5)", () => {
    expect(settledFrequency("Debit Card Replacement (More than 2 per year) | $5", 5, "annual", "card_replacement")).toBeNull();
    expect(settledFrequency("Excess Withdrawals (over 6 per month) | $10.00 each", 10, "monthly", "excess_withdrawal")).toBe("per_item");
    expect(settledFrequency("Annual Fee | $25.00 per year", 25, "annual", "card_annual")).toBe("annual");
  });

  it("reads footnote marks, a cap and a second price's label (v6, Darwin's held copy fees)", () => {
    expect(frequencyFromLine("Statement Copy Fee | $3.00 per month6", 3)).toBe("monthly");
    expect(frequencyFromLine("Paper Statements | $3/month2", 3)).toBe("monthly");
    expect(frequencyFromLine("Additional per Item Fee $0.50 each2 Paper Statement Fee $2.00/Month", 0.5)).toBe("per_item");
    expect(frequencyFromLine("Statement Copy | Personal: $1.00/page Business: $3.00/page", 1)).toBe("per_item");
    expect(frequencyFromLine("Statement Copy Fee: $2.00 per page up to a maximum of $5.00 per statement month.", 2)).toBe("per_item");
    expect(settledFrequency("Statement copy fee – $4.00 per copy", 4, null, "document_reproduction")).toBe("per_item");
    expect(settledFrequency("Fax Service | $2.00 per page", 2, null, "account_research")).toBe("per_item");
    // A label still ends the words before the next price, and a minimum is still another basis.
    expect(frequencyFromLine("Monthly maintenance fee: $8.00 Per check: $0.20", 8)).toBe("monthly");
    expect(frequencyFromLine("Research | $25.00 ($25.00 minimum)", 25)).toBeNull();
  });

  it("reads 'after 3 in a month' and 'exceeding two per month' as allowances (v7, Darwin's held rows)", () => {
    expect(settledFrequency("| IRA Savings Excessive Withdrawal | $15 Each after 3 in a month |", 15, "monthly", "excess_withdrawal")).toBe("per_item");
    expect(settledFrequency("A $1.00 excess withdrawal fee will be charged for each in-person debit transaction exceeding two per month.", 1, "monthly", "excess_withdrawal")).toBeNull();
    expect(settledFrequency("Fax | $2.00/Page", 2, null, "account_research")).toBe("per_item");
    expect(settledFrequency("Monthly Service Fee | $5.00 a month", 5, "monthly", "monthly_maintenance")).toBe("monthly");
  });
});

describe("a rate basis in the fee's own name (v8, whole-record sample 2)", () => {
  it("clears a flat frequency on a fee charged per hour", () => {
    const line = "Account Balancing (per hour) / $35.00 Each";
    expect(frequencyFromLine(line, 35)).toBeNull();
    expect(settledFrequency(line, 35, "per_item", "account_research")).toBeNull();
    expect(settledFrequency("Research ($10 min) /hr | $20.00 each", 20, "per_item", "account_research")).toBeNull();
  });

  it("keeps a period when the name only mentions a minimum balance", () => {
    expect(frequencyFromLine("Minimum Balance Fee | $5.00 per month", 5)).toBe("monthly");
    expect(settledFrequency("Classic Money Market Account (balance below $1,000) | $3.00/monthly", 3, "monthly", "minimum_balance")).toBe("monthly");
    expect(frequencyFromLine("Copy of Share Draft (Check) Faxed | $6.00 each", 6)).toBe("per_item");
  });
});

describe("an allowance written as a count per month (v9, 101933)", () => {
  it("reads the fee as per item, not the free-fee row's monthly", () => {
    const line = "Monthly service fee …………………… N/C | ATM transaction (each above 6/month)… $ 1.00 | *Depending on location";
    expect(frequencyFromLine(line, 1)).toBe("per_item");
    expect(settledFrequency(line, 1, "monthly", "atm_non_network")).toBe("per_item");
    expect(frequencyFromLine("Monthly service fee | $5.00", 5)).toBe("monthly");
  });
});
