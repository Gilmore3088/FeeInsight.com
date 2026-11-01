import { describe, expect, it } from "vitest";

import { runCase } from "@/lib/agents/deming/shadow-lab/run-case";
import { currentVariant, EXPERIMENTS, experimentalVariant } from "@/lib/agents/deming/shadow-lab/variants";
import type { ExtractedFeeCandidate } from "./rules";
import { DASH_LIST_ROWS_LIVE, dashListRuns, readDashListsAsRows, withDashListRows } from "./dash-list-rows";
import { KNOX_RULES_STRATEGY, runFreeSpecialists } from "./specialists";
import { CHANGED_FROM_MAIN, UNCHANGED_FROM_MAIN, type Published } from "./dash-list-rows.fixtures";

const schedule = (lines: readonly string[]): string => ["Fee Schedule", ...lines].join("\n");

const fullRewrite = experimentalVariant(EXPERIMENTS["dash-list-rows"]);

/**
 * Knox, Darwin's verify and the publish gate on the text: the fees published, sorted. `full` reads it as
 * the shadow lab's `dash-list-rows` experiment does (`DASH_LIST_ROWS_LIVE` on); otherwise as today.
 */
function published(text: string, full = false): Published[] {
  const run = runCase(full ? fullRewrite : currentVariant, {
    caseKey: "dash-list-rows",
    scenario: "missed_fees",
    provenance: { fixture: "unit", fixtureCaseKey: "dash-list-rows", textHash: null, issue: "v148" },
    document: { url: null, text },
    expected: { publish: [], forbid: [] },
    status: "ok",
  });
  return run.published
    .map((fee): Published => [fee.canonicalFeeKey ?? "", (fee.amountCents ?? 0) / 100, fee.frequency ?? null, fee.feeName ?? ""])
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1] || a[3].localeCompare(b[3]));
}

/** The label row each dash line lists ("$25.00 - NSF Fee" as "NSF Fee | $25.00"); other lines as stored. */
const asRows = (lines: readonly string[]): string[] =>
  lines.map((line) => {
    const match = line.match(/^\s*(?:[-–—•]\s+)?[\u200b-\u200d]*(\$\s?\d[\d,]*(?:\.\d{1,2})?)\s+[-–—]\s+([A-Z].*)$/);
    return match ? `${match[2].trim()} | ${match[1]}` : line;
  });

const STATE_10272 = [
  "Checking Fees",
  "\u200d$25.00 - NSF Check/ACH/ATM item",
  "$20.00 - Stop Payment (single check)",
  "$35.00 - Stop Payment (range of checks)",
  "$10.00 - Debit Card Replacement",
  "\u200d",
  "\u200dOther Service Fees",
  "\u200d$10.00 - Deposited Item Return",
  "$30.00 - Dormant Account (Annual Fee)",
  "$20.00 - Account Reconciliation (per hour)",
  "$50.00 - Garnishment/Levy Processing",
  "$20.00 - Wire Transfer",
  "$15.00 - Fed Global ACH",
  "$25.00 - Return Loan Payment Fee",
];
/** What main publishes for State key 10272: the single check at the range's $35 is wrong. */
const STATE_10272_MAIN: Published[] = [
  ["card_replacement", 10, null, "Debit Card Replacement: \u200d"],
  ["dormant_account", 30, "annual", "Dormant Account (Annual Fee)"],
  ["stop_payment", 35, null, "Stop Payment (single check)"],
];

const includesAll = (shown: Published[], expected: Published[]) => expected.every((fee) => shown.some((row) => JSON.stringify(row) === JSON.stringify(fee)));

describe("Knox v148: a dash price-first list is read as the label rows it lists", () => {
  it("should_bump_the_rules_strategy_and_keep_the_full_rewrite_off", () => {
    expect(KNOX_RULES_STRATEGY.version).toBeGreaterThanOrEqual(148);
    expect(DASH_LIST_ROWS_LIVE).toBe(false);
  });

  it("should_read_state_key_10272_exactly_as_main_with_the_switch_off", () => {
    // Main reads a name or price from both of 10272's runs (the $35 single check, the card replacement
    // priced from the next section's first line), so neither run adds a read until the switch (#1092).
    expect(published(schedule(STATE_10272))).toEqual(STATE_10272_MAIN);
  });

  it("should_read_state_key_10272_one_fee_per_line_at_its_own_price_with_the_switch_on", () => {
    expect(published(schedule(STATE_10272), true)).toEqual([
      ["account_research", 20, "hourly", "Account Reconciliation (per hour)"],
      ["card_replacement", 10, null, "Debit Card Replacement"],
      ["deposited_item_return", 10, null, "Deposited Item Return"],
      ["dormant_account", 30, "annual", "Dormant Account (Annual Fee)"],
      ["garnishment_levy", 50, null, "Garnishment/Levy Processing"],
      ["nsf", 25, null, "NSF Check/ACH/ATM item"],
      ["stop_payment", 20, null, "Stop Payment (single check)"],
      ["stop_payment", 35, null, "Stop Payment (range of checks)"],
    ]);
  });

  // Review of bbd4388: at a section break the stacked reader names a run's last fee "Name: \u200d" at the
  // next section's first price. With the switch off nothing may add a second price for that fee.
  const sectionBreak = (last: string, next: string): string[] => [
    "Checking Fees",
    "$25.00 - NSF Fee",
    last,
    "\u200d",
    "\u200dOther Service Fees",
    next,
    "$30.00 - Wire Transfer",
  ];
  const amountsOf = (rows: Published[], key: string): number[] => rows.filter((row) => row[0] === key).map((row) => row[1]);
  it.each([
    ["input A", ["Checking Fees", "$25.00 - NSF Fee", "$5.00 - Debit Card Replacement", "\u200d", "\u200dOther Service Fees", "\u200d$10.00 - Debit Card Replacement (rush)", "$30.00 - Stop Payment"], "card_replacement"],
    ["input B", ["Checking Fees", "$25.00 - NSF Fee", "$20.00 - Stop Payment", "\u200d", "\u200dOther Fees", "\u200d$35.00 - Stop Payment Range", "$30.00 - Wire Transfer"], "stop_payment"],
    ["input C", ["Checking Fees", "$25.00 - NSF Fee", "$20.00 - Stop Payment", "\u200d", "\u200dBusiness Fees", "$35.00 - Stop Payment", "$30.00 - NSF Fee"], "stop_payment"],
    ["a dash after the name", sectionBreak("$20.00 - Stop Payment -", "\u200d$35.00 - Stop Payment Range"), "stop_payment"],
    ["capitals", sectionBreak("$20.00 - STOP PAYMENT", "\u200d$35.00 - Stop Payment Range"), "stop_payment"],
    ["a qualifier", sectionBreak("$20.00 - Stop Payment (each)", "\u200d$35.00 - Stop Payment Range"), "stop_payment"],
  ])("should_never_add_a_second_price_for_a_fee_base_reads_at_a_section_break: %s", (_label, lines, key) => {
    // Main reads the fee once, at the next section's price (wrong, but one price); so does v148.
    expect(amountsOf(published(schedule(lines)), key)).toHaveLength(1);
  });

  it("should_store_the_printed_line_as_the_excerpt", () => {
    const reads = runFreeSpecialists(schedule(["Services", "$25.00 - Account Research (per hour)", "$15.00 - Statement Copy"])).candidates;
    expect(reads.find((fee) => fee.canonicalHint === "account_research")?.excerpt).toBe("$25.00 - Account Research (per hour)");
    for (const full of [false, true]) {
      const shown = runFreeSpecialists(schedule(STATE_10272), { dashListRows: full }).candidates;
      for (const fee of shown) expect(fee.excerpt, fee.feeName).not.toMatch(/ \| \$\d/);
    }
  });

  // With the switch off, every fee main publishes on every dash-run fixture is still published, unchanged.
  it.each([...CHANGED_FROM_MAIN.map((row) => ({ lines: row.lines, main: row.main })), ...UNCHANGED_FROM_MAIN.map((row) => ({ lines: row.lines, main: row.published })), { lines: STATE_10272, main: STATE_10272_MAIN }]
    .map((row) => [row.lines.join(" / "), row] as const))(
    "should_keep_every_fee_main_publishes_with_the_switch_off: %s",
    (_label, row) => {
      expect(includesAll(published(schedule(row.lines)), row.main)).toBe(true);
    },
  );

  // Off, each change only adds fees main publishes for the same lines written as label rows.
  it.each(CHANGED_FROM_MAIN.map((row) => [row.lines.join(" / "), row] as const))(
    "should_add_only_label_row_reads_with_the_switch_off: %s",
    (_label, row) => {
      const rows = published(schedule(asRows(row.lines)));
      for (const fee of published(schedule(row.lines))) expect(includesAll([...row.main, ...rows], [fee]), JSON.stringify(fee)).toBe(true);
    },
  );

  // On, correct by construction: each rewritten list publishes exactly what main publishes for its label rows.
  it.each(CHANGED_FROM_MAIN.map((row) => [row.lines.join(" / "), row] as const))(
    "should_publish_what_main_publishes_for_the_label_rows_with_the_switch_on: %s",
    (_label, row) => {
      expect(published(schedule(row.lines), true)).toEqual(row.published);
      expect(published(schedule(asRows(row.lines)))).toEqual(row.published);
      expect(published(schedule(row.lines), true)).not.toEqual(row.main);
    },
  );

  // Every near miss publishes what main publishes for the same stored lines (recorded from main 9e58a8c).
  it.each(UNCHANGED_FROM_MAIN.map((row) => [row.lines.join(" / "), row] as const))(
    "should_publish_what_main_publishes: %s",
    (_label, row) => {
      expect(published(schedule(row.lines))).toEqual(row.published);
      expect(published(schedule(row.lines), true)).toEqual(row.published);
    },
  );

  it.each([
    ["a lone dash line", ["Overdraft Fee", "$35.00 - Stop Payment Fee"]],
    ["a run under a fee's name", ["Overdraft Fee", "$30.00 - Stop Payment", "$25.00 - Returned Item"]],
    ["a run a bare price closes", ["Fees", "$30.00 - Stop Payment", "$25.00 - Returned Item", "$5.00"]],
    ["a sentence after the dash", ["Fees", "$10.00 - If both keys are lost", "$5.00 - When you ask"]],
    ["a period alone", ["Fees", "$3 - Monthly", "$5 - Annually"]],
    ["a range and a count", ["Fees", "$5 - $15 - Levy", "$5 - 10 Copies"]],
    ["a bullet with no dash", ["Wire Transfers:", "- $10 Incoming transfer", "- $20 Outgoing transfer"]],
    ["another cell or price", ["Fees", "$5.00 - Copy | $2.00 - Fax", "$3.00 - Check, $1.00 Page"]],
  ])("should_leave_%s_as_stored", (_label, lines) => {
    const text = schedule(lines);
    expect(dashListRuns(text)).toEqual([]);
    expect(withDashListRows(text)).toBe(text);
  });

  const candidate = (feeName: string, amount: number, excerpt: string, canonicalHint = "stop_payment"): ExtractedFeeCandidate => ({
    feeName, amount, excerpt, frequency: null, canonicalHint, confidence: 0.9, waivable: false,
  });
  const stored = schedule(["Fees", "$20.00 - Stop Payment", "$30.00 - Stop Payment (range)", "$25.00 - Returned Item Fee"]);

  it("should_read_the_run_as_stored_when_a_row_read_does_not_trace_to_the_stored_text", () => {
    const read = (text: string) => ({
      candidates: text === stored ? [candidate("Stop Payment", 30, "Stop Payment / $30.00")] : [candidate("Stop Payment", 99, "Stop Payment | $20.00")],
    });
    for (const full of [false, true]) {
      expect(readDashListsAsRows(stored, read, { full }).candidates).toEqual([candidate("Stop Payment", 30, "Stop Payment / $30.00")]);
    }
  });

  it("should_keep_base_whole_and_add_only_new_names_at_new_prices_with_the_switch_off", () => {
    // Base reads nothing from the run's lines, only a stop payment printed elsewhere on the page.
    const prior = candidate("Stop Payment: \u200d", 30, "stop payment fee elsewhere $30.00");
    const rows = [
      prior,
      candidate("STOP PAYMENT -", 20, "Stop Payment | $20.00"),
      candidate("Stop Payment (range)", 30, "Stop Payment (range) | $30.00"),
      candidate("Returned Item Fee", 25, "Returned Item Fee | $25.00", "nsf"),
    ];
    const read = (text: string) => ({ candidates: text === stored ? [prior] : rows });
    expect(readDashListsAsRows(stored, read).candidates).toEqual([prior, { ...rows[3], excerpt: "$25.00 - Returned Item Fee" }]);
  });

  it("should_add_nothing_from_a_run_base_reads_any_line_of_with_the_switch_off", () => {
    const prior = candidate("Stop Payment", 30, "- Stop Payment / $30.00");
    const rows = [candidate("Returned Item Fee", 25, "Returned Item Fee | $25.00", "nsf")];
    const read = (text: string) => ({ candidates: text === stored ? [prior] : rows });
    expect(readDashListsAsRows(stored, read).candidates).toEqual([prior]);
  });

  it("should_read_the_text_as_stored_when_the_rows_lose_a_read_from_another_line_with_the_switch_on", () => {
    const elsewhere = candidate("Wire Transfer", 25, "Wire Transfer | $25.00");
    const read = (text: string) => ({
      candidates: text === stored ? [elsewhere] : [candidate("Stop Payment", 20, "Stop Payment | $20.00")],
    });
    expect(readDashListsAsRows(stored, read, { full: true }).candidates).toEqual([elsewhere]);
  });

  it("should_replace_base_s_reads_of_the_run_with_the_switch_on", () => {
    const rows = [candidate("Stop Payment", 20, "Stop Payment | $20.00"), candidate("Stop Payment (range)", 30, "Stop Payment (range) | $30.00")];
    const read = (text: string) => ({ candidates: text === stored ? [candidate("Stop Payment", 30, "- Stop Payment / $30.00")] : rows });
    expect(readDashListsAsRows(stored, read, { full: true }).candidates).toEqual([
      { ...rows[0], excerpt: "$20.00 - Stop Payment" },
      { ...rows[1], excerpt: "$30.00 - Stop Payment (range)" },
    ]);
  });
});
