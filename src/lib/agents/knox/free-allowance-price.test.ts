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

const ABSENT = "absent";
/** The frequency of Knox's read at this amount, or ABSENT. */
function knoxFrequency(line: string, amount: number): string | null {
  const read = runFreeSpecialists(schedule(line)).candidates.find((fee) => fee.amount === amount);
  return read ? read.frequency ?? null : ABSENT;
}
/** The frequency of the fee published at this category and amount, or ABSENT. */
function publishedFrequency(line: string, key: string, amount: number): string | null {
  const run = runCase(currentVariant, {
    caseKey: "free-allowance-base", scenario: "missed_fees",
    provenance: { fixture: "unit", fixtureCaseKey: "free-allowance-base", textHash: null, issue: "v147" },
    document: { url: null, text: schedule(line) }, expected: { publish: [], forbid: [] }, status: "ok",
  });
  const fee = run.published.find((row) => row.canonicalFeeKey === key && (row.amountCents ?? 0) / 100 === amount);
  return fee ? fee.frequency ?? null : ABSENT;
}
/**
 * v147 (review of 35d5ba2): the allowance line reads and publishes its price at exactly the frequency base
 * gives `baseLine`, the same fee with no allowance, or not at all; `mustPublish` asks for the recall too.
 */
function expectSameAsBase(line: string, baseLine: string, key: string, amount: number, mustPublish: boolean): void {
  const knox = knoxFrequency(line, amount);
  const shown = publishedFrequency(line, key, amount);
  if (mustPublish) expect(shown, `${line}: published`).not.toBe(ABSENT);
  if (knox !== ABSENT) expect(knox, `${line}: Knox`).toBe(knoxFrequency(baseLine, amount));
  if (shown !== ABSENT) expect(shown, `${line}: published`).toBe(publishedFrequency(baseLine, key, amount));
}

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

  it("should_never_publish_the_maximum_and_read_the_price_as_base_or_not_at_all", () => {
    const line = "Photocopies | First 5 free, then $1.00 per page up to a maximum of $10.00";
    expect(published(schedule(line)).filter(([, amount]) => amount === 10)).toEqual([]);
    expectSameAsBase(line, "Photocopies | $1.00 per page", "document_reproduction", 1, false);
  });

  it("should_read_the_price_as_waivable_at_the_frequency_base_reads_with_no_allowance", () => {
    const [read] = runFreeSpecialists(schedule("Non-CO-OP ATM Transaction | 3 free per month (then $1.50 per)")).candidates;
    expect(read).toMatchObject({ canonicalHint: "atm_non_network", amount: 1.5, waivable: true });
    expectSameAsBase("Non-CO-OP ATM Transaction | 3 free per month (then $1.50 per)", "Non-CO-OP ATM Transaction | $1.50 per", "atm_non_network", 1.5, true);
    // Another price shares the cell and no period word sits between them: per item (review of 34a44e3).
    expect(knoxFrequency("Foreign ATM Withdrawals | 4 free per month, then $2.00 ($10.00 max per month)", 2)).toBe("per_item");
  });

  it.each([
    ["Excessive Withdrawals | 6 free per month, then $5.00 each", ["excess_withdrawal", 5]],
    ["NSF Fee | first 1 free per year, then $30.00 per item", ["nsf", 30]],
    ["Debit card replacement | 1 free per year, then $10.00 per card", ["card_replacement", 10]],
    ["ATM | 3 free per month at network ATMs, then $2.50 per transaction at non-network ATMs", ["atm_non_network", 2.5]],
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

  // Review of 35d5ba2: by construction, an allowance read gets exactly the frequency base gives the same fee
  // with no allowance, Knox's read and the published fee alike. Every unit form from the three reviews.
  it.each([
    "per hour", "per hour (1 hour minimum)", "/hour", "/ hour", "/hr", "an hour", "hourly", "per hr", "per hr.", "hr",
    "each hour", "(per hour)", "per half hour", "per 1/2 hour", "per hour; $10.00 minimum",
    "monthly", "annually", "per statement period", "/mo", "per day", "a month", "per month", "per month thereafter",
    "per transaction", "per withdrawal", "ea.", "each", "per item", "per signature", "",
  ])("should_read_the_allowance_price_at_base_frequency: '%s'", (unit) => {
    const priced = `$25.00 ${unit}`.trim();
    // Base's line is the fee alone: cut at the next price, cell or clause, as `allowanceBaseRow` cuts it.
    expectSameAsBase(`Account Research | 2 free per month, then ${priced}`, `Account Research | ${priced.split(";")[0]}`, "account_research", 25, true);
  });

  it.each([
    ["Account Research | 2 free per month, then $25.00 per hour", "Account Research | $25.00 per hour", "account_research", 25],
    ["Account Research | 2 free requests per month, then $25.00 per hour (1 hour minimum)", "Account Research | $25.00 per hour (1 hour minimum)", "account_research", 25],
    ["Account Reconciliation | 2 free per year, then $30.00 per hour", "Account Reconciliation | $30.00 per hour", "account_research", 30],
    ["Statement Reconciliation | 1 free per year then $25.00/hour", "Statement Reconciliation | $25.00/hour", "account_research", 25],
    ["Legal Process | 1 free per year, then $50.00 per hour", "Legal Process | $50.00 per hour", "legal_process", 50],
    ["Account Research | 2 free per month, then $25.00 an hour", "Account Research | $25.00 an hour", "account_research", 25],
    ["Excessive Withdrawals | 6 free per month, then $5.00 per month", "Excessive Withdrawals | $5.00 per month", "excess_withdrawal", 5],
    ["Excessive Withdrawals | 6 free per month, then $5.00 per month thereafter", "Excessive Withdrawals | $5.00 per month thereafter", "excess_withdrawal", 5],
    ["ATM | 3 free per month at non-network ATMs, then $2.50 per transaction", "ATM | $2.50 per transaction", "atm_non_network", 2.5],
    ["Excessive Withdrawals | 6 free per month, then $5.00 per withdrawal", "Excessive Withdrawals | $5.00 per withdrawal", "excess_withdrawal", 5],
    ["Excessive Withdrawals | 6 free per month, then $5.00 per withdrawal (maximum $25.00 per month)", "Excessive Withdrawals | $5.00 per withdrawal", "excess_withdrawal", 5],
    ["Account Research | 2 free per month, then $25.00/hour, $10 minimum", "Account Research | $25.00/hour", "account_research", 25],
    ["Account Research | 2 free per month, then $25.00 per hr. Research Copies $1.00", "Account Research | $25.00 per hr.", "account_research", 25],
    ["Excessive Withdrawals | 6 free per month, then $5.00 each per month", "Excessive Withdrawals | $5.00 each per month", "excess_withdrawal", 5],
    ["Statement Copy | 2 free statements per month, then $2 per statement", "Statement Copy | $2 per statement", "document_reproduction", 2],
    ["Notary | 2 free per year, then $5.00 per signature", "Notary | $5.00 per signature", "notary_fee", 5],
  ])("should_publish_review_lines_at_base_frequency: %s", (line, baseLine, key, amount) => {
    expectSameAsBase(line, baseLine, key, amount, true);
  });

  // Reviews of 6843e39 and 70d2d09: a period word in the next fee's name on the row is not the price's unit.
  // The price is read as base reads the fee alone; where Darwin would still take the next fee's period, the
  // read is left out (`allowance_frequency_disagrees`), so nothing new publishes with a wrong period.
  it.each([
    ["Excess Withdrawal | 6 free per month, then $5.00 each, Monthly Fee $10.00 per month", "Excess Withdrawal | $5.00 each", "excess_withdrawal", 5],
    ["Excess Withdrawal | 6 free per month, then $5.00 each Monthly Service Fee $10.00", "Excess Withdrawal | $5.00 each", "excess_withdrawal", 5],
    ["Overdraft | 1 free per year, then $30.00 Daily Overdraft Fee $5.00", "Overdraft | $30.00", "overdraft", 30],
    ["Photocopies | 5 free then $1.00, Research (hourly) $25.00", "Photocopies | $1.00", "document_reproduction", 1],
    ["Counter Checks | 3 free per month, then $2.00, Annual Fee $10.00", "Counter Checks | $2.00", "counter_check", 2],
    ["Debit Card Replacement | 1 free per year, then $2.00 Annual Card Fee $15.00", "Debit Card Replacement | $2.00", "card_replacement", 2],
    ["Photocopies | 5 free then $1.00 Hourly Research $25.00", "Photocopies | $1.00", "document_reproduction", 1],
    ["Photocopies | 5 free then $1.00 | Monthly Fee | $5.00 per month", "Photocopies | $1.00", "document_reproduction", 1],
    ["Photocopies | 5 free then $1.00 | Research | $25.00 per hour", "Photocopies | $1.00", "document_reproduction", 1],
    ["Notary FL/GA | 2 free per year, then $10.00/$2.00 Annual Fee $5.00", "Notary FL/GA | $10.00/$2.00", "notary_fee", 2],
    ["Wire Transfer (Domestic/International) | 1 free per month, then $25.00/$45.00 per month", "Wire Transfer (Domestic/International) | $25.00/$45.00", "wire_intl_outgoing", 45],
  ])("should_never_take_the_next_fees_period: %s", (line, baseLine, key, amount) => {
    expectSameAsBase(line, baseLine, key, amount, false);
  });

  // Review of 34a44e3: another price shares the cell, and the next fee's name is lowercase. Base reads that
  // name's period on the same line with no allowance, so base is not copied: the price publishes per item or
  // not at all, never with the next fee's period.
  it.each([
    ["Counter Checks | 3 free per month, then $2.00, annual fee $10.00", "counter_check", 2],
    ["Counter Checks | 3 free per month, then $2.00 annual fee $10.00", "counter_check", 2],
    ["Photocopies | 5 free then $1.00 hourly research $25.00", "document_reproduction", 1],
    ["Photocopies | 5 free then $1.00, hourly research $25.00", "document_reproduction", 1],
    ["Excess Withdrawal | 6 free per month, then $5.00 each, monthly fee $10.00", "excess_withdrawal", 5],
    ["Excess Withdrawal | 6 free per month, then $5.00, monthly service charge $10.00", "excess_withdrawal", 5],
    ["Excess Withdrawal | 6 free per month, then $5.00 each - monthly fee $10.00", "excess_withdrawal", 5],
    ["Excess Withdrawal | 6 free per month, then $5.00 each and monthly fee $10.00", "excess_withdrawal", 5],
    ["Excess Withdrawal | 6 free per month, then $5.00 each or monthly $10.00", "excess_withdrawal", 5],
    ["Excess Withdrawal | 6 free per month, then $5.00 each [monthly fee $10.00]", "excess_withdrawal", 5],
    ["Overdraft | 1 free per year, then $30.00 daily overdraft fee $5.00", "overdraft", 30],
    ["Overdraft | 1 free per year, then $30.00, daily $5.00 thereafter", "overdraft", 30],
    ["Coin Counting | 2 free per month, then $5.00 per bag, monthly cap $50.00", "coin_counting", 5],
    ["Account Research | 2 free per month, then $25.00 per hour, monthly fee $10.00", "account_research", 25],
    ["Statement Copy | 2 free per month, then $2 per statement, monthly $5 for e-statements", "document_reproduction", 2],
  ])("should_publish_per_item_or_nothing_beside_another_price: %s", (line, key, amount) => {
    expect(["per_item", ABSENT], line).toContain(publishedFrequency(line, key, amount));
    const read = knoxFrequency(line, amount);
    expect(["per_item", ABSENT], line).toContain(read);
  });

  it("should_count_a_period_word_beside_another_price_as_its_own_drop", () => {
    expect(runFreeSpecialists(schedule("Counter Checks | 3 free per month, then $2.00, annual fee $10.00")).dropped.allowance_shared_cell_period).toBe(1);
  });

  it("should_read_per_item_beside_another_price_when_no_period_word_is_between", () => {
    expect(knoxFrequency("Counter Checks | 3 free per month, then $1.00 per check, Stop Payment $30.00", 1)).toBe("per_item");
    expect(knoxFrequency("Counter Checks | 3 free per month, then $1.00, stop payment $30.00", 1)).toBe("per_item");
  });

  it("should_read_a_bare_unit_in_its_own_next_cell_as_base_does", () => {
    expectSameAsBase("Account Research | 2 free per month, then $25.00 | per hour", "Account Research | $25.00 | per hour", "account_research", 25, true);
    // A next cell with a name or a price is another fee's, not a unit.
    expect(["per_item", null, ABSENT]).toContain(knoxFrequency("Photocopies | 5 free per month, then $1.00 | Monthly Fee | $5.00", 1));
  });

  it("should_keep_the_unit_of_a_name_over_180_characters", () => {
    const name = "Account Research Service for Members of the Credit Union and Their Immediate Family Members Living in the Same Household (see branch)";
    const line = `${name} | 2 free per month, then $25.00 per hour`;
    expect(publishedFrequency(line, "account_research", 25), line).toBe(publishedFrequency(`${name} | $25.00 per hour`, "account_research", 25));
    expect(publishedFrequency(line, "account_research", 25), line).toBe("hourly");
  });

  it("should_flag_paired_variants_after_an_allowance_and_guard_their_frequency", () => {
    const line = "Wire Transfers Outgoing (Online/Manual) | 2 free per month, then $35/$60";
    const reads = runFreeSpecialists(schedule(line)).candidates;
    expect(reads.map((read) => read.amount), line).toEqual([35, 60]);
    for (const read of reads) expect(read, line).toMatchObject({ allowancePrice: true });
    expectSameAsBase(line, "Wire Transfers Outgoing (Online/Manual) | $35/$60", reads[0].canonicalHint, 35, true);
    expectSameAsBase(line, "Wire Transfers Outgoing (Online/Manual) | $35/$60", reads[1].canonicalHint, 60, true);
    // The variant right before the next fee's "Annual Fee" never publishes as annual.
    const guarded = "Wire Transfers Outgoing (Online/Manual) | 2 free per month, then $35/$60 Annual Fee $10.00";
    expectSameAsBase(guarded, "Wire Transfers Outgoing (Online/Manual) | $35/$60", reads[1].canonicalHint, 60, false);
  });

  // Re-review of 6843e39: bare statements are statement copies, not a stretch of time.
  it.each([
    ["Statement Copy | 2 free statements per month, then $2 per statement", 2],
    ["Statement Copies | First 2 statements free, then $5.00 each", 5],
    ["Check Images | 2 free statements, then $3.00 per statement", 3],
    ["Interim Statement | 1 free statement per cycle, then $2.00", 2],
  ])("should_read_a_count_of_free_statements: %s", (line, amount) => {
    expect(published(schedule(line)).map(([, value]) => value)).toEqual([amount]);
  });

  it("should_not_read_an_accounts_own_monthly_fee_after_free_statements", () => {
    expect(published(schedule("Monthly Maintenance | 3 free statements then $5.00 per month"))).toEqual([]);
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
