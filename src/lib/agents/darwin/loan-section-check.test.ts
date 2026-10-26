import { describe, expect, it, vi } from "vitest";

import {
  LOAN_SECTION_CHECK,
  LOAN_SECTION_DOCUMENT_BATCH,
  LOAN_SECTION_TAKEDOWN_LIVE,
  LOAN_TEXT_SQL,
  findLoanSectionFees,
  loanSectionDetail,
  loanSectionFeesSql,
  recheckLoanSections,
} from "./loan-section-check";

const NAVY = "https://www.navyfederal.org/membership/fees-and-charges.html";

// Navy Federal's stored text 37160 (doc 39026), trimmed: checking rows, then the Equity Loan section.
const NAVY_TEXT = [
  "Checking Fees",
  "Fee | Amount",
  "Non-sufficient funds/NSF (item returned unpaid) | No charge",
  "Equity Loan",
  "Fee | Amount",
  "Home Equity Line Check returned (due to non-sufficient funds) | $29.00",
  "Returned loan payment | $29.00",
  "Tax Service Charge | $25.00",
  "Savings and MMSA Fees",
  "Fee | Amount",
  "Share Withdrawal Check (Cashier's Check - More than 2 checks per day) | $5.00 per check",
].join("\n\n");

const DOCUMENTS = [
  {
    source_document_id: "39026",
    document_url: ` ${NAVY} `,
    normalized_text: NAVY_TEXT,
    fees: [
      { fee_published_id: "154634", fee_verified_id: "202474", institution_id: "4956", fee_name: "Home Equity Line Check returned (due to non-sufficient funds)", amount: "29.00", canonical_fee_key: "nsf" },
      { fee_published_id: "154635", fee_verified_id: "202477", institution_id: "4956", fee_name: "Tax Service Charge", amount: "25.00", canonical_fee_key: "monthly_maintenance" },
      { fee_published_id: "122346", fee_verified_id: "202485", institution_id: "4956", fee_name: "Share Withdrawal Check (Cashier's Check - More than 2 checks per day)", amount: "5.00", canonical_fee_key: "monthly_maintenance" },
    ],
  },
  {
    source_document_id: "32073",
    document_url: "https://example.test/fees",
    normalized_text: ["Business Checking# | $24.95 per month", "Loans", "SERVICE | AMOUNT", "Returned Item | $30.00"].join("\n"),
    // The read's json_agg comes back as a string from some drivers.
    fees: JSON.stringify([
      { fee_published_id: "139498", fee_verified_id: "180100", institution_id: "7300", fee_name: "Returned Item", amount: "30.00", canonical_fee_key: "nsf" },
    ]),
  },
];

type DbMock = ReturnType<typeof vi.fn>;
function dbFor(documents: Array<Record<string, unknown>>, options: { cursor?: string | null; flags?: Array<Record<string, unknown>>; failRead?: boolean } = {}): DbMock {
  return vi.fn((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (text.includes("information_schema") || text.includes("to_regclass")) return Promise.resolve([{ ready: true, exists: true, present: true }]);
    if (text.includes("FROM pipeline_feedback")) return Promise.resolve(options.flags ?? []);
    if (text.includes("FROM agent_run_events")) return Promise.resolve(options.cursor == null ? [] : [{ next_after_id: options.cursor }]);
    if (text.includes("UPDATE published_fee_records")) return Promise.resolve([{ fee_published_id: "154634" }]);
    if (text.includes("WITH live AS")) return options.failRead ? Promise.reject(new Error("read failed")) : Promise.resolve(documents);
    return Promise.resolve([]);
  });
}
const asDb = (db: DbMock) => db as unknown as Parameters<typeof recheckLoanSections>[0];
const texts = (db: DbMock) => db.mock.calls.map(([strings]) => (strings as TemplateStringsArray).join("?"));

describe("the loan section switch (#1905)", () => {
  it("is a code constant and ships off until James's yes on the dry run", () => {
    expect(LOAN_SECTION_TAKEDOWN_LIVE).toBe(false);
  });

  it("reads texts through a plain alternation as wide as the heading words", () => {
    const pattern = new RegExp(LOAN_TEXT_SQL, "i");
    expect(LOAN_TEXT_SQL).not.toContain("\\n");
    for (const text of ["Equity Loan", "LOAN FEES", "Mortgage Loans", "HELOC", "Home Equity Line of Credit", "Private Education Line-of-Credit", "Credit Lines", "Lending"]) {
      expect(pattern.test(text)).toBe(true);
    }
  });
});

describe("findLoanSectionFees", () => {
  it("finds the deposit-category fees printed in a loan section, and only those", () => {
    const found = findLoanSectionFees(DOCUMENTS);
    expect(found.matches.map((match) => match.feePublishedId)).toEqual([139498, 154634, 154635]);
    expect(found.checked).toBe(4);
    expect(found.documents).toBe(2);
    expect(found.institutions).toBe(2);
    expect(found.byCategory).toEqual({ nsf: 2, monthly_maintenance: 1 });
    expect(found.matches.find((match) => match.feePublishedId === 154635)).toMatchObject({
      feeVerifiedId: 202477, sourceDocumentId: 39026, documentUrl: NAVY, reason: "loan_section: #39026",
    });
  });
});

describe("recheckLoanSections", () => {
  it("with the switch off reports, writes only its event, and moves the cursor", async () => {
    const db = dbFor(DOCUMENTS, { cursor: "100" });
    const result = await recheckLoanSections(asDb(db), { runId: 1, stepId: 2, dryRun: false });
    expect(result).toMatchObject({ live: false, matched: 3, flagged: 0, takenDown: [], afterId: 100, nextAfterId: 0 });
    const calls = texts(db);
    expect(calls.some((text) => text.includes("UPDATE published_fee_records"))).toBe(false);
    expect(calls.some((text) => text.includes("FROM pipeline_feedback"))).toBe(false);
    expect(calls.filter((text) => text.includes("INSERT INTO agent_run_events"))).toHaveLength(1);
  });

  it("continues after the last document of a full batch", async () => {
    const result = await recheckLoanSections(asDb(dbFor(DOCUMENTS)), { runId: 1, dryRun: false, limit: 2 });
    expect(result.nextAfterId).toBe(32073);
    expect(LOAN_SECTION_DOCUMENT_BATCH).toBeGreaterThan(2);
  });

  it("a dry run writes nothing, even with the switch on", async () => {
    const db = dbFor(DOCUMENTS);
    const result = await recheckLoanSections(asDb(db), { runId: 1, dryRun: true, live: true });
    expect(result.matched).toBe(3);
    expect(texts(db).some((text) => text.includes("INSERT") || text.includes("UPDATE"))).toBe(false);
  });

  it("switched on, a fee comes down only on its second look", async () => {
    const firstLook = new Date("2026-10-26T00:00:00Z");
    const flags = [{ fee_published_id: "154634", kind: "takedown_pending", evidence: { run_id: 1, flagged_at: firstLook.toISOString(), reason: "loan_section: #39026" } }];
    const db = dbFor(DOCUMENTS, { flags });
    const result = await recheckLoanSections(asDb(db), { runId: 2, dryRun: false, live: true, now: new Date("2026-10-26T13:00:00Z") });
    expect(result.takenDown).toEqual([154634]);
    const calls = texts(db);
    expect(calls.some((text) => text.includes("UPDATE verified_fee_observations"))).toBe(true);
    expect(calls.some((text) => text.includes("darwin.loan_section_takedown"))).toBe(true);
  });

  it("a scoped run leaves the cursor alone, and a failed read reports nothing", async () => {
    const scoped = await recheckLoanSections(asDb(dbFor(DOCUMENTS, { cursor: "500" })), { runId: 1, dryRun: false, institutionId: 4956 });
    expect(scoped).toMatchObject({ scoped: true, afterId: 0 });
    expect(loanSectionDetail(scoped).next_after_id).toBeNull();
    const failed = await recheckLoanSections(asDb(dbFor(DOCUMENTS, { failRead: true })), { runId: 1, dryRun: false });
    expect(failed.matched).toBe(0);
  });

  it("names its check on the ledger", () => {
    expect(LOAN_SECTION_CHECK).toBe("darwin.loan_section");
  });
});

describe("loanSectionFeesSql", () => {
  it("reads only the deposit categories, within optional document bounds", () => {
    const text = loanSectionFeesSql({ fromDocumentId: 1, toDocumentId: 15000 });
    expect(text).toContain("'monthly_maintenance'");
    expect(text).toContain("'nsf'");
    expect(text).not.toContain("'stop_payment'");
    expect(text).toContain("fr.source_document_id >= 1 AND fr.source_document_id <= 15000");
    expect(loanSectionFeesSql()).not.toContain("fr.source_document_id <=");
  });
});
