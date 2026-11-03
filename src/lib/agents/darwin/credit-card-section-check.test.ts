// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  CARD_STATEMENT_NAME_SQL,
  CREDIT_CARD_SECTION_CHECK_VERSION,
  CREDIT_CARD_SECTION_TAKEDOWN_LIVE,
  CREDIT_CARD_TEXT_SQL,
  creditCardSectionDetail,
  findCreditCardSectionFees,
  recheckCreditCardSectionFees,
  type CreditCardSectionLiveRow,
} from "@/lib/agents/darwin/credit-card-section-check";

/** Greylock FCU (doc 20487, live 73521): the right column's credit card section, after the left column's debit card row. */
const GREYLOCK = [
  "ATM/Debit Card Replacement (1st replacement free)....... $5.00 | Uncollected Funds ..................................................... $15.00",
  "Inactive Membership ....................................................... $10.00",
  "(annually, after one year of inactivity) | CREDIT CARD CHARGES",
  "International Transaction Fee……………………………. up to 1% | Account Research ....................... $30.00/hour, minimum 1 hour",
  "This fee applies to any debit card or credit card transaction | Balance Transfer ............................. 3% of the Transfer Amount",
  "action from within the United States. | Card Replacement ............................................................. Free",
  "Legal Research/Processing | Card Replacement (Emergency/Rush Delivery) .............. $35.00",
  "Account research (per hour) ...................................... $30.00 | Cash Advance ............................... 2% of the Advance Amount",
].join("\n");
/** A credit card section, then the bank's own debit card fees under a numbered heading. */
const NUMBERED = ["VISA CREDIT CARD", "Late Payment | $25.00", "Card Replacement | $10.00", "2. Debit Card Fees", "Card Replacement | $5.00"].join("\n");

const TEXTS = new Map<number, string>([[20487, GREYLOCK], [500, NUMBERED]]);

const row = (id: number, artifact: number | null, key: string, name: string, amount: number, line: string | null): CreditCardSectionLiveRow => ({
  fee_published_id: id, fee_verified_id: id + 1000, institution_id: artifact === 500 ? 9 : 6842, fee_name: name, amount, canonical_fee_key: key,
  source_line: line == null ? "Knox deterministic extraction." : `Knox deterministic extraction from Rosetta artifact #${artifact}. canonical_hint=${key}; excerpt="${line}"`, artifact_id: artifact,
});

const ROWS: CreditCardSectionLiveRow[] = [
  row(73521, 20487, "rush_card", "Card Replacement (Emergency/Rush Delivery)", 35, "Legal Research/Processing | Card Replacement (Emergency/Rush Delivery) .............. $35.00"),
  // The bank's own debit card replacement, on the same page: kept.
  row(73522, 20487, "card_replacement", "ATM/Debit Card Replacement (1st replacement free)", 5, "ATM/Debit Card Replacement (1st replacement free)....... $5.00"),
  row(600, 500, "card_replacement", "Card Replacement", 10, "Card Replacement | $10.00"),
  // Under "2. Debit Card Fees": the debit card's, kept.
  row(601, 500, "card_replacement", "Card Replacement", 5, "Card Replacement | $5.00"),
  // A text that is gone, and a note with no line: not judged.
  row(602, null, "card_replacement", "Card Replacement", 5, "Card Replacement | $5.00"),
  row(603, 500, "card_replacement", "Card Replacement", 10, null),
];

function fakeDb(calls: string[]) {
  return ((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    calls.push(text);
    if (text.includes("published_fee_records fp") && text.includes("SELECT")) return Promise.resolve(ROWS);
    if (text.includes("FROM agent_source_texts WHERE id = ANY")) return Promise.resolve([...TEXTS].map(([id, normalized_text]) => ({ id, normalized_text })));
    return Promise.resolve([]);
  }) as unknown as Parameters<typeof recheckCreditCardSectionFees>[0];
}

describe("Darwin's credit card section re-check (Knox v175, live 73521)", () => {
  it("is off by default", () => {
    expect(CREDIT_CARD_SECTION_TAKEDOWN_LIVE).toBe(false);
  });

  it("takes the credit card section's replacements and keeps the debit card's", () => {
    const found = findCreditCardSectionFees(ROWS, TEXTS);
    expect(found.matches.map((fee) => fee.feePublishedId)).toEqual([600, 73521]);
    expect(found.checked).toBe(6);
    expect(found.noText).toBe(2);
    expect(found.documents).toBe(2);
    expect(found.matches.find((fee) => fee.feePublishedId === 73521)?.reason).toBe('credit_card_section: "Card Replacement (Emergency/Rush Delivery)" #20487');
  });

  it("reads only texts that name a credit card", () => {
    const named = new RegExp(CREDIT_CARD_TEXT_SQL, "i");
    expect(named.test(GREYLOCK)).toBe(true);
    expect(named.test("Debit Card Replacement | $5.00")).toBe(false);
  });

  it("reports and writes nothing with the switch off", async () => {
    const calls: string[] = [];
    const result = await recheckCreditCardSectionFees(fakeDb(calls), { runId: 1, stepId: 2, dryRun: false });
    expect(result.live).toBe(false);
    expect(result.matched).toBe(2);
    expect(result.takenDown).toEqual([]);
    expect(calls.some((call) => /UPDATE|pipeline_feedback|second_look/i.test(call))).toBe(false);
    expect(calls.filter((call) => call.includes("INSERT INTO agent_run_events"))).toHaveLength(1);
    expect(creditCardSectionDetail(result)).toMatchObject({ check: "darwin.credit_card_section", switch_live: false, matched: 2, taken_down: [] });
  });

  it("writes nothing on a dry run, even switched on", async () => {
    const calls: string[] = [];
    const result = await recheckCreditCardSectionFees(fakeDb(calls), { runId: 1, dryRun: true, live: true });
    expect(result.matched).toBe(2);
    expect(calls.some((call) => /UPDATE|INSERT/.test(call))).toBe(false);
  });
});

describe("Darwin's credit card statement re-check (v2, Knox v176, USF FCU)", () => {
  // USF FCU (doc 42298): the card's statement fee under "Loans*", and the deposit fee it stood in for.
  const STATEMENTS: CreditCardSectionLiveRow[] = [
    row(700, 42298, "paper_statement", "Visa Monthly Paper Statement Fee", 1.25, "Visa Monthly Paper Statement Fee | $1.25"),
    row(701, 42298, "paper_statement", "Monthly Paper Statement Fee (eStatements are free)", 3, null),
    // A deposit statement fee that only excludes card statements: kept (live 43451's form).
    row(702, 42298, "paper_statement", "Paper Statement Fee (excludes Visa statements)", 2, null),
    // The rule reads the name alone: no stored line and no text is needed, only the artifact.
    row(703, 42299, "paper_statement", "Credit Card Paper Statements", 2, null),
    row(704, null, "paper_statement", "Visa Paper Statement", 1, null),
  ];

  it("is version 2", () => {
    expect(CREDIT_CARD_SECTION_CHECK_VERSION).toBe(2);
  });

  it("takes a paper statement fee its own name gives to a credit card and keeps the deposit ones", () => {
    const found = findCreditCardSectionFees(STATEMENTS, new Map());
    expect(found.matches.map((fee) => fee.feePublishedId)).toEqual([700, 703]);
    expect(found.noText).toBe(1);
    expect(found.matches[0]?.reason).toBe('credit_card_section: "Visa Monthly Paper Statement Fee" #42298');
  });

  it("pre-filters names that open with a card", () => {
    const named = new RegExp(CARD_STATEMENT_NAME_SQL, "i");
    expect(named.test("Visa Monthly Paper Statement Fee")).toBe(true);
    expect(named.test("Credit Card Paper Statements")).toBe(true);
    expect(named.test("Paper Statement Fee (excludes Visa statements)")).toBe(false);
  });
});
