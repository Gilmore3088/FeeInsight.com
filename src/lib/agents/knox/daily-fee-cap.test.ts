import { describe, expect, it } from "vitest";

import { runCase } from "@/lib/agents/deming/shadow-lab/run-case";
import { currentVariant, EXPERIMENTS, experimentalVariant } from "@/lib/agents/deming/shadow-lab/variants";
import type { PipelineVariant } from "@/lib/agents/deming/shadow-lab/types";
import { runFreeSpecialists } from "./specialists";

type Read = [string, number];

/** Knox, Darwin's verify and the publish gate with `DAILY_CAP_LINES_LIVE` switched on. */
const switchedOn = experimentalVariant(EXPERIMENTS["daily-cap-lines"]);

/** What Knox reads and keeps, as [category, amount]. */
function read(text: string, dailyCapLines = false): Read[] {
  return runFreeSpecialists(text, { dailyCapLines }).candidates.map((fee): Read => [fee.canonicalHint ?? "", fee.amount]);
}

/** Knox, Darwin's verify and the publish gate on the text: the fees published, as [category, amount]. */
function published(text: string, variant: PipelineVariant = currentVariant): Read[] {
  const run = runCase(variant, {
    caseKey: "daily-fee-cap",
    scenario: "missed_fees",
    provenance: { fixture: "unit", fixtureCaseKey: "daily-fee-cap", textHash: null, issue: "2064" },
    document: { url: null, text },
    expected: { publish: [], forbid: [] },
    status: "ok",
  });
  return run.published.map((fee): Read => [fee.canonicalFeeKey ?? "", (fee.amountCents ?? 0) / 100]);
}

const caps = (rows: Read[]): number[] => rows.filter(([key]) => /_daily_cap$/.test(key)).map(([, amount]) => amount);
const capsEitherWay = (text: string): number[] => [...caps(published(text)), ...caps(published(text, switchedOn))];

// The stored lines, as the seven-state and shadow-lab fixtures hold them.
// State key 10500: the cap follows the per-item price in a note, named after its figure.
const MAX_DAILY_NOTE = "OD/NSF\nPaid Overdraft Charge: $30.00/item ($150.00 max daily)";
// State key 8741: the cap is its own line under the fee it caps, with its count printed (4 x $30).
const CAP_LINE_UNDER_FEE = [
  "Overdrafts & Deposit Fees",
  "Courtesy Pay | $30/item | Wire Transfer (incoming) | $5/item",
  "4 item cap per day (max fee of $120/day)",
  "Expedited Bill-pay check | $30/each",
].join("\n");
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

describe("Knox v136: a dollar cap on a day's overdraft or NSF fees, with the wider trace off (today)", () => {
  it("should_publish_the_caps_the_shared_check_traced_before_v136", () => {
    expect(caps(published(DAILY_MAXIMUM_AFTER_ITEM_PRICE))).toEqual([96]);
    expect(caps(published(LIMIT_EACH_DAY))).toEqual([108]);
  });

  it("should_read_but_hold_the_caps_only_the_wider_trace_reaches", () => {
    for (const text of [MAX_DAILY_NOTE, CAP_LINE_UNDER_FEE, WILL_NOT_EXCEED]) {
      expect(caps(read(text)).length, text).toBe(0);
      expect(caps(published(text)), text).toEqual([]);
    }
  });
});

describe("Knox v136: a dollar cap on a day's overdraft or NSF fees, with DAILY_CAP_LINES_LIVE on", () => {
  it("should_read_a_cap_named_after_its_figure", () => {
    expect(caps(published(MAX_DAILY_NOTE, switchedOn))).toEqual([150]);
  });

  it("should_read_a_cap_line_under_the_fee_whose_count_it_prints", () => {
    expect(caps(published(CAP_LINE_UNDER_FEE, switchedOn))).toEqual([120]);
  });

  it("should_read_a_sentence_that_caps_the_overdraft_fees_it_names", () => {
    expect(caps(published(WILL_NOT_EXCEED, switchedOn))).toEqual([100]);
    expect(caps(published(LIMIT_EACH_DAY, switchedOn))).toEqual([108]);
    expect(caps(published(DAILY_MAXIMUM_AFTER_ITEM_PRICE, switchedOn))).toEqual([96]);
  });

  it("should_keep_the_per_item_fee_beside_its_cap_at_its_own_category_and_price", () => {
    expect(published(MAX_DAILY_NOTE, switchedOn)).toContainEqual(["overdraft", 30]);
    expect(published(CAP_LINE_UNDER_FEE, switchedOn)).toEqual(expect.arrayContaining([["overdraft", 30], ["wire_domestic_incoming", 5], ["bill_pay", 30]]));
    expect(published(WILL_NOT_EXCEED, switchedOn)).toEqual(expect.arrayContaining([["overdraft", 30], ["nsf", 35]]));
  });
});

// The review of #2768 (exact head 1d60951): each of these published a wrong daily cap there, and none
// did on main. Each must publish none, with the wider trace off or on.
describe("Knox v136: a limit or another fee's figure is never a daily cap (review of #2768)", () => {
  it("should_not_read_an_overdraft_or_coverage_limit_as_a_cap", () => {
    for (const text of [
      "Overdraft Fee $35.00\nOverdraft Limit $500 per day",
      "Overdraft Privilege | $35.00 per item\nOverdraft limit of $500 per day",
      "Overdraft Fee | $35.00 per item\nPaid items limit $500 per day",
      "Bounce Protection | $30.00 per item\nTotal limit of $750 per day",
      "Courtesy Pay | $30/item\nLimit of $500 per day",
      "Courtesy Pay | $30/item\nlimit up to $500 per day",
      "Overdraft Fee | $30.00 per item\nCourtesy Pay limit of $500 per day",
      "No Bounce Courtesy Pay Limit | $600.00",
    ]) {
      expect(capsEitherWay(text), text).toEqual([]);
    }
    // "Courtesy Pay | $30/item" over "Courtesy Pay limit of $500 per day" publishes a $500 cap on main
    // already, through the family's first cap rule and main's trace; v136 leaves that rule as it is
    // (changing it would take a published read down). Follow-up on #1092.
  });

  it("should_not_read_a_cap_on_another_fee_as_the_overdraft_cap", () => {
    for (const text of [
      "Overdraft Fee | $35.00 per item\nmaximum $120 per day for returned deposited items",
      "NSF Fee | $30.00 per item\nmaximum $120 per day for returned deposited items",
      "Overdraft Fee $35.00 per item\nMaximum $100 per day in returned item fees for deposited items",
      "Overdraft Fee $35.00 per item\nMaximum $60 per day for returned deposits",
      "Overdraft Fee $35 Stop Payment Fee $30\nLimit of $120 per day",
      "Overdraft Fee $35 | Stop Payment $30\nMaximum of $120 per day",
      "Overdraft Fee $35 Account Research $25 per hour\nMaximum of $100 per day",
      "Overdraft Fee $35 Coin counting $5\nMaximum of $100 per day",
      "Overdraft Fee | $30.00 per item\nWire Transfer | $25.00 | Maximum of $120.00 per day",
      "Overdraft Protection Transfer | $5.00 per transfer (maximum $25 per day)",
      "Cash Advance Fee | 3% (maximum $50 per day)",
    ]) {
      expect(capsEitherWay(text), text).toEqual([]);
    }
  });

  it("should_not_read_a_per_item_price_as_a_cap", () => {
    for (const text of [
      "NSF Fee | $30.00 per item\nDaily maximum $35 per item",
      "NSF Fee $30.00\nDaily maximum $35 per item paid",
      "Overdraft Fee $30.00\nOverdraft fee daily maximum $35 per item",
      "Paid NSF Item: | $19.00 Maximum 3 per day",
    ]) {
      expect(capsEitherWay(text), text).toEqual([]);
    }
  });

  it("should_not_read_a_sustained_charge_or_a_figure_too_small_for_the_fee_as_a_cap", () => {
    for (const text of [
      "Overdraft Fee | $35.00 per item\nDaily maximum fee of $5.00 for sustained overdrafts",
      "Daily maximum fee of $5.00 for sustained overdrafts",
      "Overdraft Fee $35.00\nDaily overdraft fee maximum $5.00 after 5 days",
      "Overdraft Fee | $35.00 per item\nMaximum $10 per day after 5 days",
      "Overdraft Fee | $35.00 per item\nMaximum of $25.00 per day",
      "Overdraft Fee | $35.00 per item\nMax $35 each day",
      "Non-Sufficient Funds (NSF) Fee | $32.50\n(Daily limit of $32.50 per\naccount)",
      "Continuous Overdraft Fee\n$5.00 per day/Maximum 20 consecutive business days/$100.00.",
    ]) {
      expect(capsEitherWay(text), text).toEqual([]);
    }
  });

  it("should_not_read_a_card_atm_or_deposit_limit_beside_an_overdraft_fee", () => {
    for (const limit of [
      "- You may withdraw up to a maximum of $500.00 in any one (1) day from an ATM machine.",
      "Daily ATM cash limit: $500",
      "- You may purchase up to a maximum of $1,000.00 from POS terminals per day.",
      "Maximum daily deposits limit is $4,000.00",
      "Total ATM withdrawals will not exceed $500.00 per day",
    ]) {
      const text = `Overdraft Fee | $30.00 per item\n${limit}`;
      expect(capsEitherWay(text), limit).toEqual([]);
    }
  });

  it("should_not_read_a_cap_with_no_overdraft_fee_above_it_or_two_fees_away", () => {
    expect(capsEitherWay("Total overdraft fees will not exceed $100.00 per day")).toEqual([]);
    expect(capsEitherWay("Overdraft Fee | $30.00\nStop Payment | $25.00\nMoney Order | $5.00\nLimit of $120 per day")).toEqual([]);
  });
});
