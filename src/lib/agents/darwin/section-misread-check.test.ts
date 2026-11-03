// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  findSectionMisreads,
  FRONT_MATTER_NAME_SQL,
  recheckSectionMisreads,
  SECTION_MISREAD_TAKEDOWN_LIVE,
  sectionMisreadDetail,
  WAIVER_ADVICE_NAME_SQL,
  WIRE_SUBSCRIPTION_NAME_SQL,
  RETURNED_ITEM_SERVICE_NAME_SQL,
  ACCOUNTLESS_MONTHLY_LINE_SQL,
  storedLineMisreadKind,
  STORED_LINE_SQL,
  AUDIENCE_TEXT_SQL,
  type SectionMisreadRow,
} from "@/lib/agents/darwin/section-misread-check";

/** Knox v177 (backlog dry run 8): live rows the Nov 3 dry run read, by their published names. */
const IRA_TEXT = "Late Fee (6 days or more past due) Up to $35.00\nINDIVIDUAL RETIREMENT ACCOUNT (IRA) FEES\nAccount Closure Fee $25.00\nLOAN FEES";
const OTHER_TEXT = "IRA ACCOUNT FEES\n\nTransfer/Rollover/Premature Closing | $25.00/Item\n\nOTHER SERVICE FEES\n\nAccount Closure | $5.00 if closed within 90 days";

const TEXTS = new Map<number, string>([[2504, IRA_TEXT], [22731, OTHER_TEXT]]);

const row = (id: number, artifact: number | null, key: string, name: string, amount: number): SectionMisreadRow => ({
  fee_published_id: id, fee_verified_id: id + 1000, institution_id: 7534, fee_name: name, amount, canonical_fee_key: key, artifact_id: artifact,
});

const ROWS: SectionMisreadRow[] = [
  row(77750, 1, "bill_pay", "Use Online BillPay, HonorPay or Account-To-Account Transfers: Verification of Deposits", 25),
  row(68504, 1, "bill_pay", "Use Online BillPay or Account-To-Account Transfers: Gift Card", 3),
  // The right fee under a long name (Honor's 18786): stays.
  row(18786, 1, "account_verification", "Use Online BillPay, HonorPay or Account-To-Account Transfers Verification of Deposits", 25),
  row(167014, 1, "account_research", "meta-fb:pages: meta-generator: WordPress 7.1.4 meta-msapplication-TileImage: https://www.citizensbankal.com/wp-content/u", 30),
  row(152355, 1, "wire_intl_outgoing", "International Wire Module", 20),
  // A wire sent through a module: stays.
  row(43406, 1, "wire_domestic_outgoing", "Outgoing Domestic Wire through Wire Module", 10),
  // A service's own name: stays.
  row(60146, 1, "atm_non_network", "Use of Foreign ATM", 2),
  row(94053, 2504, "early_closure", "Account Closure Fee", 25),
  // Under "OTHER SERVICE FEES", after the IRA section: stays.
  row(160187, 22731, "early_closure", "Account Closure", 5),
  // Its text is gone: not judged.
  row(99999, 404, "early_closure", "Account Closure Fee", 25),
];

function fakeDb(calls: string[]) {
  return ((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    calls.push(text);
    if (text.includes("published_fee_records fp") && text.includes("SELECT")) return Promise.resolve(ROWS);
    if (text.includes("FROM agent_source_texts WHERE id = ANY")) return Promise.resolve([...TEXTS].map(([id, normalized_text]) => ({ id, normalized_text })));
    return Promise.resolve([]);
  }) as unknown as Parameters<typeof recheckSectionMisreads>[0];
}

describe("Darwin's section misread re-check (Knox v177)", () => {
  it("is off by default", () => {
    expect(SECTION_MISREAD_TAKEDOWN_LIVE).toBe(false);
  });

  it("matches the waiver column names, the front-matter name, the wire module and the IRA closing, and keeps the rest", () => {
    const found = findSectionMisreads(ROWS, TEXTS);
    expect(found.matches.map((fee) => [fee.feePublishedId, fee.kind])).toEqual([
      [68504, "waiver_column_name"],
      [77750, "waiver_column_name"],
      [94053, "ira_section_closing"],
      [152355, "wire_subscription"],
      [167014, "front_matter_name"],
    ]);
    expect(found.checked).toBe(10);
    expect(found.noText).toBe(1);
    expect(found.byKind).toEqual({ waiver_column_name: 2, front_matter_name: 1, wire_subscription: 1, ira_section_closing: 1, returned_item_service: 0, accountless_monthly_sentence: 0, zero_not_printed: 0, audience_section_untagged: 0 });
    expect(found.matches[1].reason).toBe('waiver_column_name: "Verification of Deposits is account_verification, not bill_pay"');
  });

  it("keeps a wire's price that names its sender's package or module, and a single service's advice (review of #2973)", () => {
    const kept = [
      row(5, 1, "atm_non_network", "Use Non-Network ATM or Foreign ATM", 2.5),
      row(1, 1, "wire_domestic_outgoing", "Outgoing domestic wire, Business Package", 20),
      row(2, 1, "wire_intl_outgoing", "Outgoing international wire – Treasury Module", 45),
      row(3, 1, "atm_non_network", "Use Non-Network ATM", 2.5),
      row(4, 1, "paper_statement", "Switch to paper statements", 5),
    ];
    expect(findSectionMisreads(kept, TEXTS).matches).toEqual([]);
  });

  it("version 2 (Knox v178): matches a returned item's handling service filed NSF and a reward bullet's monthly fee", () => {
    const rows: SectionMisreadRow[] = [
      row(21594, 1, "nsf", "Returned Item Special Handling Item", 10),
      // Says NSF in so many words: the NSF fee (108799).
      row(108799, 1, "nsf", "Non-Sufficient Funds (NSF)/Special Handling", 25),
      { ...row(117986, 1, "monthly_maintenance", "Monthly maintenance fee", 10), source_line: 'rules read; artifact #1; excerpt="Waived $10 monthly maintenance fee"' },
      { ...row(5, 1, "monthly_maintenance", "Monthly maintenance fee", 10), source_line: 'excerpt="Monthly maintenance fee | $10.00"' },
      // The same bullet on a page that prints the fee as a row at that price, or under an account heading: kept.
      { ...row(6, 2, "monthly_maintenance", "Monthly maintenance fee", 10), source_line: 'excerpt="Waived $10 monthly maintenance fee"' },
      { ...row(7, 3, "monthly_maintenance", "Monthly service charge", 10), source_line: 'excerpt="Your $10 monthly service charge can be avoided with direct deposit."' },
      // Its text is gone: not judged.
      { ...row(8, 4, "monthly_maintenance", "Monthly maintenance fee", 10), source_line: 'excerpt="Waived $10 monthly maintenance fee"' },
    ];
    const texts = new Map([
      [1, "Earn these rewards each month:\nWaived $10 monthly maintenance fee\nRefunded ATM fees"],
      [2, "Rewards\nWaived $10 monthly maintenance fee\nPremier Checking\nMonthly maintenance fee | $10.00"],
      [3, "Premier Checking\nYour $10 monthly service charge can be avoided with direct deposit."],
    ]);
    const found = findSectionMisreads(rows, texts);
    expect(found.matches.map((fee) => [fee.feePublishedId, fee.kind])).toEqual([[21594, "returned_item_service"], [117986, "accountless_monthly_sentence"]]);
    expect(found.noText).toBe(1);
    expect(new RegExp(RETURNED_ITEM_SERVICE_NAME_SQL, "i").test("Returned Item Special Handling Item")).toBe(true);
    expect(new RegExp(ACCOUNTLESS_MONTHLY_LINE_SQL, "i").test('excerpt="Waived $10 monthly maintenance fee"')).toBe(true);
  });

  it("version 3 (Knox v179): matches a live $0 whose line prints no free price, judged on its text", () => {
    const rows: SectionMisreadRow[] = [
      // North State Bank's waiver footnote, read as a free monthly fee.
      { ...row(1, 11, "monthly_maintenance", "Monthly maintenance fee", 0), source_line: 'excerpt="4 Monthly maintenance fee waived when minimum account balance requirement is met."' },
      // Live 141225: a $0 offered against a price.
      { ...row(141225, 12, "monthly_maintenance", "Monthly Maintenance Fee", 0), source_line: 'excerpt="Monthly Maintenance Fee: $0 or $4.95"' },
      // Live 36427: the unit line under a bare "$0" cell on a stacked page: kept.
      { ...row(36427, 13, "od_protection_transfer", "Overdraft Protection transfers or advances", 0), source_line: 'excerpt="per transfer/advance from your eligible linked savings account or credit card or line of credit"' },
      // Prints its free price: kept.
      { ...row(4, 11, "document_reproduction", "Fax Service", 0), source_line: 'excerpt="Fax Service | FREE"' },
      { ...row(142558, 11, "monthly_maintenance", "Monthly service fee", 0), source_line: 'excerpt="Enjoy all these benefits without any monthly service fees."' },
      // A cut line (its dot leader, the price past the cut) and a missing line: not judged.
      { ...row(6, 11, "notary_fee", "Notary Fee", 0), source_line: 'excerpt="Notary Fee............................"' },
      { ...row(7, 11, "notary_fee", "Notary Fee", 0), source_line: null },
      // Its text is gone: not judged.
      { ...row(8, 404, "monthly_maintenance", "Monthly maintenance fee", 0), source_line: 'excerpt="Monthly maintenance fee waived with direct deposit."' },
      // Live 140028 and 134219: an unconditional waiver on a card's perk list prints the free price: kept.
      { ...row(140028, 14, "atm_non_network", "Waived Non-QCBT ATM Transactions", 0), source_line: 'excerpt="Waived Non-QCBT ATM Transactions"' },
      { ...row(134219, 15, "ira_annual", "Waived Annual IRA Fee", 0), source_line: 'excerpt="Waived Annual IRA Fee"' },
      // A perk's label above is no price cell: matched.
      { ...row(9, 16, "statement_copy", "Statement copies", 0), source_line: 'excerpt="Statement copies by mail on request"' },
    ];
    const texts = new Map([
      [11, "Footnotes\n4 Monthly maintenance fee waived when minimum account balance requirement is met."],
      [12, "Freedom\nMonthly Maintenance Fee: $0 or $4.95\nMinimum Daily Balance (To Avoid Monthly Maintenance Fee): $500"],
      [13, "Overdraft Protection transfers or advances\n\n$0\n\nper transfer/advance from your eligible linked savings account or credit card or line of credit"],
      [14, "Visa® Debit Card\nWaived Non-QCBT ATM Transactions"],
      [15, "IRA Benefits\nFree eStatements\nWaived Annual IRA Fee"],
      [16, "Rewards\nFree eStatements\nStatement copies by mail on request"],
    ]);
    const found = findSectionMisreads(rows, texts);
    expect(found.matches.map((fee) => [fee.feePublishedId, fee.kind])).toEqual([[1, "zero_not_printed"], [9, "zero_not_printed"], [141225, "zero_not_printed"]]);
    expect(found.cut).toBe(2);
    expect(found.noText).toBe(1);
    expect(storedLineMisreadKind('excerpt="Fax Service | $1 per page"', 1)).toBeNull();
    expect(new RegExp(STORED_LINE_SQL).test('artifact #1; excerpt="x"')).toBe(true);
  });

  it("version 3 (Knox v179): matches an audience section's untagged row whose name the bank prices otherwise", () => {
    const midwest = "Replacement of Lost Key - Safe Box Key Fee | $20\n\nSenior Perks (60 & Over)\n\nCopy of a Check | FREE\n\nFax Service | FREE\n\nFees effective as of 10/01/2025.";
    const rows: SectionMisreadRow[] = [
      { ...row(137483, 27658, "document_reproduction", "Fax Service", 0), source_line: 'excerpt="Fax Service | FREE"', audience_candidate: true },
      // The general row itself: no section over it, kept.
      { ...row(162230, 27658, "document_reproduction", "Replacement of Lost Key - Safe Box Key Fee", 20), source_line: 'excerpt="Replacement of Lost Key - Safe Box Key Fee | $20"', audience_candidate: true },
      // Under the heading, but the bank prices its name only once (no candidate): kept.
      { ...row(137448, 27658, "check_image", "Copy of a Check", 1), source_line: 'excerpt="Copy of a Check | FREE"', audience_candidate: false },
    ];
    const found = findSectionMisreads(rows, new Map([[27658, midwest]]));
    expect(found.matches.map((fee) => [fee.feePublishedId, fee.kind])).toEqual([[137483, "audience_section_untagged"]]);
    expect(found.matches[0].reason).toContain("Senior Perks (60 & Over)");
    expect(new RegExp(AUDIENCE_TEXT_SQL, "i").test("Senior Perks (60 & Over)")).toBe(true);
    expect(new RegExp(AUDIENCE_TEXT_SQL, "i").test("Members 18 years and under")).toBe(true);
  });

  it("selects the rows by Postgres pre-filters wide enough for each rule", () => {
    expect(new RegExp(WAIVER_ADVICE_NAME_SQL, "i").test(ROWS[0].fee_name ?? "")).toBe(true);
    expect(new RegExp(FRONT_MATTER_NAME_SQL, "i").test(ROWS[3].fee_name ?? "")).toBe(true);
    expect(new RegExp(WIRE_SUBSCRIPTION_NAME_SQL, "i").test("International Wire Module")).toBe(true);
  });

  it("reports and writes nothing with the switch off", async () => {
    const calls: string[] = [];
    const result = await recheckSectionMisreads(fakeDb(calls), { runId: 1, stepId: 2, dryRun: false });
    expect(result.live).toBe(false);
    expect(result.matched).toBe(5);
    expect(result.takenDown).toEqual([]);
    expect(calls.some((call) => /UPDATE|second_look/i.test(call))).toBe(false);
    expect(calls.filter((call) => call.includes("INSERT INTO agent_run_events"))).toHaveLength(1);
    expect(sectionMisreadDetail(result)).toMatchObject({ check: "darwin.section_misread", switch_live: false, matched: 5, taken_down: [] });
  });

  it("writes nothing on a dry run, even switched on", async () => {
    const calls: string[] = [];
    const result = await recheckSectionMisreads(fakeDb(calls), { runId: 1, dryRun: true, live: true });
    expect(result.matched).toBe(5);
    expect(calls.some((call) => /UPDATE|INSERT/.test(call))).toBe(false);
  });
});
