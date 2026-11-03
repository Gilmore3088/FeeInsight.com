import { describe, expect, it } from "vitest";

import { checkFeeCategory, CATEGORY_GUARD_VERSION } from "@/lib/fee-category-guard";
import { iraSectionClosingFee } from "@/lib/custom-report/ira-section-fee";
import { accountlessMonthlyReason } from "./accountless-monthly";
import { tidyFeeName } from "./layout";
import { withLineupFromText, type AccountLineup } from "./lineup";
import { classifyFeeText, returnedItemServiceName, waiverAdviceName } from "./rules";
import { KNOX_RULES_STRATEGY, runFreeSpecialists, tailTwinRead } from "./specialists";

/**
 * v178 (Knox re-read backlog dry run 9, Nov 3): the wrong and doubtful reads of 40 stored texts, with the banks'
 * own lines (docs/project/findings/2026-11-03-knox-backlog-dry-run-9-reads.md), and two follow-ups from the
 * review of #2973.
 */
const run = (text: string) => runFreeSpecialists(text);
const reads = (text: string) => run(text).candidates.map((read) => [read.feeName, read.amount, read.canonicalHint] as const);
const holds = (text: string) => run(text).held.map((read) => [read.feeName, read.amount, read.canonicalHint ?? null, read.shape] as const);

describe("Knox v178 (backlog dry run 9)", () => {
  it("is rules v178 or later, with guard v109", () => {
    expect(KNOX_RULES_STRATEGY.version).toBeGreaterThanOrEqual(178);
    expect(CATEGORY_GUARD_VERSION).toBeGreaterThanOrEqual(109);
  });
});

// First Bank, doc 4031 (text 4694), lines 17 and 23-25.
const FIRST_BANK = [
  "NSF Return Item Fee | $30.00 | Per Item",
  "Overdraft Fee | $30.00 | Per Item",
  "Returned Items Special Handling Service Fee1 (Business) | $30.00 | Per Month",
  "Returned Item-Recleared Fee1 (Business) | $4.50 | Per Item",
  "Returned Item-Reroute of Return Fee1 (Business) | $5.66 | Per Item",
].join("\n");

describe("a returned item's handling service is no NSF fee (First Bank)", () => {
  it("holds special handling, re-clear and reroute, and keeps the NSF fee", () => {
    const found = reads(FIRST_BANK);
    expect(found).toContainEqual(["NSF Return Item Fee", 30, "nsf"]);
    expect(found.some(([name]) => /Special Handling|Recleared|Reroute/.test(name))).toBe(false);
    const held = holds(FIRST_BANK).filter(([, , key, shape]) => shape === "unclassified" && key === null).map(([name]) => name);
    expect(held).toEqual(expect.arrayContaining([
      "Returned Items Special Handling Service Fee (Business)", "Returned Item-Recleared Fee (Business)", "Returned Item-Reroute of Return Fee (Business)",
    ]));
  });

  it("reads a monthly service fee as a service, and a name that says NSF as the NSF fee", () => {
    expect(returnedItemServiceName("Returned Item Service Fee", "monthly")).toBe(true);
    expect(returnedItemServiceName("Returned Item Service Fee", "per_item")).toBe(false);
    expect(returnedItemServiceName("Non-Sufficient Funds (NSF)/Special Handling")).toBe(false);
    expect(returnedItemServiceName("NSF Return Item Fee")).toBe(false);
  });
});

// Library of Congress FCU, doc 17945 (text 13456), lines 227-233.
const LOC = ["ATM /VISA DEBIT CARD", "", "Automatic transfers from shares | $2.00", "", "Card or PIN replacement | $10.00", "", "Overdraft | $28.00"].join("\n");

describe("an automatic transfer from shares is the overdraft protection transfer (Library of Congress FCU)", () => {
  it("files the name on its own, never under the ATM heading", () => {
    expect(classifyFeeText("Automatic transfers from shares")).toBe("od_protection_transfer");
    expect(reads(LOC)).toContainEqual(["Automatic transfers from shares", 2, "od_protection_transfer"]);
    expect(reads(LOC).some(([name, , key]) => /transfers from shares/.test(name) && key === "atm_non_network")).toBe(false);
    expect(checkFeeCategory("od_protection_transfer", "Automatic transfers from shares", { amount: "2" })).toEqual({ ok: true });
  });

  it("leaves a transfer to another account, or one naming a second destination, unmatched", () => {
    expect(classifyFeeText("Automatic transfer from savings to loan")).not.toBe("od_protection_transfer");
    expect(classifyFeeText("Automatic transfers from shares or checking")).not.toBe("od_protection_transfer");
  });
});

// Clinton Savings Bank, doc 8231 (text 7843), lines 2-24.
const CLINTON = [
  "CheCking/savings aCCOunTs | O nline Banking",
  "Preferred Checking Account | Online Bill Payment",
  "– Monthly Maintenance Service Charge | $ 15.00 | – Monthly Maintenance Service Charge* | $ 4.95",
  "Dividend Checking Account",
  "(This account is no longer offered.)",
  "– Monthly Maintenance Service Charge | $ 10.00",
  "Basic Checking Account | ATM/Debit Card Replacement | $ 10.00",
  "– Monthly Maintenance Service Charge | $ 5.00 | Special Handling Charge | $ 75.00",
].join("\n");
const product = (text: string, excerpt: string, amount: number) =>
  withLineupFromText<{ canonicalHint: string; feeName: string; excerpt: string; amount: number; lineup?: AccountLineup | null }>(
    { canonicalHint: "monthly_maintenance", feeName: "Monthly Maintenance Service Charge", excerpt, amount }, text).lineup?.productName ?? null;

describe("a two-column line's first cell heads the account below it (Clinton Savings Bank)", () => {
  it("files each monthly charge under the account titled right above it", () => {
    expect(product(CLINTON, "– Monthly Maintenance Service Charge | $ 5.00 | Special Handling Charge | $ 75.00", 5)).toBe("Basic Checking Account");
    expect(product(CLINTON, "– Monthly Maintenance Service Charge | $ 15.00 | – Monthly Maintenance Service Charge* | $ 4.95", 15)).toBe("Preferred Checking Account");
    expect(product(CLINTON, "– Monthly Maintenance Service Charge | $ 10.00", 10)).toBe("Dividend Checking Account");
  });

  it("never gives the other column's price the first column's account, nor takes a table row's label", () => {
    expect(product(CLINTON, "– Monthly Maintenance Service Charge | $ 15.00 | – Monthly Maintenance Service Charge* | $ 4.95", 4.95)).not.toBe("Preferred Checking Account");
    const table = ["Interest-bearing account | No | No | Yes", "Maintenance charge | None | $5/month | None"].join("\n");
    expect(product(table, "Maintenance charge | None | $5/month | None", 5)).not.toBe("Interest-bearing account");
  });
});

describe("a bracket the name never closes is no part of it (Flora Bank & Trust)", () => {
  it("drops the bracket that opens the price's clause", () => {
    expect(tidyFeeName("(A service charge of")).toBe("Service charge");
    expect(tidyFeeName("Inactive Bill Pay Fee")).toBe("Inactive Bill Pay Fee");
  });
});

describe("a monthly fee in a reward bullet or a \"Your $12\" sentence is held (ECA FCU, U.S. Bank)", () => {
  it("names the two sentence forms", () => {
    expect(accountlessMonthlyReason({ canonicalHint: "monthly_maintenance", excerpt: "Waived $5.00 monthly maintenance fee" })).toBe("reward_bullet");
    expect(accountlessMonthlyReason({ canonicalHint: "monthly_maintenance", excerpt: "Your $12 monthly maintenance fee is waived for the first two statement cycles after account opening1." })).toBe("your_fee_sentence");
    expect(accountlessMonthlyReason({ canonicalHint: "monthly_maintenance", excerpt: "Monthly Maintenance Fee | $12.00" })).toBeNull();
  });

  it("holds the reward bullet's $5 for review", () => {
    const text = ["Earn the following additional rewards by meeting all the qualifications during a monthly statement cycle:", "", "Waived $5.00 monthly maintenance fee", "", "Refunded ATM fees at month-end."].join("\n");
    expect(reads(text).some(([, amount, key]) => amount === 5 && key === "monthly_maintenance")).toBe(false);
    expect(holds(text).some(([, amount, key, shape]) => amount === 5 && key === "monthly_maintenance" && shape === "eligibility")).toBe(true);
  });
});

describe("a FAQ's second sentence about one free service is one $0 (Clearview FCU)", () => {
  it("is a twin only for prose sentences of a non-account fee", () => {
    const base = { canonicalHint: "od_protection_transfer", amount: 0, feeAudience: undefined } as never;
    const one = { ...(base as object), feeName: "Overdraft Protection transfer", excerpt: "Please note that the transfer will process before Courtesy Pay. There is no fee for an Overdraft Protection transfer." } as never;
    const two = { ...(base as object), feeName: "traditional Overdraft Protection transfer", excerpt: "Please note that the transfer will process first. There is no fee for a traditional Overdraft Protection transfer." } as never;
    expect(tailTwinRead(one, two)).toBe(true);
    const rowA = { ...(base as object), canonicalHint: "check_image", feeName: "Online Check Copies", excerpt: "Online Check Copies | No Charge" } as never;
    const rowB = { ...(base as object), canonicalHint: "check_image", feeName: "Executive Online Check Copies", excerpt: "Executive Online Check Copies | No Charge" } as never;
    expect(tailTwinRead(rowA, rowB)).toBe(false);
  });
});

describe("review of #2973 follow-ups", () => {
  const ira = (text: string, name: string, amount: number) => iraSectionClosingFee(text, name, amount, "early_closure");

  it("keeps the IRA's own distribution, transfer-out and IRA-named rows in its section", () => {
    expect(ira(["IRA Fees", "Annual Fee | $10.00", "Distribution by check | $5.00", "Early Closure Fee | $25.00"].join("\n"), "Early Closure Fee", 25)).toBe(true);
    expect(ira(["IRA Fees", "Transfer to another institution by wire | $25.00", "Early Closure Fee | $25.00"].join("\n"), "Early Closure Fee", 25)).toBe(true);
    expect(ira(["IRA Fees", "IRA Statement Copy | $2.00", "Early Closure Fee | $25.00"].join("\n"), "Early Closure Fee", 25)).toBe(true);
    // A general row still ends the block.
    expect(ira(["IRA Fees", "Annual Fee | $15.00", "Wire Transfer - Outgoing | $25.00", "Account Closed within 90 Days | $25.00"].join("\n"), "Account Closed within 90 Days", 25)).toBe(false);
  });

  it("reads waiver choices that each file under the name's type as that fee", () => {
    expect(waiverAdviceName("Use Non-Network ATM or Foreign ATM")).toBe(false);
    expect(waiverAdviceName("Use Online BillPay, HonorPay or Account-To-Account Transfers")).toBe(true);
    expect(waiverAdviceName("Use Online BillPay or Account-To-Account Transfers")).toBe(true);
    expect(reads("Fees\nATM Fees | $1.00 | Use Non-Network ATM or Foreign ATM | $2.50")).toContainEqual(["Use Non-Network ATM or Foreign ATM", 2.5, "atm_non_network"]);
  });
});
