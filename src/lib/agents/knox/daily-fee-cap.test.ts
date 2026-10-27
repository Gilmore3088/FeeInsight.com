import { describe, expect, it } from "vitest";

import { runCase } from "@/lib/agents/deming/shadow-lab/run-case";
import { currentVariant } from "@/lib/agents/deming/shadow-lab/variants";
import { runFreeSpecialists } from "./specialists";

type Read = [string, number];

/** What Knox reads and keeps, as [category, amount]. */
function read(text: string): Read[] {
  return runFreeSpecialists(text).candidates.map((fee): Read => [fee.canonicalHint ?? "", fee.amount]);
}

/** Knox, Darwin's verify and the publish gate on the text: the fees published, as [category, amount]. */
function published(text: string): Read[] {
  const run = runCase(currentVariant, {
    caseKey: "daily-fee-cap",
    scenario: "missed_fees",
    provenance: { fixture: "unit", fixtureCaseKey: "daily-fee-cap", textHash: null, issue: "2064" },
    document: { url: null, text },
    expected: { publish: [], forbid: [] },
    status: "ok",
  });
  return run.published.map((fee): Read => [fee.canonicalFeeKey ?? "", (fee.amountCents ?? 0) / 100]);
}

const caps = (rows: Read[]): number[] => rows.filter(([key]) => key === "od_daily_cap").map(([, amount]) => amount);

// The stored lines, as the Texas, seven-state and shadow-lab fixtures hold them.
// State key 10500: the cap follows the per-item price in a note, named after its figure.
const MAX_DAILY_NOTE = "OD/NSF\nPaid Overdraft Charge: $30.00/item ($150.00 max daily)";
// State key 8741: the cap is its own line under the fee it caps, priced "/day".
const CAP_LINE_UNDER_FEE = [
  "Overdrafts & Deposit Fees",
  "Courtesy Pay | $30/item | Wire Transfer (incoming) | $5/item",
  "4 item cap per day (max fee of $120/day)",
  "Expedited Bill-pay check | $30/each",
].join("\n");
// Texas key 2416: "Limit of $120 per day" under the NSF fee, a blank line between.
const LIMIT_LINE_UNDER_FEE = "Return Item Fee: $30 (unpaid due to insufficient funds)\n\nLimit of $120 per day";
// Texas key 2425: "(Daily limit of $97.50 per" under the overdraft fee, the unit wrapped to the next line.
const DAILY_LIMIT_NOTE = "Overdraft (OD) Fee $32.50\n(Daily limit of $97.50 per\naccount)";
// State key 2017: the per-item price and "Daily maximum" on one line under the fee's name.
const DAILY_MAXIMUM_AFTER_ITEM_PRICE = [
  "Overdraft Charge each item paid (Created by Check, ACH Debit, Internet or Online Debit, Bank Fee, In Person Withdrawal, Phone Debit)",
  "",
  "$32.00 per item/Daily maximum $96.00. Overdraft charges will not be assessed on non-business days (Saturdays, Sundays).",
].join("\n");
// Live audit 2735: a sentence names the fees it caps.
const WILL_NOT_EXCEED = [
  "$30.00 Overdraft charge per check/item.",
  "$35.00 Returned check charge per check/item.",
  "$10.00 Per day charge for each account remaining overdrawn after 5 business days.",
  "Total overdraft charges/fees will not exceed $100.00 per day",
].join("\n");
// Live audit 75: the cap is a sentence after the overdraft fee's sentence.
const LIMIT_EACH_DAY =
  "You are required to pay a $36 overdraft fee for each overdraft transaction that is paid by the bank. " +
  "There is a limit of $108 each day in total fees that you can be charged for overdrawing your account. " +
  "We will not charge you a Returned Item Fee for items presented against insufficient funds in your account and returned unpaid.";

describe("Knox v136: a dollar cap on a day's overdraft or NSF fees is read as the daily cap", () => {
  it("should_read_a_cap_named_after_its_figure", () => {
    expect(caps(read(MAX_DAILY_NOTE))).toEqual([150]);
    expect(caps(published(MAX_DAILY_NOTE))).toEqual([150]);
  });

  it("should_read_a_cap_line_under_the_fee_it_caps", () => {
    expect(caps(published(CAP_LINE_UNDER_FEE))).toEqual([120]);
    expect(caps(published(LIMIT_LINE_UNDER_FEE))).toEqual([120]);
    expect(caps(published(DAILY_LIMIT_NOTE))).toEqual([97.5]);
  });

  it("should_read_a_daily_maximum_after_the_per_item_price", () => {
    expect(caps(published(DAILY_MAXIMUM_AFTER_ITEM_PRICE))).toEqual([96]);
  });

  it("should_read_a_sentence_that_caps_the_overdraft_fees_it_names", () => {
    expect(caps(published(WILL_NOT_EXCEED))).toEqual([100]);
    expect(caps(published(LIMIT_EACH_DAY))).toEqual([108]);
  });

  it("should_keep_the_per_item_fee_beside_its_cap_at_its_own_category_and_price", () => {
    expect(published(MAX_DAILY_NOTE)).toContainEqual(["overdraft", 30]);
    expect(published(CAP_LINE_UNDER_FEE)).toEqual(expect.arrayContaining([["overdraft", 30], ["wire_domestic_incoming", 5], ["bill_pay", 30]]));
    expect(published(WILL_NOT_EXCEED)).toEqual(expect.arrayContaining([["overdraft", 30], ["nsf", 35]]));
  });
});

describe("Knox v136: a limit that is not a cap on overdraft or NSF fees stays unread as a cap", () => {
  it("should_not_read_a_card_atm_or_deposit_limit_beside_an_overdraft_fee", () => {
    for (const limit of [
      "- You may withdraw up to a maximum of $500.00 in any one (1) day from an ATM machine.",
      "Daily ATM cash limit: $500",
      "- You may purchase up to a maximum of $1,000.00 from POS terminals per day.",
      "Maximum daily deposits limit is $4,000.00",
      "Total ATM withdrawals will not exceed $500.00 per day",
      "Wire Transfer | $25.00 | Maximum of $120.00 per day",
    ]) {
      expect(caps(published(`Overdraft Fee | $30.00 per item\n${limit}`)), limit).toEqual([]);
    }
  });

  it("should_not_read_a_count_limit_or_a_balance_as_a_dollar_cap", () => {
    expect(caps(published("Paid NSF Item: | $19.00 Maximum 3 per day"))).toEqual([]);
    expect(caps(published("Overdraft Fee | $30.00 per item\nOverdraft fees are limited to a maximum of 5 per day"))).toEqual([]);
    expect(caps(published("No Bounce Courtesy Pay Limit | $600.00"))).toEqual([]);
    expect(caps(published("Overdraft Fee | $30.00 per item\nCourtesy Pay limit of $500 per day"))).toEqual([]);
  });

  it("should_not_read_a_cap_on_another_fee_or_on_a_sustained_overdraft", () => {
    expect(caps(published("Overdraft Protection Transfer | $5.00 per transfer (maximum $25 per day)"))).toEqual([]);
    expect(caps(published("Continuous Overdraft Fee\n$5.00 per day/Maximum 20 consecutive business days/$100.00."))).toEqual([]);
    expect(caps(published("Cash Advance Fee | 3% (maximum $50 per day)"))).toEqual([]);
  });

  it("should_not_read_a_cap_no_larger_than_the_one_fee_it_caps", () => {
    // Texas key 2425: "(Daily limit of $32.50 per account)" beside a $32.50 NSF fee is one fee a day.
    expect(caps(published("Non-Sufficient Funds (NSF) Fee | $32.50\n(Daily limit of $32.50 per\naccount)"))).toEqual([]);
  });

  it("should_not_read_a_cap_two_fees_away_from_its_overdraft_fee", () => {
    const far = "Overdraft Fee | $30.00\nStop Payment | $25.00\nMoney Order | $5.00\nLimit of $120 per day";
    expect(caps(published(far))).toEqual([]);
  });
});
