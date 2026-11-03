import { describe, expect, it } from "vitest";

import { iraSectionClosingFee } from "@/lib/custom-report/ira-section-fee";
import { withLineupFromText, type AccountLineup } from "./lineup";
import { extractFromSegment, laterPriceOwnWords, waiverAdviceName, waiverAdvicePrefix, wireServiceSubscription } from "./rules";
import { KNOX_RULES_STRATEGY, frontMatterName, runFreeSpecialists, withoutFrontMatterLines } from "./specialists";

/**
 * v177 (Knox re-read backlog dry run 8, Nov 3): the wrong and doubtful reads of 40 stored texts, with the banks'
 * own lines (docs/project/findings/2026-11-03-knox-backlog-dry-run-8-misreads.md).
 */
const run = (text: string) => runFreeSpecialists(text);
const reads = (text: string) => run(text).candidates.map((read) => [read.feeName, read.amount, read.canonicalHint] as const);
const holds = (text: string) => run(text).held.map((read) => [read.feeName, read.amount, read.canonicalHint ?? null, read.shape] as const);

describe("Knox v177 (backlog dry run 8)", () => {
  it("is rules v177 or later", () => {
    expect(KNOX_RULES_STRATEGY.version).toBeGreaterThanOrEqual(177);
  });
});

// Honor FCU, doc 6435 (text 4644), lines 183-193: fee | price | how to avoid it | the other column's bullet item | price.
const HONOR = [
  "Wire Transfer Fee - Domestic | $20.00 per wire | Use Online BillPay, HonorPay or Account-To-Account Transfers | • Verification of Deposits | $25.00 each",
  "• Dormant Account Fee (After 12",
  "Wire Transfer Fee - International | $45.00 per wire | Use Online BillPay, HonorPay or Account-To-Account Transfers | $50.00 per month",
  "Months)",
  "Temporary Checks | $5.00/4 Checks | Use Online BillPay, HonorPay or Account-To-Account Transfers | • Reload Fee | $4.95",
  "Copy of Check | $5.00 per copy | Use Online Banking and enroll in eStatements | • Account Reconciliation/ | $30.00/per hour",
].join("\n");

describe("a waiver column never names the next price (Honor FCU)", () => {
  it("names the second price by the bullet item after the waiver column", () => {
    const found = reads(HONOR);
    expect(found).toContainEqual(["Verification of Deposits", 25, "account_verification"]);
    expect(found).toContainEqual(["Account Reconciliation", 30, "account_research"]);
    expect(found).toContainEqual(["Reload Fee", 4.95, "prepaid_card_reload"]);
    expect(found).toContainEqual(["Wire Transfer Fee - Domestic", 20, "wire_domestic_outgoing"]);
    expect(found.some(([name]) => /^Use /.test(name))).toBe(false);
  });

  it("holds the $50.00 that only the waiver column names, and files no bill_pay", () => {
    expect(holds(HONOR)).toContainEqual(["Use Online BillPay, HonorPay or Account-To-Account Transfers", 50, null, "unclassified"]);
    expect(reads(HONOR).some(([, amount, key]) => amount === 50 || key === "bill_pay")).toBe(false);
  });

  it("starts a later price's own words at the last bullet cell", () => {
    expect(laterPriceOwnWords(" per wire | Use Online BillPay | • Verification of Deposits | ")).toBe(" • Verification of Deposits | ");
    expect(laterPriceOwnWords(" per wire | Stop Payment | ")).toBe(" per wire | Stop Payment | ");
  });

  it("reads advice as advice, and a service or a charge as a fee name", () => {
    expect(waiverAdviceName("Use Online BillPay, HonorPay or Account-To-Account Transfers")).toBe(true);
    expect(waiverAdviceName("Maintain positive balance to cover pending purchases")).toBe(true);
    expect(waiverAdviceName("Use of Foreign ATM")).toBe(false);
    expect(waiverAdviceName("Use at NON-MCU ATM")).toBe(false);
    expect(waiverAdviceName("Use our money order when you cannot use a personal check. Your cost will be")).toBe(false);
    expect(waiverAdviceName("Enroll in free eStatements, or request a paper statement for a")).toBe(false);
    expect(waiverAdvicePrefix("Use Online BillPay or Account-To-Account Transfers: Gift Card")).toEqual({ advice: "Use Online BillPay or Account-To-Account Transfers", item: "Gift Card" });
    expect(waiverAdvicePrefix("Wire Transfers: Outgoing")).toBeNull();
  });
});

// Mattel FCU, doc 17062 (text 12602), lines 33-39: the IRA section beside a credit card column.
const MATTEL = [
  "ACH Stop Payment | $ 30 $ | 30",
  "Individual Retirement Account (IRA) Fees | Elite",
  "New Account Fee | FREE | FREE | VISA Credit Card Fees (14) | Classic Platinum",
  "Annual Fee | FREE | FREE | Annual Fee | FREE | FREE",
  "Early Closure Fee (if <59 1/2 ) | $ 30 | FREE | Document Copy | $ 3 $ | 3",
].join("\n");

describe("an early closure printed in an IRA's section is the IRA's closing fee (Mattel FCU)", () => {
  it("files \"Early Closure Fee (if <59 1/2 )\" $30 as ira_termination", () => {
    const found = reads(MATTEL);
    expect(found).toContainEqual(["Early Closure Fee (if <59 1/2 )", 30, "ira_termination"]);
    expect(found.some(([, , key]) => key === "early_closure")).toBe(false);
  });

  it("reads the section from its title, and leaves other sections' closings alone", () => {
    // Progressions CU (live 94053), Lake Trail-style card (live 159533).
    expect(iraSectionClosingFee("INDIVIDUAL RETIREMENT ACCOUNT (IRA) FEES\nAccount Closure Fee $25.00\nLOAN FEES", "Account Closure Fee", 25, "early_closure")).toBe(true);
    expect(iraSectionClosingFee("Club Accounts\nEarly withdrawal: $15.00\nIRA Savings Account\nAccount closing: $25.00\nMoney Market Accounts", "Account closing", 25, "early_closure")).toBe(true);
    expect(iraSectionClosingFee("IRA FEES | Annual Maintenance Fee | $12.00/annually\n\nAccount closed within 12 months of opening | $25.00", "Account closed within 12 months of opening", 25, "early_closure")).toBe(true);
    // A title that lists other accounts, a priced IRA row, another section after the IRA's, another column's title.
    expect(iraSectionClosingFee("Share Fees (Savings/Checking/IRAs) | ATM/Debit Card Fees\nAccount Closed (within 90 days of opening) .... $5.00 | Withdrawal .... Free", "Account Closed (within 90 days of opening)", 5, "early_closure")).toBe(false);
    expect(iraSectionClosingFee("IRA closed account | $10.00\n\nMembership closed within 90 days | $5.00", "Membership closed within 90 days", 5, "early_closure")).toBe(false);
    expect(iraSectionClosingFee("IRA ACCOUNT FEES\n\nTransfer/Rollover/Premature Closing | $25.00/Item\n\nOTHER SERVICE FEES\n\nAccount Closure | $5.00 if closed within 90 days", "Account Closure", 5, "early_closure")).toBe(false);
    expect(iraSectionClosingFee("Individual Retirement Account | Wire Origination\nAnnual Fee - per account | $15.00 | Incoming Wire Fee | $15.00\nAccount Fees | Outgoing Wire Foreign (USD) - per wire | $50.00\nEarly Account Closure within 6 Months - DDA | $25.00", "Early Account Closure within 6 Months - DDA", 25, "early_closure")).toBe(false);
    expect(iraSectionClosingFee("INDIVIDUAL RETIREMENT ACCOUNT (IRA) FEES\nAccount Closure Fee $25.00", "Account Closure Fee", 25, "nsf")).toBe(false);
  });
});

// Citizens National Bank of Crosbyton, doc 42167 (text 40702), lines 1-3 and 70-78.
const CROSBYTON = [
  "---",
  "canonical: https://www.cnbcrosbyton.com/fees/",
  "meta-description: Know What You Pay, Love What You GetFees & Other Charges ATM at Bank Location CustomersNo ChargeNon-Customers$2.00 Wire Transfer Customers$ 7.00Non-Customers$ 7.00 Cashier Checks (Non-Banclub Member to $10.00 Non-Customer)$ 1.00 Minimum or 1% up Other Fees Insufficient Checks$18.75Stop Payments$12.75",
  "meta-generator: WordPress 7.1.4",
  "---",
  "**Cashier Checks**",
  "",
  "| (Non-Banclub Member to $10.00<br> Non-Customer) | $ 1.00 Minimum or 1% up |",
  "|-------------------------------------------------|-------------------------|",
  "",
  "| Stop Payments | $12.75 |",
].join("\n");

describe("a page's front matter is not read (Citizens National Bank of Crosbyton)", () => {
  it("reads no flat cashier check from the rate's cap, and reads the body's own rows", () => {
    const found = reads(CROSBYTON);
    expect(found.some(([, , key]) => key === "cashiers_check")).toBe(false);
    expect(found).toContainEqual(["Stop Payments", 12.75, "stop_payment"]);
    expect(found.some(([name]) => /canonical|meta-/i.test(name))).toBe(false);
  });

  it("blanks only the front matter's meta and canonical lines, keeping the line count", () => {
    const blanked = withoutFrontMatterLines(CROSBYTON);
    expect(blanked.split("\n")).toHaveLength(CROSBYTON.split("\n").length);
    expect(blanked).not.toMatch(/meta-description|canonical:/);
    expect(blanked).toContain("| Stop Payments | $12.75 |");
    expect(withoutFrontMatterLines("Fees\nmeta-description: $5")).toBe("Fees\nmeta-description: $5");
    expect(frontMatterName("meta-fb:pages: meta-generator: WordPress 7.1.4")).toBe(true);
    expect(frontMatterName("Stop Payments")).toBe(false);
  });
});

// First-Citizens Bank & Trust, doc 42352 (text 40703), lines 716-726.
const FIRST_CITIZENS = [
  "Wire Transfer Services",
  "",
  "Service | Fee",
  "",
  "Domestic wire transfer base module (per month)D | $20.00",
  "",
  "Domestic wire transfer (per outgoing transfer)D | $20.00",
  "",
  "International wire transfer base module (per month)D | $20.00",
  "",
  "International wire origination for FX (each)D | No Charge",
  "",
  "International wire origination for USD (each)D | $45.00",
].join("\n");

describe("a wire service's monthly module is no wire's price (First-Citizens)", () => {
  it("holds the domestic base module as it holds the international one", () => {
    expect(reads(FIRST_CITIZENS).some(([name]) => /module/i.test(name))).toBe(false);
    expect(holds(FIRST_CITIZENS)).toContainEqual(["Domestic wire transfer base module (per month)D", 20, null, "unclassified"]);
    expect(reads(FIRST_CITIZENS)).toContainEqual(["Domestic wire transfer (per outgoing transfer)D", 20, "wire_domestic_outgoing"]);
  });

  it("keeps the international pair held: \"origination\" names no direction (a golden-set case forbids reading it as outgoing)", () => {
    expect(reads(FIRST_CITIZENS).some(([name]) => /origination/i.test(name))).toBe(false);
  });

  it("tells a module or package from a wire sent through one", () => {
    expect(wireServiceSubscription("International Wire Module")).toBe(true);
    expect(wireServiceSubscription("Premium Package (per month) (includes ACH & Domestic Wire access)")).toBe(true);
    expect(wireServiceSubscription("Outgoing Online Module Wire Transfer - Domestic")).toBe(false);
    expect(wireServiceSubscription("Outgoing Non-Module Wire Transfer - International")).toBe(false);
    expect(wireServiceSubscription("Outgoing Domestic Wire through Wire Module")).toBe(false);
  });
});

describe("prose from the next column sets no frequency (Mattel FCU #28)", () => {
  it("leaves the reconveyance's frequency unset", () => {
    const read = extractFromSegment("Real Estate Reconveyance (up to...) $ 300 $ 300 | due date each month. We will be charging interest on cash advances and").candidates[0];
    expect(read).toMatchObject({ amount: 300, canonicalHint: "other_lending_fee", frequency: null });
    expect(extractFromSegment("Paper Statement Fee | $3.00 | per month").candidates[0]).toMatchObject({ frequency: "monthly" });
  });
});

// Primis Bank (text 30162) and Elkhorn Valley Bank (text 21910), product cards.
const PRIMIS = [
  "Learn More",
  "",
  "Premium Checking",
  "",
  "BEST FOR People who maintain higher balances and want their checking balance to earn interest.",
  "",
  "STANDOUT BENEFIT Earn competitive, tiered interest based on your balance.",
  "",
  "MONTHLY SERVICE CHARGE $10 Waived with a $1,000 minimum daily balance.",
].join("\n");
const ELKHORN = [
  "PERSONAL SAVINGS ACCOUNTS",
  "",
  "PERSONAL SAVINGS ACCOUNT",
  "",
  "MONEY MARKET",
  "",
  "LITTLE EAGLES SAVINGS",
  "",
  "CERTIFICATE OF DEPOSIT",
  "",
  "HSA",
  "",
  "IRA",
  "",
  "Experience the simplicity and reliability of our Personal Savings Account, designed to help you steadily grow your savings while keeping your finances easily accessible.",
  "",
  "Minimum Daily Balance: $100",
  "",
  "Quarterly Service Charge: $5.00 (waived if minimum daily balance is maintained)",
].join("\n");
const CBC = ["Small Business Checking", "Select Checking", "Commercial Checking", "MSB Checking", "IOLTA Accounts", "Premier Checking", "Small Business Checking", "$250 opening deposit", "$8 monthly fee"].join("\n");

const product = (text: string, excerpt: string, amount: number) =>
  withLineupFromText<{ canonicalHint: string; feeName: string; excerpt: string; amount: number; lineup?: AccountLineup | null }>(
    { canonicalHint: "monthly_maintenance", feeName: "Monthly Service Charge", excerpt, amount }, text).lineup?.productName ?? null;

describe("product cards and tab lists (Primis Bank, Elkhorn Valley Bank)", () => {
  it("reads a card's marketing labels through to the product above them", () => {
    expect(product(PRIMIS, "MONTHLY SERVICE CHARGE $10 Waived with a $1,000 minimum daily balance.", 10)).toBe("Premium Checking");
  });

  it("takes no product from a tab list's last entry, but keeps a selected card's repeated title", () => {
    expect(product(ELKHORN, "Quarterly Service Charge: $5.00 (waived if minimum daily balance is maintained)", 5)).toBeNull();
    expect(product(CBC, "$8 monthly fee", 8)).toBe("Small Business Checking");
  });
});

describe("a sentence stating the minimum balance gives no price (golden-set case wrong_amount:17477)", () => {
  it("reads the IRA closing fee and not the $500.00 balance after it", () => {
    const text = "Bulk Coin | $8.00 per box\n\nIRA Accounts\n\nIRA Closing Fee | $50.00 if closed within two years. Minimum balance is $500.00 if not on direct deposit.\n\nCredit Union Membership";
    expect(reads(text)).toContainEqual(["IRA Closing Fee", 50, "ira_termination"]);
    expect(reads(text).some(([, amount]) => amount === 500)).toBe(false);
  });

  it("keeps a charge for falling below the minimum balance (live 137774)", () => {
    expect(extractFromSegment("Penalty for falling below the minimum balance is $8.00").candidates[0]).toMatchObject({ amount: 8, canonicalHint: "minimum_balance" });
  });
});
