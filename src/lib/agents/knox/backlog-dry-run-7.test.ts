import { describe, expect, it } from "vitest";

import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { creditCardStatementRead } from "./credit-card-section";
import { accountHeadingAbove } from "./lineup";
import { classifyFeeText, extractCandidatesFromText, extractFromSegment, priceFirstClauseName, amountsIn } from "./rules";
import { KNOX_PRICE_FIRST_NAME_READ_BELOW_VERSION, PRICE_FIRST_MULTI_AMOUNT_NOTE_SQL } from "./extract";
import { KNOX_RULES_STRATEGY, runFreeSpecialists } from "./specialists";

/**
 * v176 (Knox re-read backlog dry run 7, Nov 3): the wrong, doubtful and duplicate reads of 40 stored texts,
 * with the banks' own lines (docs/project/findings/2026-11-03-knox-backlog-dry-run-7-misfiles.md).
 */
const all = (text: string) => {
  const run = runFreeSpecialists(text);
  return [...run.candidates, ...run.held].map((read) => [read.feeName, read.amount, read.canonicalHint] as const);
};

describe("Knox v176 (backlog dry run 7)", () => {
  it("is rules v176 or later", () => {
    expect(KNOX_RULES_STRATEGY.version).toBeGreaterThanOrEqual(176);
  });
});

// Jax Fire FCU, doc 42276 (text 40648), lines 153-167.
const JAX_FIRE = [
  "Repo Redemption Fee | $100",
  "",
  "Real Estate Loans",
  "",
  "Credit Report | $147",
  "",
  "Employment Verification | $256",
  "",
  "Fraud Prevention Fee | $11",
  "",
  "IRS Tax Return Verification | $15",
  "",
  "SSN Verification | $8",
  "",
  "Verification of Deposit –Account Check | $30",
].join("\n");

describe("verifying a borrower's employment is a loan's cost (Jax Fire FCU)", () => {
  it("files \"Employment Verification | $256\" as other lending, never account verification", () => {
    const found = all(JAX_FIRE);
    expect(found).toContainEqual(["Employment Verification", 256, "other_lending_fee"]);
    expect(found.some(([name, , key]) => name === "Employment Verification" && key === "account_verification")).toBe(false);
    expect(checkFeeAgainstSource(JAX_FIRE, "Employment Verification", 256, ".", "other_lending_fee")).toMatchObject({ ok: true });
  });

  it("keeps a verification of deposit as account verification, and reads TFed's \"Verification of Employment\" under Lending Fees", () => {
    expect(all(JAX_FIRE)).toContainEqual(["Verification of Deposit –Account Check", 30, "account_verification"]);
    expect(classifyFeeText("Verification of Employment")).toBe("other_lending_fee");
    expect(classifyFeeText("Deposit Verification Printout")).toBe("account_verification");
  });
});

// USF FCU, doc 42298 (text 40644), lines 141-181.
const USF = [
  "Dormant Account under $300 (inactive 12 months) | $15.00 per month",
  "",
  "Monthly Paper Statement Fee (eStatements are free) *Waived for members under 18 and over 65 | $3.00",
  "",
  "Return Item Non-Sufficient Funds (NSF) per presentment | $29.00",
  "",
  "Stop Payment | $29.00",
  "",
  "Loans*",
  "",
  "Late Payment Fee - Auto and personal loans only | $30.00",
  "",
  "Returned Loan Payment | $29.00",
  "",
  "Visa Monthly Paper Statement Fee | $1.25",
  "",
  "* Consumer loans only. For applicable Credit Card fees, please refer to the Credit Card disclosure on our website.",
].join("\n");

describe("a credit card's statement fee is not the deposit paper statement (USF FCU)", () => {
  it("reads the deposit $3.00 paper statement and leaves the Visa statement out", () => {
    const found = all(USF);
    expect(found.filter(([, , key]) => key === "paper_statement").map(([, amount]) => amount)).toEqual([3]);
    expect(found.some(([name]) => /visa/i.test(name))).toBe(false);
  });

  it("names a card's statement only when the name opens with the card", () => {
    expect(creditCardStatementRead({ canonicalHint: "paper_statement", feeName: "Visa Monthly Paper Statement Fee" })).toBe(true);
    expect(creditCardStatementRead({ canonicalHint: "paper_statement", feeName: "Credit Card Paper Statements" })).toBe(true);
    // Live 43451 and 14545: deposit statement fees that only exclude card statements.
    expect(creditCardStatementRead({ canonicalHint: "paper_statement", feeName: "Paper statement fee per statement cycle (excludes Real Estate, Top Brass, and Visa)" })).toBe(false);
    expect(creditCardStatementRead({ canonicalHint: "paper_statement", feeName: "Mailed Paper Statement (Excludes Loan and Visa statements) -" })).toBe(false);
    expect(creditCardStatementRead({ canonicalHint: "paper_statement", feeName: "Visa Debit Card Paper Statement" })).toBe(false);
  });

  it("ends a starred waiver note with its cell, and leaves a bracketed one to the bracket rule", () => {
    expect(extractFromSegment("Business Checking Monthly Service Charge *Waived if average daily balance is > $2,500 | $10.00").candidates
      .map((read) => [read.feeName, read.amount])).toEqual([["Business Checking Monthly Service Charge", 10]]);
    // San Antonio Citizens FCU (text 40642, line 269): the name stays whole.
    expect(extractFromSegment("Printed/Mailed Statement Fee (*Waived for ages 16 and under & 65 and older) | $3.00*").candidates
      .map((read) => read.feeName)).toEqual(["Printed/Mailed Statement Fee ( Waived for ages 16 and under & 65 and older)"]);
    // A waiver that opens the line still covers the price after it.
    expect(extractFromSegment("*Waived for members | $3.00").candidates).toEqual([]);
  });
});

// GTE FCU, doc 42265 (text 40659), lines 25-29.
const GTE = [
  "NSF (Courtesy Pay)2,10 | $37.00 | Mortgage Loan Modification | $75.00",
  "Mortgage Recast17 | $250.00",
  "NSF (Returned Item)2,10 | $37.00",
  "Overdraft Transfer2,10 | $8.00 | General charges:",
  "Account Research per hour2 | $30.00",
].join("\n");

describe("a footnote number glued to the name's last word (GTE FCU)", () => {
  it("reads \"Overdraft Transfer2,10 | $8.00\" once, as the overdraft transfer", () => {
    const transfers = all(GTE).filter(([name]) => name === "Overdraft Transfer");
    expect(transfers).toEqual([["Overdraft Transfer", 8, "od_protection_transfer"]]);
  });

  it("files a copy of a paper statement as document reproduction, footnoted or not (doc 40565)", () => {
    expect(extractFromSegment("Copy of Paper Statement3 | $ 5.00 per statement").candidates.map((read) => read.canonicalHint)).toEqual(["document_reproduction"]);
    expect(classifyFeeText("Copy of Paper Statement")).toBe("document_reproduction");
    expect(classifyFeeText("Paper Statement Fee")).toBe("paper_statement");
  });
});

// Bay State Savings Bank, doc 42280 (text 40622), lines 355-375.
const BAY_STATE = [
  "Money Market Accounts",
  "Revolution",
  "Consumer Tiered",
  "Commercial Tiered",
  "Revolution Money Market - New Money Only*",
  "Open Now",
  "For Balances Of* | Interest Rate | Annual percentage yield (APY)* | Minimum to Open",
  "$0.01 to $999,999 | 0.20% | 0.20% | $500",
  "$1million and above | 2.96% | 3.00% | $500",
  "Minimum balance of $1,000 required to avoid a monthly service charge of $7.00.",
].join("\n");

describe("a dash qualifier is a note on the account's name (Bay State Savings Bank)", () => {
  it("gives the $7 charge to the Revolution Money Market, not the section heading", () => {
    expect(accountHeadingAbove(BAY_STATE, "Minimum balance of $1,000 required to avoid a monthly service charge of $7.00.")).toBe("Revolution Money Market");
  });

  it("keeps a fee's own dashed line from naming an account (Classic Business Checking, text 38575)", () => {
    const line = "Classic Business Checking Account - Minimum Balance Fee";
    expect(accountHeadingAbove(`Account Fees\n${line}\nBalance below $1,000 | $12.00`, "Balance below $1,000 | $12.00")).not.toBe("Classic Business Checking Account");
  });
});

describe("an insufficient item the bank pays is the overdraft (review of PR #2967)", () => {
  it("reads paid-only rows as the overdraft and keeps the NSF and deposited-item rows", () => {
    for (const name of ["Insufficient Check Paid", "Item Insufficient - Paid", "Insufficient Debit Paid", "Insufficient Funds Check Paid", "Insufficient Items Paid"]) {
      expect(extractFromSegment(`${name} | $30.00`).candidates.map((read) => read.canonicalHint)).toEqual(["overdraft"]);
    }
    expect(classifyFeeText("Insufficient Check - Paid or Returned")).toBe("nsf");
    expect(classifyFeeText("ACH - Insufficient")).toBe("nsf");
    expect(classifyFeeText("Deposited Item - Insufficient")).toBe("deposited_item_return");
  });
});

// Fort Worth City Credit Union (fwccu, live 137329, text 27597), from a live-site audit.
const FWCCU = "● $5 monthly fee, waived with minimum balance of $500 or City of Fort Worth/City of Fort Worth Retirement direct deposit totaling $500 or more";
const reads = (line: string) => extractFromSegment(line).candidates.map((read) => [read.feeName, read.amount, read.canonicalHint] as const);

describe("a price-first line with a second figure is named by its own words after the price (fwccu)", () => {
  it("names the fwccu fee \"Monthly fee\" at $5, never the whole line without its figures", () => {
    expect(reads(FWCCU)).toEqual([["Monthly fee", 5, "monthly_maintenance"]]);
    expect(checkFeeAgainstSource(FWCCU, "Monthly fee", 5, ".", "monthly_maintenance")).toMatchObject({ ok: true });
  });

  it("names the monthly fee of a waiver or reduced-price line, read once", () => {
    expect(reads("$15 monthly fee waived with a $2,500 minimum balance")).toEqual([["Monthly fee", 15, "monthly_maintenance"]]);
    expect(reads("$6 monthly service charge, Or $5 with military ID")).toEqual([["Monthly service charge", 6, "monthly_maintenance"]]);
    expect(reads("$8 monthly service charge ($6 if age 55+)")).toEqual([["Monthly service charge", 8, "monthly_maintenance"]]);
    // A bare fee word never renames a read: "Service charge" keeps v175's name.
    expect(reads("$20 service charge if balance drops below $15,000 any day during monthly cycle")).toEqual([["service charge if balance drops below any day during monthly cycle", 20, "monthly_maintenance"]]);
  });

  it("never renames a read to a bare fee word (live 130284's stored line)", () => {
    // Live 130284 (doc 40013): v175's rules read, unchanged (the stored name drops the end stop); the clause name would be just "Fee".
    expect(reads("*$5 fee if the minimum balance falls below $300 during the statement cycle.")).toEqual([["fee if the minimum balance falls below during the statement cycle.", 5, "minimum_balance"]]);
  });

  it("keeps v175's name when the new one would merge two accounts' rows (rb4 text 40434)", () => {
    const text = [
      "Money Market Deposit",
      "$10.00 monthly service charge (to avoid the service charge, maintain an average daily balance of $1,000 or more)",
      "$1,000 minimum deposit to open account",
      "Super NOW Account",
      "Earn 0.15% APY*",
      "$10.00 Monthly Service Charge",
      "(To avoid the service charge, maintain an average daily balance of $1,000.00 or more)",
    ].join("\n");
    const tens = extractCandidatesFromText(text).candidates.filter((read) => read.amount === 10 && read.canonicalHint === "monthly_maintenance");
    expect(tens.map((read) => read.feeName.toLowerCase())).toHaveLength(2);
    expect(new Set(tens.map((read) => read.feeName.toLowerCase())).size).toBe(2);
    expect(tens.some((read) => read.feeName === "Monthly Service Charge")).toBe(true);
  });

  it("leaves one-price lines and a later fee's own price as they were", () => {
    expect(reads("$5.00 Monthly fee for paper statements")).toEqual([["Monthly fee for paper statements", 5, "paper_statement"]]);
    expect(reads("$35 Overdraft Fee for each item")).toEqual([["Overdraft Fee for each item", 35, "overdraft"]]);
    // A later price with its own fee words is still read (live 126192's line).
    expect(reads("$10.00 monthly fee with direct deposit*, $15.00 monthly fee without direct deposit").map((read) => read[1])).toEqual([10, 15]);
  });

  it("cuts the backstop name at a clause, \"per\" or \"for each\", past the price's own unit", () => {
    const name = (line: string) => priceFirstClauseName(line, amountsIn(line));
    expect(name("$35 Overdraft Fee for each item; $10 per day after 5 days")).toBe("Overdraft Fee");
    expect(name("$4.00 per month service charge if the balance falls below $600.00 during a statement cycle")).toBe("Service charge");
    expect(name("$25 Non-Sufficient Funds (NSF) Fee per item, $5 per day")).toBe("Non-Sufficient Funds (NSF) Fee");
    expect(name("$8 waived if swipes are met, $2 paper statement fee")).toBeNull();
  });

  it("reads those pages again once at v176", () => {
    expect(KNOX_PRICE_FIRST_NAME_READ_BELOW_VERSION).toBe(176);
    const note = new RegExp(PRICE_FIRST_MULTI_AMOUNT_NOTE_SQL);
    expect(note.test(`Knox deterministic extraction. excerpt="${FWCCU}"`)).toBe(true);
    expect(note.test('Knox deterministic extraction. excerpt="Monthly fee | $5 | waived with $500"')).toBe(false);
    expect(note.test('Knox deterministic extraction. excerpt="$5.00 Monthly fee for paper statements"')).toBe(false);
  });
});
