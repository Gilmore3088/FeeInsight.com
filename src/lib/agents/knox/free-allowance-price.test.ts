import { describe, expect, it } from "vitest";

import { runCase } from "@/lib/agents/deming/shadow-lab/run-case";
import { currentVariant } from "@/lib/agents/deming/shadow-lab/variants";
import { KNOX_RULES_STRATEGY, runFreeSpecialists } from "./specialists";

type Published = [string, number, string];

/** Knox, Darwin's verify and the publish gate on the text: the fees published, as [category, amount, name]. */
function published(text: string): Published[] {
  const run = runCase(currentVariant, {
    caseKey: "free-allowance",
    scenario: "missed_fees",
    provenance: { fixture: "unit", fixtureCaseKey: "free-allowance", textHash: null, issue: "v147" },
    document: { url: null, text },
    expected: { publish: [], forbid: [] },
    status: "ok",
  });
  return run.published.map((fee): Published => [fee.canonicalFeeKey ?? "", (fee.amountCents ?? 0) / 100, fee.feeName ?? ""]);
}

const schedule = (...lines: string[]): string => ["Fee Schedule", ...lines].join("\n");
const pairs = (rows: Published[]): Array<[string, number]> => rows.map(([key, amount]) => [key, amount]);

describe("Knox v147: the price after a counted free allowance", () => {
  it("should_bump_the_rules_strategy", () => {
    expect(KNOX_RULES_STRATEGY.version).toBeGreaterThanOrEqual(147);
  });

  // The stored lines, as the seven-state and shadow-lab fixtures hold them.
  it.each([
    // State key 11477.
    ["Non-CO-OP ATM Transaction | 3 free per month (then $1.50 per)", ["atm_non_network", 1.5, "Non-CO-OP ATM Transaction"]],
    ["Starter Checks | 4 sheets free (then $2.00 per sheet)", ["counter_check", 2, "Starter Checks"]],
    // State key 4677.
    ["Photocopies & Faxes | First 5 pages free, then $0.50 per page", ["document_reproduction", 0.5, "Photocopies & Faxes"]],
    // State key 8034.
    ["Check copies - rush order | 2 free per month + FedEx costs, then $2 per copy + FedEx costs", ["check_image", 2, "Check copies - rush order"]],
    // Live audit 2538: read before v147 under the cut name "Counter Check (3 free then".
    ["Counter Check (3 free then $0.25/check)", ["counter_check", 0.25, "Counter Check"]],
  ])("should_publish_the_price_after_the_allowance: %s", (line, fee) => {
    expect(published(schedule(line))).toContainEqual(fee);
  });

  it("should_read_the_price_as_waivable_and_per_item_not_by_the_allowance_period", () => {
    const [read] = runFreeSpecialists(schedule("Non-CO-OP ATM Transaction | 3 free per month (then $1.50 per)")).candidates;
    expect(read).toMatchObject({ canonicalHint: "atm_non_network", amount: 1.5, frequency: "per_item", waivable: true });
    const [capped] = runFreeSpecialists(schedule("Foreign ATM Withdrawals | 4 free per month, then $2.00 ($10.00 max per month)")).candidates;
    expect(capped).toMatchObject({ amount: 2, frequency: "per_item" });
  });

  it.each([
    ["Excessive Withdrawals | 6 free per month, then $5.00 each", ["excess_withdrawal", 5]],
    ["NSF Fee | first 1 free per year, then $30.00 per item", ["nsf", 30]],
    ["Debit card replacement | 1 free per year, then $10.00 per card", ["card_replacement", 10]],
    ["ATM | 3 free per month at network ATMs, then $2.50 per transaction at non-network ATMs", ["atm_non_network", 2.5]],
    // Per item, not the total: the price, never its maximum.
    ["Photocopies | First 5 free, then $1.00 per page up to a maximum of $10.00", ["document_reproduction", 1]],
    ["Foreign ATM Withdrawals | 4 free per month, then $2.00 ($10.00 max per month)", ["atm_non_network", 2]],
    ["Online Bill Pay | 10 free payments per month, then $0.50 each; $5.00 monthly maximum", ["bill_pay", 0.5]],
    ["Paid item fee | 2 free per year, then $35.00 per item ($105.00 maximum per day)", ["overdraft", 35]],
  ])("should_publish_only_the_per_use_price: %s", (line, fee) => {
    expect(pairs(published(schedule(line)))).toEqual([fee]);
  });
});

describe("Knox v147: near-miss lines publish nothing new", () => {
  // Each publishes nothing, as before v147.
  it.each([
    // A free stretch of time is an introductory offer, not an allowance.
    "Monthly Service Fee | First 6 months free, then $5.00 per month",
    "Inactive account | first 12 months free, then $5.00 per month",
    "Continuous Overdraft | 5 business days free, then $5.00 per day",
    "Certificate early withdrawal | first 7 days free, then $25.00 penalty",
    // A balance, deposit, minimum or limit after the figure: no price.
    "Counter Checks | 2 free per month, then $500 balance required",
    "Counter Checks | First 2 orders free, then $25 deposit required",
    "Money Orders | 3 free per month, then $500 limit applies",
    "Savings Account | 6 free withdrawals per quarter, then $2.00 minimum balance fee",
    "Checking | Free with $500 balance, otherwise $10.00",
    // A rate after the allowance.
    "Foreign ATM | First 3 free, then 1% of the amount",
    "Coin Counting | Free up to $250 per day; over $250, 1% of total",
    // Other free or no-fee words on the row: a waiver for another account or direction.
    "Official Checks | 1 free per day, then $5.00 per check; no fee for Premier Checking",
    "Wire transfer | incoming free; outgoing 2 free per month then $25.00",
    // An ATM row that names no other ATMs can be the bank's own (State key 4677, unmapped in its key).
    "ATM Transaction Fee | 5 Free Transactions per month, then $1.00",
    "ATM Withdrawals | 4 free per month, then $2.00 ($10.00 max per month)",
    // No "then" joining the allowance to the price.
    "Stop payments | 2 free per year: $30.00 each thereafter",
    // A count of checks on an account's own row is not the account's monthly fee.
    "Share Draft Checking | 30 free checks per month (then $0.25 per check over 30)",
  ])("should_publish_nothing: %s", (line) => {
    expect(published(schedule(line))).toEqual([]);
  });

  it("should_leave_another_fee_on_the_same_row_its_own_price", () => {
    // The allowance names no price of its own; the second fee keeps its price, as before v147.
    expect(pairs(published(schedule("Statement Copies | 2 free per month | Stop Payment | $30.00")))).toEqual([["stop_payment", 30]]);
    expect(pairs(published(schedule("Wire Transfers | 2 free per month, then $15.00 each | Stop Payment | $30.00")))).toEqual([["stop_payment", 30]]);
    expect(pairs(published(schedule("ATM Transactions | 10 free per month (then $1.00 per) | Debit Card Replacement | $5.00")))).toEqual([["card_replacement", 5]]);
    expect(pairs(published(schedule("Teller transactions | 8 free per statement cycle (then $3.00 per transaction) | Paper statement fee | $2.00 per month"))))
      .toEqual([["paper_statement", 2]]);
    expect(pairs(published(schedule("Cashier's Checks | 2 free per month; Money Orders $3.00")))).toEqual([["money_order", 3]]);
  });

  it("should_not_give_an_allowance_line_price_to_the_fee_on_the_line_above", () => {
    expect(pairs(published(schedule("Overdraft Fee | $30.00", "3 free per month (then $1.50 per)")))).toEqual([["overdraft", 30]]);
    expect(pairs(published(schedule("Monthly maintenance | $10.00", "Checking: 5 free checks per month, then $0.50 per check"))))
      .toEqual([["monthly_maintenance", 10]]);
    expect(published(schedule("Counter Checks", "5 free - $0.25/after"))).toEqual([]);
  });

  it("should_keep_an_audience_in_the_name_and_leave_the_other_audience_price_alone", () => {
    expect(published(schedule("Notary | Members 2 free per year, then $5.00; Non-members $10.00"))).toEqual([["notary_fee", 5, "Notary: Members"]]);
  });
});

describe("Knox v147, review of 87dd9e6: the price's own unit and the fee's own words", () => {
  const frequencies = (text: string): Array<[string, number, string | null]> =>
    runFreeSpecialists(text).candidates.map((fee): [string, number, string | null] => [fee.canonicalHint ?? "", fee.amount, fee.frequency ?? null]);

  it.each([
    ["Account Research | 2 free per month, then $25.00 per hour", ["account_research", 25, "hourly"]],
    ["Account Research | 2 free requests per month, then $25.00 per hour (1 hour minimum)", ["account_research", 25, "hourly"]],
    ["Account Reconciliation | 2 free per year, then $30.00 per hour", ["account_research", 30, "hourly"]],
    ["Statement Reconciliation | 1 free per year then $25.00/hour", ["account_research", 25, "hourly"]],
    ["Legal Process | 1 free per year, then $50.00 per hour", ["legal_process", 50, "hourly"]],
    ["Account Research | 2 free per month, then $25.00 an hour", ["account_research", 25, "hourly"]],
    ["Excessive Withdrawals | 6 free per month, then $5.00 per month", ["excess_withdrawal", 5, "monthly"]],
  ])("should_keep_the_unit_printed_on_the_price: %s", (line, fee) => {
    expect(frequencies(schedule(line))).toEqual([fee]);
  });

  it("should_read_the_price_with_no_allowance_at_the_same_unit", () => {
    expect(frequencies(schedule("Account Research | $25.00 per hour"))).toEqual([["account_research", 25, "hourly"]]);
  });

  it.each([
    // A free stretch of time with its time word after "free".
    "Monthly Service Fee | 2 free months, then $5.00 per month",
    "Monthly Service Fee | 3 free months then $5.00",
    "Monthly Service Fee | 6 free statement cycles, then $8.00 per month",
    "Account Research | first 1 hour free, then $25.00 per hour",
    // An ATM allowance whose own words name the bank's own ATMs; another clause's or a note's ATMs do not count.
    "ATM | 4 free per month, then $1.00 at our ATMs; $2.00 at other ATMs",
    "ATM Withdrawal | 4 free per month, then $2.00 per withdrawal (other institutions may also charge a fee)",
  ])("should_publish_nothing: %s", (line) => {
    expect(published(schedule(line))).toEqual([]);
  });

  it("should_still_read_an_atm_allowance_whose_own_words_name_other_atms", () => {
    expect(pairs(published(schedule("Non-CO-OP ATM Transaction | 3 free per month (then $1.50 per)")))).toEqual([["atm_non_network", 1.5]]);
    expect(pairs(published(schedule("ATM | 3 free per month at network ATMs, then $2.50 per transaction at non-network ATMs")))).toEqual([["atm_non_network", 2.5]]);
  });

  it("should_mark_only_the_fee_that_owns_the_allowance_as_waivable", () => {
    for (const line of [
      "Counter Checks | 3 free per month, then $1.00 per check, Stop Payment $30.00",
      "Overdraft | 1 free per year, then $30.00 per item; Overdraft Transfer $5.00",
    ]) {
      const reads = runFreeSpecialists(schedule(line)).candidates.map((fee) => [fee.amount, fee.waivable]);
      expect(reads, line).toHaveLength(2);
      expect(reads[0], line).toEqual([reads[0][0], true]);
      expect(reads[1], line).toEqual([reads[1][0], false]);
    }
  });
});
