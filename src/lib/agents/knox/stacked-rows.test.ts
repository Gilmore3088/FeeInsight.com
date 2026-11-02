import { describe, expect, it } from "vitest";

import { runCase } from "@/lib/agents/deming/shadow-lab/run-case";
import { currentVariant, experimentalVariant } from "@/lib/agents/deming/shadow-lab/variants";
import { KNOX_RULES_STRATEGY, runFreeSpecialists } from "./specialists";
import { stackedPairs } from "./stacked-rows";
import { ADDED, SAME_AS_MAIN } from "./stacked-rows.fixtures";

type Published = [category: string, dollars: number, frequency: string | null, name: string];

/** Knox before v150: the same readers with no stacked pairs. */
const mainVariant = experimentalVariant({ id: "main", description: "Knox before v150", excerptAtPublish: false, withoutStackedRows: true });

/** A schedule with a fee base reads on either side, so each case sits among other rows. */
const schedule = (lines: readonly string[]): string => ["Fee Schedule", "Returned Item Fee | $30.00", ...lines, "Money Order | $2.00"].join("\n");

/** Knox, Darwin's verify and the publish gate on the text: the fees published, sorted. */
function published(text: string, main = false): Published[] {
  const run = runCase(main ? mainVariant : currentVariant, {
    caseKey: "stacked-rows",
    scenario: "missed_fees",
    provenance: { fixture: "unit", fixtureCaseKey: "stacked-rows", textHash: null, issue: "v150" },
    document: { url: null, text },
    expected: { publish: [], forbid: [] },
    status: "ok",
  });
  return run.published
    .map((fee): Published => [fee.canonicalFeeKey ?? "", (fee.amountCents ?? 0) / 100, fee.frequency ?? null, fee.feeName ?? ""])
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1] || a[3].localeCompare(b[3]));
}

/** Knox's reads of the text, as the same four fields. */
function knoxReads(text: string, main = false): Published[] {
  return runFreeSpecialists(text, { withoutStackedRows: main })
    .candidates.map((fee): Published => [fee.canonicalHint, fee.amount, fee.frequency ?? null, fee.feeName])
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1] || a[3].localeCompare(b[3]));
}

const key = (fee: Published): string => JSON.stringify(fee);
const without = (all: Published[], some: Published[]): Published[] => all.filter((fee) => !some.some((other) => key(other) === key(fee)));

describe("Knox v150: a fee's name over its price alone is read as the label row the two lines state", () => {
  it("should_bump_the_rules_strategy", () => {
    expect(KNOX_RULES_STRATEGY.version).toBeGreaterThanOrEqual(150);
  });

  it.each(SAME_AS_MAIN.map((c) => [c.label, c.lines] as const))("should_publish_what_main_publishes_for_%s", (_label, lines) => {
    expect(published(schedule(lines))).toEqual(published(schedule(lines), true));
  });

  it.each(ADDED.map((c) => [c.label, c.lines, c.row] as const))(
    "should_add_only_what_main_reads_and_publishes_for_the_same_label_row_for_%s",
    (_label, lines, row) => {
      // Knox: main's whole reading is kept and exactly one read is added, main's own read of the label row.
      const mainReads = knoxReads(schedule(lines), true);
      const added = without(knoxReads(schedule(lines)), mainReads);
      expect(without(mainReads, knoxReads(schedule(lines)))).toEqual([]);
      expect(added).toHaveLength(1);
      expect(added).toEqual(without(knoxReads(schedule(row), true), mainReads));
      // Darwin and the publish gate settle it as they settle the label row (they may still refuse both).
      const main = published(schedule(lines), true);
      expect(without(main, published(schedule(lines)))).toEqual([]);
      expect(without(published(schedule(lines)), main)).toEqual(without(published(schedule(row), true), main));
    },
  );

  it("should_read_state_key_2017s_counter_checks_at_the_price_after_the_allowance", () => {
    const lines = ["Cashier's Check Customer*", "$4.00 - *No charge to Senior Citizens 65+", "Counter Checks", "5 free - $0.25/after", "Checking &amp; Savings Account Early Closure", "$25.00 within 90 days of account opening."];
    expect(without(published(schedule(lines)), published(schedule(lines), true))).toEqual([["counter_check", 0.25, null, "Counter Checks"]]);
  });

  it("should_add_one_fee_for_two_copies_of_the_same_page", () => {
    const page = ["Counter Checks", "5 free - $0.25/after"];
    const text = schedule([...page, "Fee Schedule", ...page]);
    expect(without(published(text), published(text, true))).toEqual([["counter_check", 0.25, null, "Counter Checks"]]);
  });

  it("should_add_nothing_beside_a_fee_main_reads_under_the_same_name_or_at_the_same_category_and_price", () => {
    const pair = ["Counter Checks", "5 free - $0.25/after"];
    // Main reads "Counter Checks" at $1.00 from its row: the pair's $0.25 would be a second price for one name.
    const sameName = schedule(["Counter Checks | $1.00", ...pair]);
    expect(knoxReads(sameName, true)).toContainEqual(["counter_check", 1, null, "Counter Checks"]);
    expect(knoxReads(sameName)).toEqual(knoxReads(sameName, true));
    // The same name tidied differently ("COUNTER CHECKS:", "Counter Checks -") is the same name.
    const tidied = schedule(["COUNTER CHECKS - | $1.00", ...pair]);
    expect(knoxReads(tidied, true).filter((read) => read[0] === "counter_check")).toHaveLength(1);
    expect(knoxReads(tidied)).toEqual(knoxReads(tidied, true));
    // Main reads a counter check at $0.25 under another name: the pair would be the same fee twice.
    const samePrice = schedule(["Temporary Checks | $0.25 each", ...pair]);
    expect(knoxReads(samePrice, true).filter((read) => read[0] === "counter_check" && read[1] === 0.25)).toHaveLength(1);
    expect(knoxReads(samePrice)).toEqual(knoxReads(samePrice, true));
  });

  it("should_keep_the_printed_lines_as_the_excerpt", () => {
    const read = runFreeSpecialists(schedule(["Counter Checks", "5 free - $0.25/after"])).candidates.find((fee) => fee.feeName === "Counter Checks");
    expect(read?.excerpt).toBe("Counter Checks / 5 free - $0.25/after");
  });

  it("should_pair_no_line_twice", () => {
    const pairs = stackedPairs(["Stop Payment", "$30.00", "Overdraft Fee", "$35.00"].join("\n"));
    expect(pairs.map((pair) => [pair.nameAt, pair.priceAt])).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });
});
