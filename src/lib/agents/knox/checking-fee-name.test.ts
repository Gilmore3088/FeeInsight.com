import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkingNameHeld, recategorizeHeld } from "./held-recheck";
import { amountsIn, checkingNamePriceAmbiguous, classifyFeeText, extractFromSegment } from "./rules";
import { runFreeSpecialists } from "./specialists";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";

// #1918: Bellco FCU's Truth in Savings fee schedule (doc 15817, Rosetta text 10122) prices each
// checking account's own monthly fee by the account's name. Knox held "MAX Checking Fee (per month)"
// as unclassified and never read "2Platinum Checking Fee (waived if $15K ...)", so neither went live.
const BELLCO = readFileSync(join(__dirname, "__fixtures__", "bellco-fee-schedule-15817.txt"), "utf8");

describe("a fee named for the checking account itself (#1918)", () => {
  it("should_file_a_named_checking_accounts_fee_as_its_monthly_fee", () => {
    expect(classifyFeeText("MAX Checking Fee (per month)")).toBe("monthly_maintenance");
    expect(classifyFeeText("Platinum Checking Fee")).toBe("monthly_maintenance");
    expect(classifyFeeText("2Platinum Checking Fee (waived if $15K in combined balances in")).toBe("monthly_maintenance");
    expect(classifyFeeText("Value Checking Account Fee")).toBe("monthly_maintenance");
    expect(classifyFeeText("Checking Fee (monthly)")).toBe("monthly_maintenance");
  });

  it("should_leave_other_fees_that_name_checking_to_their_own_rules", () => {
    expect(classifyFeeText("Inactive Checking Fee")).toBe("dormant_account");
    expect(classifyFeeText("Checking Account Overdraft Fee")).toBe("overdraft");
    // Printed bare, it can be an opening fee beside the monthly one (doc 3842).
    expect(classifyFeeText("Checking Account Fee")).toBeNull();
    expect(classifyFeeText("Business Checking Fee")).toBeNull();
    expect(classifyFeeText("Pathfinder & Business Checking Fees")).toBeNull();
    expect(classifyFeeText("Platinum Checking")).toBeNull();
    expect(classifyFeeText("Checking Fee Refund")).toBeNull();
    expect(classifyFeeText("Debit Card Checking Fee")).toBeNull();
    expect(classifyFeeText("Paper Statement Checking Fee")).not.toBe("monthly_maintenance");
    expect(classifyFeeText("Checking Account Closing Fee")).not.toBe("monthly_maintenance");
    expect(classifyFeeText("Excess Transaction Checking Fee")).not.toBe("monthly_maintenance");
  });

  it("should_never_read_a_thousands_figure_as_a_price", () => {
    expect(amountsIn("Platinum Checking Fee (waived if $15K in combined balances) | $12.00").map((a) => a.value)).toEqual([12]);
    expect(amountsIn("balances over $1.5M | $25.00").map((a) => a.value)).toEqual([25]);
    expect(amountsIn("$5 Kiosk fee | $5 k-cup").map((a) => a.value)).toEqual([5, 5]);
  });

  it("should_end_a_bracketed_waiver_at_its_cell", () => {
    const read = (line: string) => extractFromSegment(line).candidates.map((fee) => [fee.feeName, fee.amount]);
    expect(read("Platinum Checking Fee (waived if $15K in combined balances) | $12.00")).toEqual([
      [expect.stringMatching(/^Platinum Checking Fee/), 12],
    ]);
    // A waiver that is not bracketed still covers what follows it.
    expect(read("Paper Statement Fee waived if enrolled in eStatements | $3.00")).toEqual([]);
    expect(read("Monthly Service Charge $10.00 (waived with $500 balance) or $5.00 with eStatements")).toEqual([
      ["Monthly Service Charge", 10],
    ]);
  });

  it("should_trace_the_platinum_fee_in_the_shared_check_past_a_thousands_figure", () => {
    const line = "Automatic Deduction Stop Payment | $31.00 | 2Platinum Checking Fee (waived if $15K in combined balances in | $12.00";
    expect(checkFeeAgainstSource(line, "Platinum Checking Fee", 12, ".", "monthly_maintenance").ok).toBe(true);
    expect(checkFeeAgainstSource(line, "Platinum Checking Fee", 15, ".", "monthly_maintenance").ok).toBe(false);
    expect(checkFeeAgainstSource("Wire Fee (balances over $1.5M) | $20.00", "Wire Fee", 1, ".").ok).toBe(false);
  });

  it("should_read_both_bellco_checking_fees_from_the_stored_schedule", () => {
    const read = runFreeSpecialists(BELLCO, {});
    const monthly = read.candidates
      .filter((fee) => fee.canonicalHint === "monthly_maintenance")
      .map((fee) => [fee.feeName, fee.amount]);
    expect(monthly).toEqual(expect.arrayContaining([
      ["MAX Checking Fee (per month)", 3.95],
      [expect.stringMatching(/^Platinum Checking Fee/), 12],
    ]));
    expect(read.held.some((row) => row.feeName.startsWith("MAX Checking Fee"))).toBe(false);
  });

  // James's condition 3 on #2532: a balance threshold, a tier boundary, a percentage or another
  // adjacent amount is never read as the fee.
  it("should_never_read_a_threshold_tier_or_percentage_as_the_checking_fee", () => {
    const monthly = (line: string) =>
      runFreeSpecialists(line, {}).candidates
        .filter((fee) => fee.canonicalHint === "monthly_maintenance")
        .map((fee) => fee.amount);
    // Thousands and millions are balances, never prices.
    expect(amountsIn("Gold Checking Fee (waived if $15K in combined balances) | $12.00").map((a) => a.value)).toEqual([12]);
    expect(amountsIn("waived with $1.5M in deposits | $9.00").map((a) => a.value)).toEqual([9]);
    expect(amountsIn("waived with $2,500 or $15k | $9.00").map((a) => a.value)).toEqual([2500, 9]);
    expect(monthly("Gold Checking Fee (waived if $15K in combined balances in | $12.00")).toEqual([12]);
    expect(monthly("Gold Checking Fee (waived with $1.5M in deposits) | $9.00")).toEqual([9]);
    // A price printed with its waiver balance keeps its own price, never the balance.
    expect(monthly("Gold Checking Fee | $12.00 (waived with a $2,500 balance)")).toEqual([12]);
    // A tier boundary or band between the name and its price makes the line a tier: held.
    expect(monthly("Gold Checking Fee | Balances under $15K | $12.00")).toEqual([]);
    expect(monthly("Gold Checking Fee | under $2,500 | $12.00")).toEqual([]);
    // A percentage, a second price, an activity trigger or an opening charge: held.
    expect(monthly("Gold Checking Fee | 1% of balance")).toEqual([]);
    expect(monthly("Gold Checking Fee | $12.00 or 1% of the average balance")).toEqual([]);
    expect(monthly("Gold Checking Fee | $5.00 or $3.00 with eStatements")).toEqual([]);
    expect(monthly("Personal Convenience Checking fee | $ 8.00 if activity exceeds 25 checks & ACHs in a month")).toEqual([]);
    expect(monthly("Gold Checking Fee | $25.00 to open")).toEqual([]);
    // The shared check agrees: the balance is not the fee's price.
    expect(checkFeeAgainstSource("Gold Checking Fee (waived if $15K in balances) | $12.00", "Gold Checking Fee", 15, ".", "monthly_maintenance").ok).toBe(false);
    expect(checkFeeAgainstSource("Gold Checking Fee (waived with $1.5M) | $9.00", "Gold Checking Fee", 1.5, ".", "monthly_maintenance").ok).toBe(false);
  });

  it("should_hold_an_ambiguous_checking_fee_on_recheck_and_promote_a_plain_one", () => {
    expect(checkingNamePriceAmbiguous("Personal Convenience Checking fee | $ 8.00 if activity exceeds 25 checks & ACHs in a month", "Personal Convenience Checking fee", 8)).toBe(true);
    expect(checkingNamePriceAmbiguous("Gold Checking Fee | Balances under $15K | $12.00", "Gold Checking Fee", 12)).toBe(true);
    expect(checkingNamePriceAmbiguous("Gold Checking Fee | $5.00 or $3.00 with eStatements", "Gold Checking Fee", 5)).toBe(true);
    // Bellco's two lines, the waiver inside the name's cell, a price before the name, and another
    // fee's condition after the price are not ambiguous.
    expect(checkingNamePriceAmbiguous("MAX Checking Fee (per month) | $3.95", "MAX Checking Fee (per month)", 3.95)).toBe(false);
    expect(checkingNamePriceAmbiguous("Automatic Deduction Stop Payment | $31.00 | 2Platinum Checking Fee (waived if $15K in combined balances in | $12.00", "Platinum Checking Fee", 12)).toBe(false);
    expect(checkingNamePriceAmbiguous("$5.00 monthly Hometown Checking fee", "monthly Hometown Checking fee", 5)).toBe(false);
    expect(checkingNamePriceAmbiguous("Rise Checking Fee $6.00 Low balance Fee – if the balance is | $5.00", "Rise Checking Fee", 6)).toBe(false);
    expect(checkingNamePriceAmbiguous("BundleUp Checking Fee | $7 per month (first month waived)", "BundleUp Checking Fee", 7)).toBe(false);
    // Only names filed by the checking-name rule are judged here.
    expect(checkingNamePriceAmbiguous("Monthly Service Fee | $5.00 or $3.00 with eStatements", "Monthly Service Fee", 5)).toBe(false);
    const held = (excerpt: string, amount: string, name: string) => ({
      fee_raw_id: 1,
      amount,
      fee_name: name,
      conditions: `Knox held for review (unclassified) from Rosetta artifact #1. canonical_hint=none; text_hash=x; excerpt="${excerpt}"`,
    });
    const peoples = held("Personal Convenience Checking fee | $ 8.00 if activity exceeds 25 checks & ACHs in a month", "8.00", "Personal Convenience Checking fee");
    const candidate = recategorizeHeld(peoples);
    expect(candidate && checkingNameHeld(peoples, candidate)).toBe(true);
    const max = held("MAX Checking Fee (per month) | $3.95", "3.95", "MAX Checking Fee (per month)");
    expect(checkingNameHeld(max, recategorizeHeld(max)!)).toBe(false);
    // One page printing the same name at two prices (United State Bank's two Hometown accounts):
    // the name does not say which account each price is for, so both stay held.
    const hometown = held("$3.00 monthly Hometown Checking fee", "3.00", "monthly Hometown Checking fee");
    expect(checkingNameHeld(hometown, recategorizeHeld(hometown)!)).toBe(false);
    expect(checkingNameHeld({ ...hometown, name_has_other_price: true }, recategorizeHeld(hometown)!)).toBe(true);
    // Another rule's name is not held by this check.
    const service = held("Monthly Service Fee | $3.00", "3.00", "Monthly Service Fee");
    expect(checkingNameHeld({ ...service, name_has_other_price: true }, recategorizeHeld(service)!)).toBe(false);
  });

  it("should_validate_bellcos_3_95_and_12_lines_without_a_false_fee", () => {
    const read = runFreeSpecialists(BELLCO, {});
    const monthly = read.candidates.filter((fee) => fee.canonicalHint === "monthly_maintenance");
    // Exactly the two checking accounts' fees, at their own prices; no $15 read from "$15K".
    expect(monthly.map((fee) => fee.amount).sort((a, b) => a - b)).toEqual([3.95, 12]);
    expect(read.candidates.some((fee) => fee.amount === 15 && /platinum|checking/i.test(fee.feeName))).toBe(false);
    for (const fee of monthly) {
      expect(checkFeeAgainstSource(BELLCO, fee.feeName, fee.amount, ".", "monthly_maintenance").ok).toBe(true);
    }
  });

  it("should_promote_the_held_max_checking_line_on_recheck", () => {
    const row = {
      fee_raw_id: 175797,
      amount: "3.95",
      fee_name: "MAX Checking Fee (per month)",
      conditions:
        'Knox held for review (unclassified) from Rosetta artifact #10122. canonical_hint=none; text_hash=a8346d53; excerpt="MAX Checking Fee (per month) | $3.95"',
    };
    expect(recategorizeHeld(row)?.canonicalHint).toBe("monthly_maintenance");
  });
});

// #1918, review of #2618 (Knox v110): what the checking-name rule must not file, and the prices it must hold.
describe("a checking-named fee that is not a flat monthly fee (#1918 review)", () => {
  const held = (excerpt: string, amount: string, name: string) => ({
    fee_raw_id: 1,
    amount,
    fee_name: name,
    conditions: `Knox held for review (unclassified) from Rosetta artifact #1. canonical_hint=none; text_hash=x; excerpt="${excerpt}"`,
  });

  it("should_not_file_opening_setup_or_reopening_charges_as_monthly_maintenance", () => {
    for (const name of [
      "New Checking Account Fee", "Open Checking Account Fee", "Opening Checking Account Fee",
      "Account Opening Checking Fee", "Setup Checking Fee", "Set-up Checking Fee", "Re-open Checking Fee",
    ]) {
      expect([name, classifyFeeText(name)]).not.toEqual([name, "monthly_maintenance"]);
    }
    // Read from a line, the opening charge is not a monthly fee either.
    const monthly = (line: string) =>
      runFreeSpecialists(line, {}).candidates.filter((fee) => fee.canonicalHint === "monthly_maintenance").map((fee) => fee.amount);
    expect(monthly("New Checking Account Fee | $10.00")).toEqual([]);
    expect(monthly("Re-open Checking Fee | $25.00")).toEqual([]);
  });

  it("should_not_file_business_accounts_or_other_fees_as_monthly_maintenance", () => {
    for (const name of [
      "Corporate Checking Fee", "Non-Profit Checking Fee", "Nonprofit Checking Fee", "Analysis Checking Fee",
      "Merchant Checking Fee", "Professional Checking Fee", "Ag Checking Fee", "Farm Checking Fee",
      "IOLTA Checking Fee", "Trust Checking Fee", "Estate Checking Fee",
      "Replacement Checking Fee", "Late Checking Fee", "Lost Checking Fee", "Bounce Checking Fee",
      "Withdrawal Checking Fee", "Deposit Checking Fee", "Counter Checking Fee", "Collection Checking Fee",
      "Foreign Checking Fee", "Unclaimed Checking Fee",
    ]) {
      expect([name, classifyFeeText(name)]).not.toEqual([name, "monthly_maintenance"]);
    }
  });

  it("should_hold_a_checking_fee_priced_per_year_quarter_item_or_debit", () => {
    expect(checkingNamePriceAmbiguous("Gold Checking Fee | $25.00 per year", "Gold Checking Fee", 25)).toBe(true);
    expect(checkingNamePriceAmbiguous("Gold Checking Fee | $25.00 annually", "Gold Checking Fee", 25)).toBe(true);
    expect(checkingNamePriceAmbiguous("Gold Checking Fee | $15.00 per quarter", "Gold Checking Fee", 15)).toBe(true);
    expect(checkingNamePriceAmbiguous("Gold Checking Fee | $0.25 per item", "Gold Checking Fee", 0.25)).toBe(true);
    expect(checkingNamePriceAmbiguous("Gold Checking Fee | $0.50 per debit", "Gold Checking Fee", 0.5)).toBe(true);
    expect(checkingNamePriceAmbiguous("Gold Checking Fee (per year) | $25.00", "Gold Checking Fee (per year)", 25)).toBe(true);
    // A monthly price stays a monthly fee.
    expect(checkingNamePriceAmbiguous("Gold Checking Fee | $12.00 per month", "Gold Checking Fee", 12)).toBe(false);
    expect(checkingNamePriceAmbiguous("Gold Checking Fee | $12.00/mo.", "Gold Checking Fee", 12)).toBe(false);
  });

  it("should_hold_a_closure_or_initial_deposit_price", () => {
    expect(checkingNamePriceAmbiguous("Gold Checking Fee | $25.00 if account is closed within 90 days", "Gold Checking Fee", 25)).toBe(true);
    expect(checkingNamePriceAmbiguous("Gold Checking Fee | $25.00 when closed within 180 days of opening", "Gold Checking Fee", 25)).toBe(true);
    expect(checkingNamePriceAmbiguous("Gold Checking Fee | $50.00 initial deposit", "Gold Checking Fee", 50)).toBe(true);
  });

  it("should_hold_a_price_every_few_months_or_at_opening", () => {
    // Review of #2618: neither wording names the month.
    expect(checkingNamePriceAmbiguous("Gold Checking Fee | $10.00 every six months", "Gold Checking Fee", 10)).toBe(true);
    expect(checkingNamePriceAmbiguous("Gold Checking Fee | $10.00 at account opening", "Gold Checking Fee", 10)).toBe(true);
    expect(checkingNamePriceAmbiguous("Gold Checking Fee | $10.00 semi-annually", "Gold Checking Fee", 10)).toBe(true);
    expect(checkingNamePriceAmbiguous("Gold Checking Fee | $10.00 every month", "Gold Checking Fee", 10)).toBe(false);
  });

  it("should_hold_a_price_charged_only_if_features_are_not_chosen", () => {
    // First Federal's two current copies (docs 6800 and 30291, raw 166502 and 655353): the $4.95 is
    // charged only if the standard features are not chosen; the page prints no period for it.
    expect(checkingNamePriceAmbiguous("E-Z Checking Fee | $4.95 if standard features are not chosen. Standard Features: Debit Card, Access*Online, E Statements", "E-Z Checking Fee", 4.95)).toBe(true);
    // The stored line of doc 6800 is cut before "not chosen"; the "if" clause alone makes it conditional.
    expect(checkingNamePriceAmbiguous("EZ Checking Fee $4.95 if standard features are", "EZ Checking Fee", 4.95)).toBe(true);
    expect(checkingNamePriceAmbiguous("Gold Checking Fee | $5.00 per month if eStatements are not selected", "Gold Checking Fee", 5)).toBe(true);
    const ez = held("EZ Checking Fee $4.95 if standard features are", "4.95", "EZ Checking Fee");
    expect(checkingNameHeld(ez, recategorizeHeld(ez)!)).toBe(true);
    const ez2 = held("E-Z Checking Fee | $4.95 if standard features are not chosen. Standard Features: Debit Card, Access*Online, E Statements", "4.95", "E-Z Checking Fee");
    expect(checkingNameHeld(ez2, recategorizeHeld(ez2)!)).toBe(true);
    // Another fee's "if" after the price is not this price's condition.
    expect(checkingNamePriceAmbiguous("Rise Checking Fee $6.00 Low balance Fee – if the balance is | $5.00", "Rise Checking Fee", 6)).toBe(false);
  });
});
