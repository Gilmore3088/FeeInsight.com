import { describe, expect, it, vi } from "vitest";

import {
  CARD_PROGRAM_SECTION_CHECK,
  CARD_PROGRAM_SECTION_TAKEDOWN_LIVE,
  CARD_PROGRAM_TEXT_SQL,
  cardProgramSectionDetail,
  cardProgramSectionFeesSql,
  findCardProgramSectionFees,
  recheckCardProgramSections,
} from "./card-program-section-check";

const NAVY = "https://www.navyfederal.org/membership/fees-and-charges.html";
const PACU = "https://www.pacu.com/rates-fee-schedule/";

// Navy Federal's stored text 37160 (doc 39026), trimmed: the Visa Gift Card and GO Prepaid sections.
const NAVY_TEXT = [
  "ATM Fees",
  "Transfer | None | None | $1.00 | Not applicable | Not applicable",
  "Prepaid and Gift Cards",
  "Visa® Gift Cards",
  "Fee | Amount",
  "Card Purchase Charge | $0",
  "Lost/Stolen Card | $5.00",
  "GO Prepaid Cards",
  "Fee | Amount",
  "Visa/PLUS Network ATM domestic and foreign cash withdrawal and balance inquiry (The terminal owner may charge additional fees and “surcharges” for ATM transactions.) | $1.00 per transaction",
  "Lost/Stolen Card | $5.00",
].join("\n\n");
// Piedmont Advantage CU (doc 34892): live 148100 "Card Replacement" $5 is the gift card's.
const PACU_TEXT = ["Gift Card", "Card Inactivity Fee (No activity within 12 months) | $2.50", "Card Replacement | $5.00", "Plastic Card Replacement (Debit) | $20.00 / card"].join("\n");

const DOCUMENTS = [
  {
    source_document_id: "39026",
    document_url: ` ${NAVY} `,
    normalized_text: NAVY_TEXT,
    fees: [
      { fee_published_id: "157276", fee_verified_id: "180001", institution_id: "4956", fee_name: "Lost/Stolen Card", amount: "5.00", canonical_fee_key: "card_replacement" },
      { fee_published_id: "157277", fee_verified_id: "180002", institution_id: "4956", fee_name: "Visa/PLUS Network ATM domestic and foreign cash withdrawal and balance inquiry", amount: "1.00", canonical_fee_key: "atm_non_network" },
      { fee_published_id: "145758", fee_verified_id: "170000", institution_id: "4956", fee_name: "Transfer", amount: "1.00", canonical_fee_key: "atm_non_network" },
      { fee_published_id: "157278", fee_verified_id: null, institution_id: "4956", fee_name: "Card Purchase Charge", amount: "0", canonical_fee_key: "gift_card_purchase" },
    ],
  },
  {
    source_document_id: "34892",
    document_url: PACU,
    normalized_text: PACU_TEXT,
    // The read's json_agg comes back as a string from some drivers.
    fees: JSON.stringify([
      { fee_published_id: "148100", fee_verified_id: "170100", institution_id: "7076", fee_name: "Card Replacement", amount: "5.00", canonical_fee_key: "card_replacement" },
      { fee_published_id: "148101", fee_verified_id: "170101", institution_id: "7076", fee_name: "Plastic Card Replacement (Debit)", amount: "20.00", canonical_fee_key: "card_replacement" },
    ]),
  },
];

type DbMock = ReturnType<typeof vi.fn>;
function dbFor(documents: Array<Record<string, unknown>>, options: { lastReadAt?: Date | null; flags?: Array<Record<string, unknown>>; failRead?: boolean } = {}): DbMock {
  return vi.fn((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (text.includes("information_schema") || text.includes("to_regclass")) return Promise.resolve([{ ready: true, exists: true, present: true }]);
    if (text.includes("FROM pipeline_feedback")) return Promise.resolve(options.flags ?? []);
    if (text.includes("FROM agent_run_events")) return Promise.resolve(options.lastReadAt ? [{ created_at: options.lastReadAt }] : []);
    if (text.includes("UPDATE published_fee_records")) return Promise.resolve([{ fee_published_id: "157276" }]);
    if (text.includes("WITH live AS")) return options.failRead ? Promise.reject(new Error("read failed")) : Promise.resolve(documents);
    return Promise.resolve([]);
  });
}
const asDb = (db: DbMock) => db as unknown as Parameters<typeof recheckCardProgramSections>[0];
const texts = (db: DbMock) => db.mock.calls.map(([strings]) => (strings as TemplateStringsArray).join("?"));

describe("the card program section switch (#1908)", () => {
  it("is a code constant, not an env var, and is on since James approved the takedown (2026-10-25)", () => {
    expect(CARD_PROGRAM_SECTION_TAKEDOWN_LIVE).toBe(true);
  });

  it("reads texts through a plain alternation as wide as the card words", () => {
    const pattern = new RegExp(CARD_PROGRAM_TEXT_SQL, "i");
    expect(CARD_PROGRAM_TEXT_SQL).not.toContain("\\n");
    for (const text of ["GO Prepaid Cards", "Pre-Paid", "Pre‐paid card", "PAYROLL CARD", "Visa Gift-Card", "Travel  Card", "TravelMoney", "Reloadable"]) {
      expect(pattern.test(text)).toBe(true);
    }
    expect(pattern.test("Debit Card Fees")).toBe(false);
  });
});

describe("findCardProgramSectionFees (#1908, #1905)", () => {
  it("lists the card section's fees, keeps the purchase price and the account's fees", () => {
    const found = findCardProgramSectionFees(DOCUMENTS);
    expect(found.matches.map((fee) => [fee.feePublishedId, fee.reason])).toEqual([
      [148100, "card_program_section: #34892"],
      [157276, "card_program_section: #39026"],
      [157277, "card_program_section: #39026"],
    ]);
    expect(found).toMatchObject({ checked: 6, documentsRead: 2, matched: 3, keptCardPurchase: 1, documents: 2, institutions: 2 });
    expect(found.matches[1].documentUrl).toBe(NAVY);
  });
});

describe("recheckCardProgramSections (#1908)", () => {
  it("is on by default: the first look flags and takes nothing down", async () => {
    const db = dbFor(DOCUMENTS);
    const result = await recheckCardProgramSections(asDb(db), { runId: 7, stepId: 70, dryRun: false });
    expect(result).toMatchObject({ live: true, matched: 3, flagged: 3, takenDown: [], truncated: false });
    expect(cardProgramSectionDetail(result)).toMatchObject({ switch_live: true, truncated: false });
  });

  it("with live: false, reports and writes no flag or takedown", async () => {
    const db = dbFor(DOCUMENTS);
    const result = await recheckCardProgramSections(asDb(db), { runId: 7, stepId: 70, dryRun: false, live: false });
    expect(result).toMatchObject({ live: false, matched: 3, flagged: 0, takenDown: [] });
    expect(texts(db).some((text) => text.includes("UPDATE published_fee_records"))).toBe(false);
    expect(texts(db).some((text) => text.includes("pipeline_feedback") && text.includes("INSERT"))).toBe(false);
    expect(texts(db).some((text) => text.includes("INSERT INTO agent_run_events"))).toBe(true);
    expect(cardProgramSectionDetail(result)).toMatchObject({ check: CARD_PROGRAM_SECTION_CHECK, switch_live: false, matched: 3, kept_card_purchase: 1 });
  });

  it("switched on, flags first and takes a fee down on its second look", async () => {
    const first = dbFor(DOCUMENTS);
    expect(await recheckCardProgramSections(asDb(first), { runId: 7, dryRun: false, live: true })).toMatchObject({ live: true, flagged: 3, takenDown: [] });

    const flaggedAt = new Date("2026-10-25T00:00:00Z");
    const db = dbFor([DOCUMENTS[0]], {
      flags: [{ fee_published_id: "157276", kind: "takedown_pending", evidence: { flag_run_id: 3, flagged_at: flaggedAt.toISOString(), reason: "card_program_section: #39026" } }],
    });
    const result = await recheckCardProgramSections(asDb(db), { runId: 9, dryRun: false, live: true, now: new Date("2026-10-25T13:00:00Z") });
    expect(result.takenDown).toEqual([157276]);
    expect(texts(db).find((text) => text.includes("UPDATE published_fee_records"))).toContain("rolled_back_reason = v.reason");
    expect(texts(db).some((text) => text.includes("UPDATE verified_fee_observations"))).toBe(true);
  });

  it("reads at most hourly unless scoped, writes nothing in a dry run, and survives a failed read", async () => {
    const now = new Date("2026-10-25T02:00:00Z");
    const recent = dbFor(DOCUMENTS, { lastReadAt: new Date("2026-10-25T01:30:00Z") });
    expect(await recheckCardProgramSections(asDb(recent), { runId: 1, dryRun: false, now })).toMatchObject({ skipped: true, matched: 0 });
    const scoped = dbFor(DOCUMENTS, { lastReadAt: new Date("2026-10-25T01:30:00Z") });
    expect((await recheckCardProgramSections(asDb(scoped), { runId: 1, dryRun: false, now, institutionId: 4956 })).matched).toBe(3);

    const dry = dbFor(DOCUMENTS);
    expect((await recheckCardProgramSections(asDb(dry), { runId: 1, dryRun: true, live: true })).matched).toBe(3);
    expect(texts(dry).some((text) => /INSERT|UPDATE/.test(text))).toBe(false);

    const failed = dbFor(DOCUMENTS, { failRead: true });
    expect(await recheckCardProgramSections(asDb(failed), { runId: 1, dryRun: false })).toMatchObject({ matched: 0, takenDown: [] });
  });

  it("says when the read hit its document limit, and reads newest texts first", async () => {
    const db = dbFor(DOCUMENTS);
    const result = await recheckCardProgramSections(asDb(db), { runId: 1, dryRun: true, limit: 2 });
    expect(result).toMatchObject({ documentsRead: 2, truncated: true });
    expect(cardProgramSectionDetail(result)).toMatchObject({ truncated: true });
    const read = texts(db).find((text) => text.includes("WITH live AS")) ?? "";
    expect(read).toContain("docs AS MATERIALIZED");
    expect(read).toContain("ORDER BY ast.updated_at DESC NULLS LAST, ast.source_document_id DESC");
    expect(read).toContain("GROUP BY docs.source_document_id");
    expect(read).not.toContain("LATERAL");
  });

  it("gives a read-only dry-run statement over the whole live table", () => {
    const sql = cardProgramSectionFeesSql();
    expect(sql).not.toMatch(/\b(?:UPDATE|INSERT|DELETE)\b/);
    expect(sql).toContain("fp.rolled_back_at IS NULL AND fp.quarantined_at IS NULL");
    expect(sql).toContain("h.k - h.head_k <= 20");
    expect(sql).toContain("'kept_card_purchase' ELSE 'card_program_section'");
  });
});
