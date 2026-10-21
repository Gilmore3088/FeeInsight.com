import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { recategorizeHeld } from "./held-recheck";
import { amountsIn, classifyFeeText, extractFromSegment } from "./rules";
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
