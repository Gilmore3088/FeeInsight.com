import { describe, expect, it } from "vitest";

import { runCase } from "@/lib/agents/deming/shadow-lab/run-case";
import { currentVariant } from "@/lib/agents/deming/shadow-lab/variants";
import { publishNameHold } from "@/lib/agents/hamilton/publish";
import { isCutoffName } from "./cutoff-shape";
import { withoutGluedSentence } from "./glued-sentence-name";
import { runFreeSpecialists } from "./specialists";

type Read = [string, number];

/** What Knox reads and keeps, as [category, amount, name]. */
function named(text: string): Array<[string, number, string]> {
  return runFreeSpecialists(text).candidates.map((fee) => [fee.canonicalHint ?? "", fee.amount, fee.feeName]);
}

/** Knox, Darwin's verify and the publish gate on the text: what is published and what is held. */
function trace(text: string): { published: Read[]; held: Array<[string, number, string]> } {
  const run = runCase(currentVariant, {
    caseKey: "glued-sentence-name",
    scenario: "missed_fees",
    provenance: { fixture: "unit", fixtureCaseKey: "glued-sentence-name", textHash: null, issue: "1026" },
    document: { url: null, text },
    expected: { publish: [], forbid: [] },
    status: "ok",
  });
  return {
    published: run.published.map((fee): Read => [fee.canonicalFeeKey ?? "", (fee.amountCents ?? 0) / 100]),
    held: run.stages.publish_gate.dropped.map((fee) => [fee.canonicalFeeKey ?? "", (fee.amountCents ?? 0) / 100, String(fee.reason)]),
  };
}

// The stored lines, as the shadow lab's frozen fixtures hold them.
// State key 3148: the left column's footnote cell is glued in front of the right column's row.
const LEFT_FOOTNOTE_CELL = [
  "Pay-by-Phone (Per item) ......................................... $5.00 | person withdrawal, or other electronic item that is presented",
  "Mailed Paper Statement ......................................... $2.00 | or re-presented against insufficient funds and paid. If the",
  "(Per month some exclusions apply) | Cashier’s Check (Per item) ...................................... $5.00",
].join("\n");
// State key 8240: the left column's sentence is glued in front of the right column's fee.
const LEFT_SENTENCE_CELL =
  "Company that is part of our Health Savings Program offered | Share-to-Share Overdraft Transfer Fee*.......................................................................$10 per item";
// State key 11362: the row's description runs on after its name and a dash.
const DASH_DESCRIPTION = [
  "Medallion Stamp (Per Item) $50.00",
  "Overdraft Fee - An Overdraft Fee may be imposed for transactions made by check, | $32.00",
  "in-person withdrawal or other electronic means, as applicable. Overdraft Fees apply to",
  "paid items.",
].join("\n");
// Live audit 4993-source-1: a fee stated as a sentence, "<what> will cost $N".
const COST_SENTENCES = [
  "A copy of a cancelled check will cost $5.00 per check.",
  "Each cashier check payable to someone other than the member making the check will cost $5.",
].join("\n");
// State key 11362: the dash description is the fee's condition ("ATMs we do not own").
const DASH_CONDITION = "ATM Fee - Cash withdrawal at ATMs we do not own or operate $0.50";

describe("Knox v104: a fee name with a sentence glued on is cut to the fee's own words", () => {
  it("should_drop_a_neighbouring_columns_sentence_cell_glued_in_front", () => {
    expect(withoutGluedSentence("(Per month some exclusions apply): Cashier’s Check (Per item)", "cashiers_check")).toBe("Cashier’s Check (Per item)");
    expect(withoutGluedSentence("Company that is part of our Health Savings Program offered: Share-to-Share Overdraft Transfer Fee", "od_protection_transfer")).toBe(
      "Share-to-Share Overdraft Transfer Fee",
    );
  });

  it("should_drop_a_sentence_describing_the_fee_after_a_dash", () => {
    expect(withoutGluedSentence("Overdraft Fee - An Overdraft Fee may be imposed for transactions made by check", "overdraft")).toBe("Overdraft Fee");
  });

  it("should_name_a_will_cost_sentence_by_its_subject", () => {
    expect(withoutGluedSentence("Copy of a cancelled check will cost", "check_image")).toBe("Copy of a cancelled check");
    expect(withoutGluedSentence("Each cashier check payable to someone other than the member making the check will cost", "cashiers_check")).toBe(
      "Cashier check payable to someone other than the member making the check",
    );
  });

  it("should_leave_a_name_that_is_not_cut_off_as_read", () => {
    for (const [name, key] of [
      ["Stop Payment - Online", "stop_payment"],
      ["Dormant Account Fee - Checking Accounts", "dormant_account"],
      ["Wire Transfer: Outgoing Domestic", "wire_domestic_outgoing"],
      ["Cashier’s Check (Per item)", "cashiers_check"],
    ] as const) {
      expect(isCutoffName(name)).toBe(false);
      expect(withoutGluedSentence(name, key)).toBe(name);
    }
  });

  // Near misses: the genuinely cut-off names publish's `cutoff_name` hold exists for stay as read.
  it("should_never_cut_a_condition_off_the_name", () => {
    // The dash description is whose ATM it is (re-tidy v15 found this trim among 72 bad ones).
    expect(withoutGluedSentence("ATM Fee - Cash withdrawal at ATMs we do not own or operate", "atm_non_network")).toBe(
      "ATM Fee - Cash withdrawal at ATMs we do not own or operate",
    );
    // A figure or a balance in the dropped words is a condition.
    expect(withoutGluedSentence("Overdraft Fee - We charge no fee if the item is under $5.00", "overdraft")).toBe(
      "Overdraft Fee - We charge no fee if the item is under $5.00",
    );
    // A leading cell that says which fee it is: without it the name reads as another category.
    expect(withoutGluedSentence("Dormant accounts will be charged: Monthly Fee", "dormant_account")).toBe("Dormant accounts will be charged: Monthly Fee");
    // A definition of dormancy with its period is a condition too.
    const dormant = "Dormant Account Fee - Checking Accounts. A Checking account is dormant if for one";
    expect(withoutGluedSentence(dormant, "dormant_account")).toBe(dormant);
  });

  it("should_never_cut_to_a_name_that_is_still_cut_off_or_another_fee", () => {
    for (const [name, key] of [
      ["GUASFCU charges a", "check_image"],
      ["Any replacement cards whether lost, stolen, or damaged will be charged a", "card_replacement"],
      ["Paper Statements: Paper statements are available on this account for", "paper_statement"],
      ["Account Fees: A service charge (minimum balance fee) of", "monthly_maintenance"],
      ["If you request a copy it will cost", "document_reproduction"],
      // A dash description with no verb is a list of what the fee covers, not a sentence.
      ["Return Check Fee (Per Item) - Our Member NSF, etc", "nsf"],
      // What is left names another fee: a stop payment is not a cashier's check.
      ["Stop Payment - A cashier's check will be issued for the balance", "cashiers_check"],
      // A parenthetical that is a sentence of its own stays as read (publish test, #2032).
      ["ATM Withdrawal Fees, out of Network (Surcharge Fees, fees accessed by other ATM proprietors, may still apply.)", "atm_non_network"],
    ] as const) {
      expect(withoutGluedSentence(name, key)).toBe(name);
    }
  });

  it("should_leave_the_name_when_the_read_has_no_category", () => {
    expect(withoutGluedSentence("Overdraft Fee - An Overdraft Fee may be imposed for transactions made by check", null)).toBe(
      "Overdraft Fee - An Overdraft Fee may be imposed for transactions made by check",
    );
  });
});

describe("Knox v104 through Knox, Darwin's verify and the publish gate", () => {
  it("should_publish_the_right_column_fee_once_its_neighbours_cell_is_dropped", () => {
    expect(named(LEFT_FOOTNOTE_CELL)).toContainEqual(["cashiers_check", 5, "Cashier’s Check (Per item)"]);
    expect(trace(LEFT_FOOTNOTE_CELL).published).toContainEqual(["cashiers_check", 5]);
    expect(named(LEFT_SENTENCE_CELL)).toContainEqual(["od_protection_transfer", 10, "Share-to-Share Overdraft Transfer Fee"]);
    expect(trace(LEFT_SENTENCE_CELL).published).toContainEqual(["od_protection_transfer", 10]);
  });

  it("should_publish_a_fee_whose_description_ran_on_after_a_dash", () => {
    expect(named(DASH_DESCRIPTION)).toContainEqual(["overdraft", 32, "Overdraft Fee"]);
    expect(trace(DASH_DESCRIPTION).published).toContainEqual(["overdraft", 32]);
  });

  it("should_publish_a_fee_stated_as_a_will_cost_sentence", () => {
    const run = trace(COST_SENTENCES);
    expect(run.published).toContainEqual(["check_image", 5]);
    expect(run.published).toContainEqual(["cashiers_check", 5]);
  });

  it("should_still_hold_a_name_whose_dash_description_is_its_condition", () => {
    const run = trace(DASH_CONDITION);
    expect(run.published).not.toContainEqual(["atm_non_network", 0.5]);
    expect(run.held).toContainEqual(["atm_non_network", 0.5, "name_hold:cutoff_name"]);
  });

  it("should_leave_publish_holding_every_name_its_tests_hold", () => {
    // Hamilton's rule is unchanged: these are publish.test.ts's held names.
    expect(publishNameHold("GUASFCU charges a", "check_image", 2)?.code).toBe("cutoff_name");
    expect(publishNameHold("Any replacement cards whether lost, stolen, or damaged will be charged a", "card_replacement", 5)?.code).toBe("cutoff_name");
    expect(
      publishNameHold("ATM Withdrawal Fees, out of Network (Surcharge Fees, fees accessed by other ATM proprietors, may still apply.)", "atm_non_network", 0)?.code,
    ).toBe("cutoff_name");
  });
});
