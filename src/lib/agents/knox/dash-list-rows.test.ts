import { describe, expect, it } from "vitest";

import { runCase } from "@/lib/agents/deming/shadow-lab/run-case";
import { currentVariant, EXPERIMENTS, experimentalVariant } from "@/lib/agents/deming/shadow-lab/variants";
import type { ExtractedFeeCandidate } from "./rules";
import { DASH_LIST_ROWS_LIVE, dashListRuns, readDashListsAsRows, withDashListRows } from "./dash-list-rows";
import { KNOX_RULES_STRATEGY, runFreeSpecialists } from "./specialists";

/** A published fee: [category, amount, frequency, name]. */
type Published = [string, number, string | null, string];
interface NearMiss {
  lines: string[];
  published: Published[];
}

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

const UNCHANGED_FROM_MAIN: NearMiss[] = [
  { lines: ["Account Fees", "$500 - Minimum balance to open", "$25.00 - Minimum Opening Deposit"], published: [] },
  { lines: ["ATM Card", "$1,000 - Daily ATM withdrawal limit", "$500 - Daily POS purchase limit"], published: [] },
  { lines: ["Mobile Deposit", "$5,000 - Maximum mobile deposit per day", "$2.00 - Mobile Deposit Express"], published: [["mobile_deposit", 2.0, null, "Mobile Deposit"]] },
  { lines: ["Overdraft", "$35.00 - Overdraft Fee", "$140 - Maximum overdraft fees per day"], published: [["overdraft", 35.0, null, "Overdraft Fee"]] },
  { lines: ["Overdraft", "$35.00 - Per item, maximum 4 per day", "$5.00 - Overdraft Transfer"], published: [["overdraft", 5.0, null, "Overdraft"], ["overdraft", 35.0, null, "Overdraft"]] },
  { lines: ["Checking", "$10.00 - Monthly Service Fee (waived with $500 balance)", "$5.00 - Paper Statement (waived with eStatements)"], published: [["monthly_maintenance", 10.0, "monthly", "Monthly Service Fee (waived with balance)"]] },
  { lines: ["Services", "1% - Foreign Transaction Fee", "$0.50 - Per $100 coin counted"], published: [] },
  { lines: ["Services", "$25.00 - Stop Payment; $35.00 - Range of checks", "$30.00 - NSF Fee"], published: [["nsf", 30.0, null, "NSF Fee"]] },
  { lines: ["Services", "$30.00 - NSF Fee, $30.00 Overdraft Fee", "$10.00 - Account Research"], published: [["nsf", 30.0, null, "NSF Fee, Overdraft Fee"]] },
  { lines: ["Overdraft Fee", "$30.00 - Stop Payment", "$25.00 - Returned Item", "$5.00"], published: [["overdraft", 30.0, null, "Overdraft Fee"]] },
  { lines: ["Services", "$2.00 - Counter checks, annual fee $10.00", "$5.00 - Cashier's Check"], published: [["counter_check", 10.0, "annual", "Counter checks, annual fee"]] },
  { lines: ["Services", "$5.00 - per wk", "$5.00 - Mo. Service Fee"], published: [] },
  { lines: ["Services", "$5.00 - ea.", "$3 - Monthly"], published: [] },
  { lines: ["Services", "$25.00 - Hourly Research", "$10.00 - Annual Fee"], published: [] },
  { lines: ["Check Cashing", "$5.00 - Non-Member Check Cashing", "$2.00 - Member Check Cashing"], published: [["check_cashing", 2.0, null, "Member Check Cashing"], ["check_cashing", 5.0, null, "Check Cashing"]] },
  { lines: ["Business Checking", "$10.00 - Business Checking Monthly Fee", "$0.20 - Per item over 200"], published: [] },
  { lines: ["Notary", "$2.00 - Members", "$5.00 - Non-members"], published: [["notary_fee", 2.0, null, "Notary"]] },
  { lines: ["Safe Deposit", "$10.00 - If both keys are lost, the box must be drilled", "$5 - for first occurrence then $10 each"], published: [["safe_deposit_box", 10.0, null, "Safe Deposit"]] },
  { lines: ["Legal", "$5 - $15 - Levy", "$50.00 - Garnishment"], published: [["garnishment_levy", 50.0, null, "Levy"]] },
  { lines: ["Wires", "$10.00 - Outgoing Wire .....", "$15.00 - Incoming Wire ....."], published: [["wire_domestic_outgoing", 15.0, null, "Outgoing Wire"]] },
  { lines: ["Overdraft Fee", "$35.00 - Stop Payment Fee"], published: [["overdraft", 35.0, null, "Overdraft Fee"], ["stop_payment", 35.0, null, "Stop Payment Fee"]] },
  { lines: ["Wire Transfers:", "  - $10 Incoming transfer", "  - $20 Outgoing U.S. transfer", "  - $60 Outgoing foreign transfer"], published: [] },
  { lines: ["Mortgage", " - $100 - HELOC Fee", " - $150 - Mortgage Subordination", " - $150 - Partial Release"], published: [["legal_process", 150.0, null, "Mortgage Subordination"]] },
  { lines: ["Fees", "• $3.00 each ATM/Debit transaction off premises", "• $2.00 Paper statement"], published: [] },
  { lines: ["Fees", "$5.00 - Statement Copy | $2.00 - Check Copy"], published: [["document_reproduction", 2.0, null, "Statement Copy"]] },
  { lines: ["Fees", "$5.00 - Statement Copy", "Overdraft Fee | $30.00"], published: [["overdraft", 30.0, null, "Overdraft Fee"]] },
  { lines: ["Personal", "$5.00 - Monthly Maintenance Fee", "Business", "$15.00 - Monthly Maintenance Fee"], published: [["monthly_maintenance", 5.0, "monthly", "Monthly Maintenance Fee"], ["monthly_maintenance", 15.0, "monthly", "Monthly Maintenance Fee"]] },
  { lines: ["Fees", "$3.00 - 3 free per month, then fee applies", "$2.00 - First 5 free"], published: [] },
  { lines: ["Fees", "$10 - $25 Wire Transfer", "$5 - 10 Copies"], published: [] },
  { lines: ["Fees", "$15.00 - Business Account Maintenance", "$5.00 - Personal Account Maintenance"], published: [] },
  { lines: ["ATM", "$2.00 - ATM Withdrawal (non-network)", "$1.00 - ATM Balance Inquiry"], published: [["atm_non_network", 1.0, null, "ATM"], ["atm_non_network", 2.0, null, "ATM"]] },
  { lines: ["Overdraft", "$500 - Overdraft Limit", "$35.00 - Overdraft Fee"], published: [["overdraft", 35.0, null, "Overdraft Fee"]] },
  { lines: ["Checks", "$1.50 - Per Check over 20", "$0.25 - Per page"], published: [] },
  { lines: ["Notary", "$10.00 - Non-Member Notary", "$0.00 - Member Notary"], published: [["notary_fee", 10.0, null, "Notary"]] },
  { lines: ["Fees", "$5.00 - MONTHLY FEE", "$30.00 - STOP PAYMENT FEE"], published: [["monthly_maintenance", 5.0, "monthly", "MONTHLY FEE"], ["stop_payment", 30.0, null, "STOP PAYMENT FEE"]] },
  { lines: ["Fees", "$5.00 - Each Additional Page", "$2.00 - Fax"], published: [] },
  { lines: ["Fees", "$5.00 - Statement Copy ($10.00 maximum)", "$2.00 - Check Copy"], published: [] },
  { lines: ["Fees", "$25.00 - Stop Payment, Annual Fee $10.00", "$3.00 - Check Copy"], published: [["stop_payment", 10.0, "annual", "Stop Payment, Annual Fee"]] },
  { lines: ["Fees", "$20.00 - Dormant Account (after 12 months; balance under $500)", "$5.00 - Returned Mail"], published: [] },
  { lines: ["Fees", "$30.00 - Overdraft Item Fee", "$5,000 - Overdraft Coverage Limit"], published: [["overdraft", 30.0, null, "Overdraft Item Fee"]] },
  { lines: ["Record Research", "$25.00 per hour ($5.00 minimum)", "Replace Lost Key", "$10.00 - If both keys are lost, the box must be drilled open at a cost determined at opening.", "Wire Transfers Customer (outgoing) - Foreign"], published: [["account_research", 25.0, "hourly", "Record Research"], ["safe_deposit_box", 10.0, null, "Replace Lost Key"]] },
  { lines: ["Replace Lost Key", "$10.00 - Both keys lost requires drilling"], published: [["safe_deposit_box", 10.0, null, "Replace Lost Key"]] },
  { lines: ["Stop Payment", "$30.00 - Charged when you request a stop"], published: [["stop_payment", 30.0, null, "Stop Payment"]] },
  { lines: ["Overdraft Fee", "$35.00 - You will be charged per item"], published: [["overdraft", 35.0, "per_item", "Overdraft Fee"]] },
  { lines: ["Stop Payment", "$30.00 - Each Request"], published: [["stop_payment", 30.0, "per_item", "Stop Payment"]] },
  { lines: ["Returned Item", "$25.00 - Per Item Returned", "Stop Payment", "$30.00 - Per Request"], published: [["nsf", 25.0, "per_item", "Returned Item"], ["stop_payment", 30.0, "per_item", "Stop Payment"]] },
  { lines: ["Paper Statement", "$3.00 - Waived With eStatements"], published: [["paper_statement", 3.0, null, "Paper Statement"]] },
  { lines: ["Overdraft Fee", "$32.00 - Maximum 3 Per Day"], published: [["overdraft", 32.0, "daily", "Overdraft Fee"]] },
  { lines: ["Fees", "$25.00 - Stop Payment", "Wire Transfer | $30.00", "$10.00 - Returned Mail"], published: [] },
  { lines: ["Business Fees", "$15.00 - Business Monthly Service Fee", "$0.25 - Per Deposited Item"], published: [] },
  { lines: ["Fees", "$5.00 - Overdraft Transfer (from savings)", "$25.00 - Overdraft Fee (per item; maximum $125 per day)"], published: [["overdraft", 25.0, "per_item", "Overdraft Fee (per item; maximum $125 per day)"]] },
];

const CHANGED_FROM_MAIN: Array<NearMiss & { main: Published[] }> = [
  { lines: ["Services", "$25.00 - Account Research (per hour)", "$15.00 - Statement Copy"], main: [], published: [["account_research", 25.0, "hourly", "Account Research (per hour)"], ["document_reproduction", 15.0, null, "Statement Copy"]] },
  { lines: ["Services", "$25.00 - NSF FEE", "$30.00 - STOP PAYMENT"], main: [["nsf", 25.0, null, "NSF FEE"]], published: [["nsf", 25.0, null, "NSF FEE"], ["stop_payment", 30.0, null, "STOP PAYMENT"]] },
  { lines: ["Checking Fees", "$25.00 - NSF Check/ACH/ATM item", "$20.00 - Stop Payment (single check)", "$35.00 - Stop Payment (range of checks)", "$10.00 - Debit Card Replacement"], main: [["stop_payment", 35.0, null, "Stop Payment (single check)"]], published: [["card_replacement", 10.0, null, "Debit Card Replacement"], ["nsf", 25.0, null, "NSF Check/ACH/ATM item"], ["stop_payment", 20.0, null, "Stop Payment (single check)"], ["stop_payment", 35.0, null, "Stop Payment (range of checks)"]] },
  { lines: ["Fees", "$5.00 – Paper Statement Fee", "$3.00 — Check Copy"], main: [["paper_statement", 5.0, null, "Paper Statement Fee"]], published: [["check_image", 3.0, null, "Check Copy"], ["paper_statement", 5.0, null, "Paper Statement Fee"]] },
  { lines: ["Fees", "$5.00 - Inactive Account (after 12 months)", "$10.00 - Dormant Account per quarter"], main: [], published: [["dormant_account", 5.0, null, "Inactive Account (after 12 months)"], ["dormant_account", 10.0, "quarterly", "Dormant Account per quarter"]] },
  { lines: ["Fees", "$35.00 - Daily Overdraft Fee", "$5.00 - Continuous Overdraft (after 5 days)"], main: [["continuous_od", 35.0, "daily", "Daily Overdraft Fee"]], published: [["continuous_od", 5.0, null, "Continuous Overdraft (after 5 days)"], ["continuous_od", 35.0, "daily", "Daily Overdraft Fee"]] },
  { lines: ["Fees", "$12.00 - Returned Mail (per month)", "$6.00 - Annual Card Fee"], main: [], published: [["returned_mail", 12.0, "monthly", "Returned Mail (per month)"]] },
  { lines: ["Fees", "$0.00 - Notary Service", "$0 - Incoming Wire"], main: [["notary_fee", 0.0, null, "Notary Service"]], published: [["notary_fee", 0.0, null, "Notary Service"], ["wire_domestic_incoming", 0.0, null, "Incoming Wire"]] },
  { lines: ["Fees", "$10.00 - Monthly Service Charge", "$5.00 - Paper Statement"], main: [["monthly_maintenance", 10.0, "monthly", "Monthly Service Charge"]], published: [["monthly_maintenance", 10.0, "monthly", "Monthly Service Charge"], ["paper_statement", 5.0, null, "Paper Statement"]] },
  { lines: ["Fees", "$30.00 - NSF", "$30.00 - Overdraft (per item, max 3 per day)"], main: [["nsf", 30.0, "per_item", "NSF"]], published: [["nsf", 30.0, null, "NSF"], ["overdraft", 30.0, "per_item", "Overdraft (per item, max 3 per day)"]] },
  { lines: ["Wires", "$25.00 - Wire Transfer (Outgoing)", "$15.00 - Wire Transfer (Incoming)"], main: [], published: [["wire_domestic_incoming", 15.0, null, "Wire Transfer (Incoming)"], ["wire_domestic_outgoing", 25.0, null, "Wire Transfer (Outgoing)"]] },
  { lines: ["Savings", "$5.00 - Excessive Withdrawal (over 6 per month)", "$3.00 - Counter Check"], main: [], published: [["counter_check", 3.0, null, "Counter Check"], ["excess_withdrawal", 5.0, null, "Excessive Withdrawal (over 6 per month)"]] },
  { lines: ["Fees", "Overdraft Fee $35.00", "$20.00 - Stop Payment", "$10.00 - Returned Mail"], main: [["overdraft", 35.0, null, "Overdraft Fee"]], published: [["overdraft", 35.0, null, "Overdraft Fee"], ["returned_mail", 10.0, null, "Returned Mail"], ["stop_payment", 20.0, null, "Stop Payment"]] },
  { lines: ["Fees", "$2.50 - ATM Fee (5 free per month)", "$1.00 - Balance Inquiry"], main: [["atm_non_network", 2.5, null, "ATM Fee (5 free per month)"]], published: [["atm_non_network", 1.0, null, "Balance Inquiry"], ["atm_non_network", 2.5, null, "ATM Fee (5 free per month)"]] },
  { lines: ["Fees", "$3.00 - ATM Withdrawal at non-network ATMs", "$0.00 - ATM Withdrawal at our ATMs"], main: [], published: [["atm_non_network", 3.0, null, "ATM Withdrawal at non-network ATMs"]] },
];

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
