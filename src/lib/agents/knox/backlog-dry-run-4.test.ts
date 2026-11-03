import { describe, expect, it } from "vitest";

import { accountBenefitZeroOf, accountColumnZeroOf } from "@/lib/account-benefit-zero";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { classifyFeeText, withHeldNameRules } from "./rules";
import { KNOX_RULES_STRATEGY, runFreeSpecialists } from "./specialists";
import { extractTableCandidates, KNOX_TABLE_STRATEGY } from "./table-rows";

/**
 * v171 (Knox re-read backlog dry run 4, Nov 3): the wrong and doubtful reads of 40 stored texts, with the
 * banks' own lines (docs/project/findings/2026-11-03-knox-backlog-dry-run-4-misfiles.md).
 */
const reads = (text: string) => runFreeSpecialists(text).candidates.map((read) => [read.feeName, read.amount, read.canonicalHint] as const);
const all = (text: string) => {
  const run = runFreeSpecialists(text);
  return [...run.candidates, ...run.held].map((read) => [read.feeName, read.amount, read.canonicalHint] as const);
};

describe("Knox v171 (backlog dry run 4)", () => {
  it("is rules v171 or later, table v13 or later", () => {
    expect(KNOX_RULES_STRATEGY.version).toBeGreaterThanOrEqual(171);
    expect(KNOX_TABLE_STRATEGY.version).toBeGreaterThanOrEqual(13);
  });
});

// Northwest Missouri Regional FCU (7465), doc 42066.
const NORTHWEST_MISSOURI = [
  "Counter Check Stop Pay Fee (per check) $25.00",
  "Stop Payment Fee (per item/blanket/ACH) $25.00",
].join("\n");

describe("a short \"Stop Pay\" is the stop payment, ahead of the check it names (Northwest Missouri Regional FCU)", () => {
  it("files the counter check's stop pay as the stop payment, not the counter check", () => {
    const found = reads(NORTHWEST_MISSOURI);
    expect(found).toContainEqual(["Counter Check Stop Pay Fee (per check)", 25, "stop_payment"]);
    expect(found.some(([, , key]) => key === "counter_check")).toBe(false);
    expect(checkFeeAgainstSource(NORTHWEST_MISSOURI, "Counter Check Stop Pay Fee (per check)", 25, ".", "stop_payment")).toMatchObject({ ok: true });
  });

  it("reads other short stop pays the same way, and the held-name switch still holds them all off", () => {
    expect(classifyFeeText("Bill Payment Stop Pay Fee")).toBe("stop_payment");
    expect(classifyFeeText("Money Order Stop Pay")).toBe("stop_payment");
    expect(classifyFeeText("Stop Payment Order")).toBe("stop_payment");
    // Earlier rules keep a row whose own words name another fee first.
    expect(classifyFeeText("NSF/Stop Pay/Courtesy Pay")).toBe("overdraft");
    expect(withHeldNameRules(false, () => classifyFeeText("Counter Check Stop Pay Fee (per check)"))).toBe("counter_check");
    expect(withHeldNameRules(false, () => classifyFeeText("Stop Pay"))).toBeNull();
  });
});

// O'Bannon Banking Company (2415), doc 42058: one account's perks, then its fees.
const OBANNON = [
  "Regular Checking | Safeguard FREE Checking | Premiere Club | Money Market Deposit",
  "",
  "Quick Description | To fit your needs | FREE Checking | You must be at least 55 years of age | To fit your needs",
  "",
  "Minimum Opening Balance | $50 | $50 | $50 | $1,000",
  "",
  "Monthly Paper Statement | * $3/month | * $3/month | * $3/month (To fit your needs)",
  "",
  "Checks | 1st order of starter checks FREE (postage not included) (FREE Checking) | FREE Basic Checks (postage not included)",
  "",
  "Regular Checking",
  "",
  "xClose dialog",
  "",
  "xClose modal",
  "",
  "$7.00 Monthly Service Charge",
  "(To avoid the service charge, maintain an average daily balance of $300.00 or more)",
  "$50.00 Minimum Deposit to Open Account",
  "FDIC Insured",
  "",
  "This account also includes:",
  "",
  "Free Online Banking",
  "Free Bill Pay",
  "Tel-Account 24 Telephone Banking",
  "Unlimited Check Writing Privileges",
  "",
  "Checking Account Fees:",
  "",
  "Stop Payment $25.00 per stop payment order",
  "",
  "Safeguard FREE Checking",
  "",
  "$50.00 Minimum Deposit to Open Account",
  "FDIC Insured",
  "",
  "This account also includes:",
  "",
  "Free “Starter” Order of Duplicate Checks (postage not included)",
  "Free Debit Card",
  "Free Online Banking",
  "Free Bill Pay",
  "Free Online Statements and Check Images",
  "Free Tel-Account 24 Telephone Banking",
  "Free Check Safekeeping",
  "No Monthly Service Charge",
  "",
  "Premiere Club",
  "",
  "xClose dialog",
  "",
  "xClose modal",
  "",
  "$50.00 Minimum Deposit to Open Account",
  "FDIC Insured",
  "",
  "This account also includes:",
  "",
  "You must be at least 55 Years of Age",
  "$50.00 Minimum Deposit to Open Account",
  "Free Premiere Club Checks (postage not included)",
  "Free Cashier’s Checks",
  "Free Notary Service",
  "Special Rates on one Safe Deposit Box",
  "Free Photocopies (limits may apply)",
  "Free ATM Transactions (applies only to “MoneyPass” locations)",
  "Free Online Banking",
  "Free Bill Pay",
  "Tel-Account 24 Telephone Banking",
].join("\n");

describe("one account's perks are no fees with no product (O'Bannon Banking Co)", () => {
  it("a free word that opens the next item never prices the line above it", () => {
    const found = all(OBANNON);
    expect(found.some(([name]) => /special rates/i.test(name))).toBe(false);
    expect(found.some(([name]) => /^bill pay$/i.test(name))).toBe(false);
    expect(found.some(([name]) => /^online statements and check images$/i.test(name))).toBe(false);
    const table = extractTableCandidates(OBANNON);
    expect([...table.candidates, ...table.held].some((read) => read.amount === 0)).toBe(false);
  });

  it("a stacked free price under its own name still reads", () => {
    const stacked = "Incoming Wire\nFree\nOutgoing Wire\n$25.00";
    expect(all(stacked)).toContainEqual(["Incoming Wire", 0, "wire_domestic_incoming"]);
    expect(all(stacked)).toContainEqual(["Outgoing Wire", 25, "wire_domestic_outgoing"]);
  });

  it("holds an item under \"This account also includes:\" as that account's perk", () => {
    expect(accountBenefitZeroOf({ line: "Free Bill Pay", documentText: OBANNON, feeName: "Bill Pay" })).toMatchObject({
      kind: "account_waivers", account: "Regular Checking",
    });
    expect(accountBenefitZeroOf({ line: "Free Online Statements and Check Images", documentText: OBANNON, feeName: "Online Statements and Check Images" })).toMatchObject({
      kind: "account_waivers", account: "Safeguard FREE Checking",
    });
    expect(accountBenefitZeroOf({ line: "Free Notary Service", documentText: OBANNON, feeName: "Notary Service" })).toMatchObject({
      kind: "account_waivers", account: "Premiere Club",
    });
  });

  it("an item also printed outside such a list stays the bank's price", () => {
    const schedule = `${OBANNON}\n\nOther Services:\n\nNotary Service | Free`;
    expect(accountBenefitZeroOf({ line: "Free Notary Service", documentText: `${schedule}\nFree Notary Service`, feeName: "Notary Service" })).toBeNull();
    // A free list under the bank's own heading is no account's.
    expect(accountBenefitZeroOf({ line: "Free Notary Service", documentText: "Services we offer:\n\nFree Notary Service\nFree Coin Counting", feeName: "Notary Service" })).toBeNull();
  });

  it("holds a free cell of an account comparison table that cannot be lined up with its accounts", () => {
    const line = "Checks | 1st order of starter checks FREE";
    expect(accountColumnZeroOf({ line, documentText: OBANNON })).toMatchObject({ kind: "account_column" });
    expect(accountBenefitZeroOf({ line, documentText: OBANNON, feeName: "1st order of starter checks" })).toMatchObject({ kind: "account_column" });
  });

  it("keeps a row every account prints free, a fee table's own columns, and a heading over services", () => {
    const same = "Service | Basic Checking | Premier Checking\nIncoming Wire | Free | Free";
    expect(accountColumnZeroOf({ line: "Incoming Wire | Free", documentText: same })).toBeNull();
    // Peoples Advantage FCU (text 40393): "Fee | Description | Cost | How to avoid" rows name a club in prose.
    const feeTable = [
      "Christmas Club Early Withdrawal | A fee for withdrawing from a Christmas Club account prior to the maturity | $10 per withdrawal | Funds deposited into this account will automatically be transferred into the savings account each October.",
      "NSF (Non-Sufficient Funds) | An item exceeds the available funds in the account | FREE | Enroll in Courtesy Pay or Overdraft transfers",
    ].join("\n");
    expect(accountColumnZeroOf({ line: "NSF (Non-Sufficient Funds) | An item exceeds the available funds in the account | FREE", documentText: feeTable })).toBeNull();
    // Bellwether Community FCU (text 15722): the header names services beside two accounts.
    const services = "CHECKING | Live Free Checking | Begin Banking | FREE Member Services\nSavings Overdraft Transfer | FREE | FREE";
    expect(accountColumnZeroOf({ line: "Savings Overdraft Transfer | FREE | FREE", documentText: services })).toBeNull();
  });
});

// Four Corners FCU (6169), doc 41706: the page's own NSF row is "ACH - Insufficient".
const FOUR_CORNERS = [
  "| Fee | Amount |",
  "|-------------------------------------|-------------------------------------------------------------|",
  "| Account #99 Monthly Maintenance Fee | $ 4.00 (A balance of *>* $ 1,000 required to waive the fee) |",
  "| ACH - Insufficient | $ 30.00 |",
  "| Overdraft Fee | $ 15.00 |",
  "| Research Fee | $ 10.00 per hour |",
  "| Returned Check | $ 25.00 |",
  "| Returned Mail | $ 3.00 |",
  "| Stop Payment | $ 50.00 |",
].join("\n");

describe("a returned check beside the page's own NSF row is the deposited item return (Four Corners FCU)", () => {
  it("reads \"ACH - Insufficient\" as the NSF row, so the plain returned check goes where live 149144 files it", () => {
    const found = reads(FOUR_CORNERS);
    expect(found).toContainEqual(["ACH - Insufficient", 30, "nsf"]);
    expect(found).toContainEqual(["Returned Check", 25, "deposited_item_return"]);
    expect(found).not.toContainEqual(["Returned Check", 25, "nsf"]);
    expect(checkFeeAgainstSource(FOUR_CORNERS, "ACH - Insufficient", 30, ".", "nsf")).toMatchObject({ ok: true });
  });

  it("an item named insufficient is NSF; an insufficient balance or a named return is not", () => {
    expect(classifyFeeText("Insufficient Check Charge")).toBe("nsf");
    expect(classifyFeeText("Check - Insufficient")).toBe("nsf");
    expect(classifyFeeText("ACH Insufficient Return")).toBe("ach_return");
    expect(classifyFeeText("Overdraft/Insufficient Item Charge")).toBe("overdraft");
    expect(classifyFeeText("Insufficient balance fee")).toBeNull();
  });
});
