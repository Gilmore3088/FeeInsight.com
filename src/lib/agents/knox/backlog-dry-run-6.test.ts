import { describe, expect, it } from "vitest";

import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { feeApplicability } from "@/lib/fee-audience";
import { creditCardSectionColumns, creditCardSectionRead } from "./credit-card-section";
import { classifyFeeText, listHeadingOf, stopPaymentListRead } from "./rules";
import { KNOX_RULES_STRATEGY, runFreeSpecialists } from "./specialists";

/**
 * v173 (Knox re-read backlog dry run 6, Nov 3): the wrong and doubtful reads of 40 stored texts, with the
 * banks' own lines (docs/project/findings/2026-11-03-knox-backlog-dry-run-6-misfiles.md).
 */
const all = (text: string) => {
  const run = runFreeSpecialists(text);
  return [...run.candidates, ...run.held].map((read) => [read.feeName, read.amount, read.canonicalHint] as const);
};

describe("Knox v173 (backlog dry run 6)", () => {
  it("is rules v173 or later", () => {
    expect(KNOX_RULES_STRATEGY.version).toBeGreaterThanOrEqual(173);
  });
});

// Navigant FCU (7511), doc 2007, business schedule: a two-column page.
const NAVIGANT = [
  "GENERAL BUSINESS FEES | • Electronic | $5.00",
  "Inactivity Fee | $5.00/mo",
  "Overdraft Transfer Fee | FREE | (No activity for 12 months.)",
  "Insufficient/Uncollected Funds Fee (Ret) | FREE | Account Verification | $10.00",
  "Insufficient/Uncollected Funds Fee (Paid) | Escheatment | $50.00",
  "• Overdrafts $9.99 and under | FREE | Levy / Garnishment Processing | $100.00",
  "• Overdrafts $10.00-$99.99 | $10.00 | Account Research (per Hour) | $30.00",
  "• Overdrafts $100.00 and over | $20.00 | Money Order | $4.00",
  "Stop Payment | Cashier’s Check | $5.00",
  "• Money Order | $30.00 | Positive Pay Checks | $50.00/mo",
  "• Official Check | $30.00 | Positive Pay ACH | $50.00/mo",
  "• Personal Check | $30.00 | Positive Pay Checks & ACH Bundle | $80.00/mo",
  "• ACH | $30.00 | Positive Pay Additional Account | $10.00/mo",
  "• Bill Payment | $30.00 | Custom Data Reporting | $50.00/mo",
  "Copy of Check / Statement | $7.00 | Custom Data Reporting Additional Account | $5.00/mo",
  "Redeposit Check Fee | $15.00 | Undeliverable Mail | $5.00/mo",
  "Returned Check Fee | $15.00 | Target Balance / Zero Balance Sweep | $40.00/mo",
  "Foreign Check Collection | $25.00 | Investment Sweep | $40.00/mo",
  "Wire Transfers (Inbound) | $12.00 | Line of Credit Sweep | $75.00/mo",
  "Wire Transfers (Outbound - Domestic) | $20.00",
].join("\n");

describe("an item bulleted under a stop payment heading is the stop payment (Navigant FCU)", () => {
  it("files \"• Bill Payment | $30.00\" under \"Stop Payment\" as the stop payment, never bill pay", () => {
    const found = all(NAVIGANT);
    expect(found).toContainEqual(["Stop Payment: Bill Payment", 30, "stop_payment"]);
    expect(found).toContainEqual(["Stop Payment: Money Order", 30, "stop_payment"]);
    expect(found).toContainEqual(["Stop Payment: Official Check", 30, "stop_payment"]);
    expect(found.some(([, amount, key]) => amount === 30 && (key === "bill_pay" || key === "money_order" || key === "cashiers_check"))).toBe(false);
    expect(checkFeeAgainstSource(NAVIGANT, "Stop Payment: Bill Payment", 30, ".", "stop_payment")).toMatchObject({ ok: true });
  });

  it("keeps the other column's prices on the heading row and the bullet rows as their own fees", () => {
    const found = all(NAVIGANT);
    expect(found).toContainEqual(["Cashier’s Check", 5, "cashiers_check"]);
    expect(found.some(([name, amount]) => /stop payment/i.test(name) && amount === 5)).toBe(false);
    expect(found.some(([name, amount]) => /stop payment/i.test(name) && amount === 50)).toBe(false);
  });

  it("reads the list heading only from a heading cell over a bullet", () => {
    expect(listHeadingOf("Stop Payment | Cashier’s Check | $5.00", "• Money Order | $30.00 | Positive Pay Checks | $50.00/mo")).toBe("Stop Payment");
    expect(listHeadingOf("Stop Payment", "• Money Order | $30.00")).toBe("Stop Payment");
    // No bullet under it, or a priced first cell: no list.
    expect(listHeadingOf("Stop Payment | Cashier’s Check | $5.00", "Copy of Check / Statement | $7.00")).toBeNull();
    expect(listHeadingOf("Stop Payments | $20.00 | Same Day ACH | $10.00", "• ACH | $30.00")).toBeNull();
  });

  it("never reads a heading's own priced row as a list heading, nor re-files a bullet at another price (review of v173)", () => {
    expect(listHeadingOf("Stop Payment | per request | $30.00", "• Money Order | $30.00")).toBeNull();
    const priced = "Stop Payment | per request | $30.00\n• Money Order | $30.00";
    const money = { feeName: "Money Order", amount: 30, canonicalHint: "money_order", excerpt: "• Money Order | $30.00", confidence: 0.9, frequency: null, waivable: false } as never;
    expect(stopPaymentListRead(money, priced)).toBe(money);
    const list = ["Stop Payment", "• Personal Check | $30.00", "• Money Order | $5.00", "• Official Check | $30.00", "• ACH | $30.00"].join("\n");
    const five = { feeName: "Money Order", amount: 5, canonicalHint: "money_order", excerpt: "• Money Order | $5.00", confidence: 0.9, frequency: null, waivable: false } as never;
    expect(stopPaymentListRead(five, list)).toBe(five);
    const official = { feeName: "Official Check", amount: 30, canonicalHint: "cashiers_check", excerpt: "• Official Check | $30.00", confidence: 0.9, frequency: null, waivable: false } as never;
    expect(stopPaymentListRead(official, list)).toMatchObject({ canonicalHint: "stop_payment", feeName: "Stop Payment: Official Check" });
  });

  it("leaves a bullet that names a fee of its own, or a list under another heading, as read", () => {
    const read = { feeName: "Bill Payment", amount: 30, canonicalHint: "bill_pay", excerpt: "• Bill Payment | $30.00", confidence: 0.9, frequency: null, waivable: false } as never;
    expect(stopPaymentListRead(read, "Online Services\n• Bill Payment | $30.00")).toBe(read);
    const research = { feeName: "Account Research", amount: 30, canonicalHint: "account_research", excerpt: "• Account Research | $30.00", confidence: 0.9, frequency: null, waivable: false } as never;
    expect(stopPaymentListRead(research, "Stop Payment\n• Account Research | $30.00")).toBe(research);
  });
});

// Greylock FCU (6842), doc 20487: the debit card row, then the two-column page's credit card section.
const GREYLOCK = [
  "ATM/Debit Card Replacement (1st replacement free)....... $5.00 | Uncollected Funds ..................................................... $15.00",
  "Bill Pay",
  "Relationship Checking Maintenance Charge* ................. $10.00",
  "Standard Payment ........................................................ Free",
  "*Min. daily balance requirement to waive .................. $2,500",
  "Overnight Check ........................................................ $14.00",
  "Same Day .................................................................. $11.00 | *Min. daily combined balance requirement in Share",
  "Savings/Money Market/CDs/IRAs to waive ............. $10,000",
  "BillMatrix Convenience Charge (per payment) .................. $3.95",
  "Returned Mail .................................................................... $5.00",
  "Bond Coupon Collection Charge (per envelope) ............. $10.00",
  "Signature STAMP Guarantee (For Members Only) ......... $10.00",
  "Business ACH Service ......................................... $35.00/month",
  "Statement Copy........................................................ $5.00 each",
  "Cashier’s Check",
  "Issued to member ....................................................... $2.00 | Stop Payment (per item)",
  "Issued to third party ..................................................... $3.00 | Check or ACH withdrawal - item less than $30.00 ....... $5.00",
  "Check Printing ................. depends on style of your check order | Check or ACH withdrawal - item $30.00 or greater.... $30.00",
  "Copy of Check .................................................................. $3.00 | Telephone Payment Processing (Operator Assisted)........ $7.50",
  "Dormant Account Processing at Closing ......................... $40.00 | Transaction Copy ............................................................ $10.00",
  "Foreign Check Collection ................................................ $25.00 | Wire Transfers",
  "Domestic Outgoing .................................................... $25.00",
  "Foreign Currency Shipping & Handling ........................... $14.00",
  "Foreign Outgoing ....................................................... $50.00",
  "Greylock VISA Gift Card .................................................... $3.50",
  "Incoming Wires Domestic and Foreign ........................ $7.50",
  "Inactive Membership ....................................................... $10.00",
  "(annually, after one year of inactivity) | CREDIT CARD CHARGES",
  "International Transaction Fee……………………………. up to 1% | Account Research ....................... $30.00/hour, minimum 1 hour",
  "This fee applies to any debit card or credit card transaction | Balance Transfer ............................. 3% of the Transfer Amount",
  "made at a location in a foreign country, or payable to a mer- | or $5 minimum, whichever is greater.",
  "chant located in a foreign country even if you initiate the trans-",
  "action from within the United States. | Card Replacement ............................................................. Free",
  "Legal Research/Processing | Card Replacement (Emergency/Rush Delivery) .............. $35.00",
  "Account research (per hour) ...................................... $30.00 | Cash Advance ............................... 2% of the Advance Amount",
  "Copy of check .............................................................. $3.00 | minimum $10, maximum $25.",
  "Statement copy ................................................... $5.00 each | International Transaction Fee……………………………. up to 1%",
  "Levy Processing .............................................................. $50.00 | This fee applies to any debit card or credit card transaction",
  "made at a location in a foreign country, or payable to a mer-",
  "Money Orders (per check) ................................................. $2.00 | chant located in a foreign country even if you initiate the trans-",
  "Negative Checking Account Balance (Business Accounts Only) | action from within the United States.",
  "Negative balance of $1,000 to $10,000 ...............$2.00 daily | Late Payment ......................................................... up to $27.00",
  "Negative balance of $10,001 to $20,000 ............ $5.00 daily",
  "Negative balance of $20,001 to $30,000 ............ $8.00 daily | Pay-by-Phone.................................................................... $5.00",
  "Negative balance of $30,001 and above ...........$10.00 daily | Returned Payment or Convenience Check ............ up to $27.00",
  "Night Deposit Bags (disposable plastic) ..... $20.00 per hundred | or the amount of the required minimum payment, whichever is",
].join("\n");

describe("a card replacement under a credit card title is the credit card's (Greylock FCU)", () => {
  it("never files the credit card section's free or rush replacement as the debit card's", () => {
    const found = all(GREYLOCK);
    expect(found.some(([name, , key]) => /^card replacement$/i.test(name) && key === "card_replacement")).toBe(false);
    expect(found.some(([name, , key]) => /emergency\/rush/i.test(name) && key === "rush_card")).toBe(false);
    expect(found).toContainEqual(["ATM/Debit Card Replacement (1st replacement free)", 5, "card_replacement"]);
  });

  it("reads the section from the row's own column", () => {
    const columns = creditCardSectionColumns(GREYLOCK);
    const lines = GREYLOCK.split("\n");
    const free = lines.findIndex((line) => line.includes("Card Replacement ....") && line.includes("Free"));
    expect(columns.get(free)?.has(1)).toBe(true);
    expect(columns.get(free)?.has(0) ?? false).toBe(false);
    const read = (feeName: string, excerpt: string) => ({ feeName, excerpt, canonicalHint: "card_replacement" });
    expect(creditCardSectionRead(read("Card Replacement", lines[free]), GREYLOCK, columns)).toBe(true);
    // A debit card's row, or a row the page prints outside the section, stays.
    expect(creditCardSectionRead(read("ATM/Debit Card Replacement (1st replacement free)", lines[0]), GREYLOCK, columns)).toBe(false);
    const debitAfter = `${GREYLOCK}\nDEBIT CARD FEES\nCard Replacement .... $10.00`;
    expect(creditCardSectionRead(read("Card Replacement", "Card Replacement .... $10.00"), debitAfter, creditCardSectionColumns(debitAfter))).toBe(false);
  });

  it("a site menu's \"Credit Card\" heads no rows, and an ATM heading ends a section (golden set live_audit:75)", () => {
    const menu = ["Online Banking", "Credit Card", "Advisors", "Your Mortgage", "Order Checks", "Personal Miscellaneous Fees Schedule",
      "Account Research", "Research (hourly rate): $25.00 minimum", "Automated Teller Machines (ATMs)", "Card Replacement: $5.00/Card"].join("\n");
    expect(all(menu)).toContainEqual(["Card Replacement", 5, "card_replacement"]);
    const after = ["VISA CREDIT CARD", "Late Payment | $25.00", "Automated Teller Machines (ATMs)", "Card Replacement | $5.00"].join("\n");
    expect(creditCardSectionRead({ feeName: "Card Replacement", excerpt: "Card Replacement | $5.00", canonicalHint: "card_replacement" }, after, creditCardSectionColumns(after))).toBe(false);
  });
});

// Truist (9), doc 13069: two product columns, each "No charge", the second cut short.
const TRUIST = [
  "Monthly Paper | No charge for Paper Statement or Paperless Online Statement8 | No charge for Paper Statement or Paperless",
  "Online Statement8",
  "Statement Fee",
].join("\n");

describe("the same free cell in a second column is one fee (Truist)", () => {
  it("holds one $0 paper statement for the row", () => {
    const zeros = all(TRUIST).filter(([, amount, key]) => amount === 0 && key === "paper_statement");
    expect(zeros).toHaveLength(1);
    expect(zeros[0][0]).toBe("Paper Statement or Paperless Online Statement");
  });

  it("still holds two different free cells of one row", () => {
    const zeros = all("Notary | Free | Check Cashing | Free").filter(([, amount]) => amount === 0);
    expect(zeros.length).toBeGreaterThanOrEqual(1);
  });
});

// LM FCU (5020), doc 8108: one paragraph, personal and business prices in labelled clauses.
const LM = "ALL CHECKING ACCOUNTS & MONEY MARKET SHARES (Money Market accounts are not given ATM access) Visa Check Card & ATM Card Purchases Free Personal accounts: Internet Bill Pay Free Business accoutns: Internet Bill Pay $4.95 per month Free Checking: Applies if the account is inactive for 90-days $5.00 per month Free Monthly ATM Withdrawals 10 per month Fee Per ATM Withdrawal Over The Number Provided Above Free Per Month $1.50 Visa Check OR ATM Card Replacement* $8.00 ";

describe("a price in a business-labelled clause is the business price (LM FCU)", () => {
  it("tags \"Business accoutns: Internet Bill Pay $4.95\" business, never consumer", () => {
    const excerpt = "Personal accounts: Internet Bill Pay Free Business accoutns: Internet Bill Pay $4.95 per month";
    expect(feeApplicability("Internet Bill Pay", excerpt, 4.95).feeAudience).toBe("business");
    const read = runFreeSpecialists(LM).candidates.find((fee) => fee.amount === 4.95 && fee.canonicalHint === "bill_pay");
    expect(read?.feeAudience).toBe("business");
  });

  it("reads a misspelt account word only when it has the word's own letters", () => {
    expect(feeApplicability("Wire", "Business acconuts: Wire $25", 25).feeAudience).toBe("business");
    expect(feeApplicability("Wire", "Business accounts: Wire $25", 25).feeAudience).toBe("business");
    expect(feeApplicability("Wire", "Business access: Wire $25", 25).feeAudience).toBe("unknown");
  });

  it("leaves both audiences unknown when the clauses do not each carry their own price", () => {
    expect(feeApplicability("Internet Bill Pay", "Personal accounts: Business accounts: Internet Bill Pay $4.95", 4.95).feeAudience).toBe("unknown");
    expect(feeApplicability("Internet Bill Pay", "Personal accounts and business accounts: Internet Bill Pay $4.95", 4.95).feeAudience).not.toBe("consumer");
  });
});

describe("review of v172: narrower names keep their own scope", () => {
  it("a bare fee word after the price never takes the heading's read (feeNamedAfterPrice)", () => {
    expect(all("ATM Fees\nForeign: $1.00 Service Charge.")).toContainEqual(["ATM Fees: Foreign", 1, "atm_non_network"]);
    // A full fee name after the price still names it (Citizens Bank of Ada).
    expect(all("Account Fees: $4.95 Monthly Service Charge.")).toContainEqual(["Monthly service charge", 4.95, "monthly_maintenance"]);
  });

  it("a name offering the monthly fee and the minimum balance fee stays monthly maintenance (LOW_BALANCE_CHARGE)", () => {
    expect(classifyFeeText("Monthly Maintenance Fee / Minimum Balance Fee")).toBe("monthly_maintenance");
    expect(classifyFeeText("Monthly Service Charge or Minimum Balance Fee")).toBe("monthly_maintenance");
    expect(classifyFeeText("No monthly service charge or minimum balance fee")).toBe("monthly_maintenance");
    expect(classifyFeeText("Monthly or Minimum Balance Service Charge")).toBe("monthly_maintenance");
    expect(classifyFeeText("A low balance service charge")).toBe("minimum_balance");
    expect(classifyFeeText("Minimum Balance Fee")).toBe("minimum_balance");
  });

  it("an insufficient item is the NSF row only when it is neither deposited, cashed nor paid (ITEM_INSUFFICIENT)", () => {
    expect(classifyFeeText("Deposited Item - Insufficient")).not.toBe("nsf");
    expect(classifyFeeText("Cashed Item Insufficient")).not.toBe("nsf");
    expect(classifyFeeText("Insufficient Debit Paid")).not.toBe("nsf");
    expect(classifyFeeText("ACH - Insufficient")).toBe("nsf");
    expect(classifyFeeText("Check - Insufficient")).toBe("nsf");
    expect(classifyFeeText("Insufficient Item")).toBe("nsf");
  });

  it("an insufficient item paid or returned stays the NSF row, and a deposited one is the deposited item return (review of v173)", () => {
    expect(classifyFeeText("Insufficient Check - Paid or Returned")).toBe("nsf");
    expect(classifyFeeText("Check - Insufficient (per item, paid or returned)")).toBe("nsf");
    expect(classifyFeeText("Insufficient Check (returned or paid)")).toBe("nsf");
    expect(all("Insufficient Check - Paid or Returned | $30.00")).toContainEqual(["Insufficient Check - Paid or Returned", 30, "nsf"]);
    expect(classifyFeeText("Deposited Item - Insufficient")).toBe("deposited_item_return");
    expect(all("Deposited Item - Insufficient | $10.00")).toContainEqual(["Deposited Item - Insufficient", 10, "deposited_item_return"]);
    // The v173 case stays fixed: a paid item that names no return is not the NSF row.
    expect(classifyFeeText("Insufficient Debit Paid")).not.toBe("nsf");
  });
});

// Review of v173 (PR #2967): a credit card section ends at the next section, and a row's own column is the
// cell that prints its own price.
const creditThen = (heading: string) => ["VISA CREDIT CARD", "Late Payment | $25.00", "Card Replacement | $10.00", heading, "Card Replacement | $5.00"].join("\n");

describe("a credit card section ends at the next section (review of v173)", () => {
  it.each([
    ["a numbered debit card heading", "2. Debit Card Fees"],
    ["a debit card heading with a note", "Debit Card Fees (effective 1/1/2026)"],
    ["a sentence that opens a debit card list", "The following fees apply to all debit cards:"],
    ["a miscellaneous heading", "Miscellaneous"],
    ["a wire transfer heading", "Wire Transfers"],
    ["a collection items heading", "Collection Items"],
  ])("keeps the debit card replacement after %s and still leaves out the credit card's", (_label, heading) => {
    const text = creditThen(heading);
    const found = all(text);
    expect(found).toContainEqual(["Card Replacement", 5, "card_replacement"]);
    expect(found.some(([name, amount, key]) => /card replacement/i.test(name) && amount === 10 && key === "card_replacement")).toBe(false);
    const columns = creditCardSectionColumns(text);
    const read = (amount: number) => ({ feeName: "Card Replacement", amount, excerpt: `Card Replacement | $${amount}.00`, canonicalHint: "card_replacement" });
    expect(creditCardSectionRead(read(5), text, columns)).toBe(false);
    expect(creditCardSectionRead(read(10), text, columns)).toBe(true);
  });

  it("does not end the section at a sentence about the fee or a stacked row's label", () => {
    const text = ["CREDIT CARD CHARGES", "This fee applies to any debit card or credit card transaction", "Annual Fee", "$0.00", "Card Replacement ...... $15.00"].join("\n");
    const columns = creditCardSectionColumns(text);
    expect(creditCardSectionRead({ feeName: "Card Replacement", amount: 15, excerpt: "Card Replacement ...... $15.00", canonicalHint: "card_replacement" }, text, columns)).toBe(true);
  });

  it("reads the row's own column when both columns print the name", () => {
    const creditLeft = ["CREDIT CARD FEES | DEBIT CARD FEES", "Late Payment ...... $25.00 | Overdraft ...... $30.00", "Card Replacement ...... $10.00 | Card Replacement ...... $5.00"].join("\n");
    const debitLeft = ["DEBIT CARD FEES | CREDIT CARD FEES", "Overdraft ...... $30.00 | Late Payment ...... $25.00", "Card Replacement ...... $5.00 | Card Replacement ...... $10.00"].join("\n");
    for (const text of [creditLeft, debitLeft]) {
      const columns = creditCardSectionColumns(text);
      const row = text.split("\n")[2];
      const read = (amount: number) => ({ feeName: "Card Replacement", amount, excerpt: row, canonicalHint: "card_replacement" });
      expect(creditCardSectionRead(read(5), text, columns)).toBe(false);
      expect(creditCardSectionRead(read(10), text, columns)).toBe(true);
    }
  });
});
