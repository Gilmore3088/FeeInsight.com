import { describe, expect, it } from "vitest";
import { CHECKING_ACCOUNT_FEE_NAME, namedForCheckingAccount } from "@/lib/checking-fee-name";
import { checkFeeCategory } from "@/lib/fee-category-guard";
import { verificationReasonCode, type RawFeeRow } from "@/lib/agents/darwin/verify";
import { classifyFeeText } from "@/lib/agents/knox/rules";

// #1918 review: the held lines Knox v110's recheck promotes, after the review of #2618 (read-only dry run on prod rows, Oct 25,
// current copies only): raw id, the name it promotes under, its amount and its stored line. Darwin's
// category guard (v85) refused every one ("name_unsupported"), so none could publish.
const PROMOTED: ReadonlyArray<readonly [number, string, number, string]> = [
  [109786, "Budget Checking Fee", 10, "Budget Checking Fee................................................................................................. $10.00 per month"],
  [114668, "Rise Checking Fee", 6, "Rise Checking Fee $6.00 Low balance Fee – if the balance is | $5.00"],
  [114669, "Peak Checking Fee", 8, "Peak Checking Fee $8.00 IRA transfer fee – Fee to transfer out of | $20.00"],
  [125515, "Jumpstart Checking Account Fee", 10, "Jumpstart Checking Account Fee | $10.00 per month"],
  [127051, "Elite Advantage Checking Fee", 7.5, "Elite Advantage Checking Fee ....................................................... $7.50/month | Annual Rent for Various Sizes:"],
  [127088, "Premium Checking Fee", 5, "• Premium Checking Fee...............................................................................$5*/month"],
  [127089, "Economy Checking Fee", 7, "• Economy Checking Fee ............................................................................... $7/month"],
  [137849, "Secure-24 Checking Fee", 4.25, "Secure-24 Checking Fee: | $4.25/month"],
  [146244, "Premium Checking fee", 4, "Premium Checking fee | $4.00 per month"],
  [175797, "MAX Checking Fee (per month)", 3.95, "MAX Checking Fee (per month) | $3.95"],
  [205158, "MyAdvantage Checking Account Fee", 5.95, "MyAdvantage Checking Account Fee | $5.95 per month"],
  [205159, "MyAdvantage Plus Checking Account Fee", 8.95, "MyAdvantage Plus Checking Account Fee | $8.95 per month"],
  [205160, "Option Checking Account Fee", 8, "Option Checking Account Fee | $8.00 per month"],
  [206405, "Monthly Checking Fee", 5, "Monthly Checking Fee | $5.00"],
  [253617, "Choice Checking Fee………….", 5, "Choice Checking Fee………….$5.00 | Incoming Wire……………..…..$10.00"],
  [320582, "Chance Checking Fee (monthly)", 10, "Chance Checking Fee (monthly) | $10.00"],
  [347819, "Elevated Checking Fee", 6, "Elevated Checking Fee | $6.00 per month"],
  [380440, "Basic Checking Account Fee", 10, "| Basic Checking Account Fee | $10.00 per month |"],
  [396275, "Rise Checking Fee", 6, "Rise Checking Fee | $6.00"],
  [396276, "Peak Checking Fee", 8, "Peak Checking Fee | $8.00"],
  [400981, "Choice Checking Fee", 5, "Choice Checking Fee………….$5.00 | Incoming Wire……………..…..$10.00"],
  [408780, "Second Chance Checking Fee", 7, "Second Chance Checking Fee $7.00 per month"],
  [434288, "Standard Checking Fee", 3, "- Standard Checking Fee: **$3.00 per month** (fee can be avoided on Simply Checking and Union Checking Accounts by having eStatements or keeping a balance of $250 at all times or h"],
  [435620, "Elite Advantage Checking Fee", 7.5, "Elite Advantage Checking Fee ....................................................... $7.50/month | Annual Rent for Various Sizes:"],
  [437318, "Fresh Start Checking fee", 10, "Fresh Start Checking fee $10/month | Gift Card 10 $3/card"],
  [530713, "Comeback Checking Fee", 10, "Comeback Checking Fee | $10.00 per month"],
  [545538, "Budget Checking Fee", 10, "Budget Checking Fee................................................................................................. $10.00 per month"],
  [624840, "Fresh Start Checking Fee", 5, "Fresh Start Checking Fee $5.00/mo. | (minimum four)"],
  [639872, "Fresh Start Checking Fee", 5, "Fresh Start Checking Fee | $5.00 per month"],
  [646641, "BundleUp Checking Fee", 7, "BundleUp Checking Fee | $7 per month (first month waived)"],
  [646739, "First Step Checking Fee", 8, "* First Step Checking Fee. .............................................$8.00per month"],
  [676517, "Monthly Checking Account fee", 3, "Monthly Checking Account fee | $3.00"],
  [752500, "Opportunity Checking Fee", 12, "Opportunity Checking Fee | $12.00/month"],
  [819080, "First Down Checking Fee", 6, "First Down Checking Fee | $6.00 per month"],
  [924439, "Monthly Checking Fee", 6, "Monthly Checking Fee | $6.00*"],
  [942506, "First Step Checking Fee", 8, "First Step Checking Fee: $8.00 per month"],
  [945188, "Second Chance Checking Fee (per month)", 10, "Second Chance Checking Fee (per month): $10.00"],
  [1087109, "STAR+ CHECKING ACCOUNT FEE", 4.5, "STAR+ CHECKING ACCOUNT FEE | $ 4.50 per Month"],
  [1121701, "2nd Chance Checking Fee", 15, "2nd Chance Checking Fee | $15 monthly"],
];

function heldRow(id: number, name: string, amount: number, excerpt: string): RawFeeRow {
  return {
    fee_raw_id: id,
    institution_id: 1,
    source_url: "https://bank.example/fee-schedule.pdf",
    document_r2_key: null,
    extraction_confidence: "0.90",
    fee_name: name,
    amount: amount.toFixed(2),
    frequency: "monthly",
    source_document_id: 1,
    outlier_flags: ["needs_darwin_verification", "canonical_hint:monthly_maintenance"],
    conditions: `Knox extract.rules v110 categorized a line held for review. canonical_hint=monthly_maintenance; excerpt="${excerpt}"`,
  } as unknown as RawFeeRow;
}

describe("a checking account's own named fee passes Darwin's category guard (#1918)", () => {
  it("should_verify_every_promoted_checking_name_as_monthly_maintenance", () => {
    expect(PROMOTED).toHaveLength(39);
    for (const [id, name, amount, excerpt] of PROMOTED) {
      const row = heldRow(id, name, amount, excerpt);
      expect([id, checkFeeCategory("monthly_maintenance", name, row).ok]).toEqual([id, true]);
      expect([id, verificationReasonCode(row, "monthly_maintenance")]).toEqual([id, null]);
    }
  });

  it("should_keep_the_monthly_maintenance_names_it_passed_before", () => {
    const row = heldRow(1, "Monthly Maintenance Fee", 10, "Monthly Maintenance Fee | $10.00");
    expect(checkFeeCategory("monthly_maintenance", "Monthly Maintenance Fee", row).ok).toBe(true);
    expect(verificationReasonCode(row, "monthly_maintenance")).toBeNull();
    expect(checkFeeCategory("monthly_maintenance", "Monthly Service Charge").ok).toBe(true);
  });

  it("should_still_refuse_a_name_that_is_not_the_accounts_own_fee", () => {
    for (const name of ["Checking Account Fee", "Checking Fee", "Platinum Checking", "Debit Card Checking Fee", "Wire Transfer Fee"]) {
      expect([name, checkFeeCategory("monthly_maintenance", name).ok]).toEqual([name, false]);
    }
  });

  // Opening, setup and reopening charges, business accounts and other fees that name checking
  // are neither filed by Knox nor admitted by the guard: both read the one shared pattern.
  const NOT_THE_MONTHLY_FEE = [
    "New Checking Account Fee",
    "Open Checking Account Fee",
    "Opening Checking Account Fee",
    "Account Opening Checking Fee",
    "Setup Checking Fee",
    "Set Up Checking Fee",
    "Initial Checking Fee",
    "Re-open Checking Fee",
    "Reopen Checking Fee",
    "Corporate Checking Fee",
    "Non-Profit Checking Fee",
    "Nonprofit Checking Fee",
    "Analysis Checking Fee",
    "Merchant Checking Fee",
    "Professional Checking Fee",
    "Ag Checking Fee",
    "Farm Checking Fee",
    "IOLTA Checking Fee",
    "Trust Checking Fee",
    "Estate Checking Fee",
    "Checking Replacement Fee",
    "Replacement Checking Fee",
    "Late Checking Fee",
    "Lost Checking Fee",
    "Bounce Checking Fee",
    "Withdrawal Checking Fee",
    "Deposit Checking Fee",
    "Counter Checking Fee",
    "Collection Checking Fee",
    "Foreign Checking Fee",
    "Unclaimed Checking Fee",
    "Gold Checking Fee (per year)",
    "Gold Checking Fee (quarterly)",
    "Gold Checking Fee per item",
    // Review of #2618: overdrawn, courtesy, charge-off, check cashing, one-time and reactivation
    // charges, dormancy synonyms, more business accounts, and notes that name another fee.
    "Courtesy Checking Fee",
    "Overdrawn Checking Account Fee",
    "Uncollected Funds Checking Fee",
    "Charge Off Checking Fee",
    "Charged-Off Checking Fee",
    "Cash Checking Fee",
    "Payroll Checking Fee",
    "Line of Credit to Checking Fee",
    "One-Time Checking Fee",
    "Enrollment Checking Fee",
    "Startup Checking Fee",
    "Activation Checking Fee",
    "Application Checking Fee",
    "Membership Checking Fee",
    "Reactivation Checking Fee",
    "Restart Checking Fee",
    "Cancellation Checking Fee",
    "Idle Checking Fee",
    "Abandoned Checking Fee",
    "Additional Checking Fee",
    "Tiered Rate Checking Fee",
    "Agricultural Checking Fee",
    "Not-for-Profit Checking Fee",
    "Church Checking Fee",
    "Municipal Checking Fee",
    "Public Funds Checking Fee",
    "Sole Proprietor Checking Fee",
    "LLC Checking Fee",
    "Organization and Special Checking Account Fee",
    "Gold Checking Fee (overdraft)",
    "Gold Checking Fee (NSF)",
    "Gold Checking Fee (replacement card)",
    "Gold Checking Fee (non-profit)",
    "Gold Checking Fee (one-time)",
    "Gold Checking Fee (at opening)",
    "Gold Checking Fee (when opened)",
    "Gold Checking Fee (every 6 months)",
    "Gold Checking Fee (per 12 months)",
    "Gold Checking Fee (each 6 months)",
    "Gold Checking Fee (6 months)",
    "Gold Checking Fee (NSF, if returned)",
    "Gold Checking Fee (if overdrawn)",
    "Gold Checking Fee (with overdraft protection)",
    "Gold Checking Fee (overdraft",
  ];

  it("should_neither_file_nor_admit_opening_business_or_other_fee_names", () => {
    for (const name of NOT_THE_MONTHLY_FEE) {
      expect([name, namedForCheckingAccount(name)]).toEqual([name, false]);
      expect([name, classifyFeeText(name) === "monthly_maintenance"]).toEqual([name, false]);
      expect([name, checkFeeCategory("monthly_maintenance", name).ok]).toEqual([name, false]);
    }
  });

  it("should_read_a_waiver_note_as_the_waiver_not_another_fee", () => {
    for (const name of ["Platinum Checking Fee (waived with $500 minimum balance)", "Gold Checking Fee (waived first 6 months)"]) {
      expect([name, namedForCheckingAccount(name)]).toEqual([name, true]);
      expect([name, checkFeeCategory("monthly_maintenance", name).ok]).toEqual([name, true]);
    }
  });

  it("should_still_admit_account_names_that_only_resemble_those_words", () => {
    // "New" names an account unless it opens one; "Opportunity" is not "opening".
    for (const name of ["New Horizons Checking Fee", "Opportunity Checking Fee", "Second Chance Checking Fee (per month)", "Budget Checking Fee", "Fresh Start Checking Fee"]) {
      expect([name, CHECKING_ACCOUNT_FEE_NAME.test(name)]).toEqual([name, true]);
      expect([name, checkFeeCategory("monthly_maintenance", name).ok]).toEqual([name, true]);
    }
  });
});
