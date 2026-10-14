import { describe, expect, it, vi } from "vitest";

import { crossPageConflicts, namesProduct, newerDocument, productHeadings, retireCrossPageConflicts, sameDocumentEdition, type CrossPageRow } from "./cross-page-conflict";

// Citizens Bank of TN (551), stored texts of doc 13386 (compare page) and doc 20941 (account PDF).
const comparePage = [
  "Compare Accounts", "", "Checking accounts are not one-size fits-all.", "", "Let us help find an account that fits your needs!", "",
  "Cash Back Checking", "", "Earn Cash Back on your purchases and get refunded ATM fees by using your debit card!", "",
  "$5 paper statement fee is waived if enrolled in eStatements", "", "Cash Back Checking Details", "", "Basic Checking",
].join("\n");
const accountPdf = [
  "• $8 per month", "Cash Back Checking", "• Online banking, including Zelle and Insights, E-statements, mobile banking, Mobile Remote",
  "Deposit & Bill Pay", "• Qualifiers/Rewards are:", "o 12 debit card swipes during a calendar month to receive 2% cash back, up to $6",
  "• When qualifiers are not met:", "o Reward and ATM refunds are not received.", "• $4 paper statement fee", "", "Basic Checking",
  "• $4 monthly service charge * waived if daily balance",
].join("\n");

const row = (id: number, doc: number, amount: number, crawled: string, name = "Paper statement fee"): CrossPageRow => ({
  fee_published_id: id, fee_verified_id: id + 1000, institution_id: 551, canonical_fee_key: "paper_statement",
  fee_name: name, amount, source_document_id: doc, document_crawled_at: crawled,
});

describe("productHeadings", () => {
  it("finds the product a fee line sits under", () => {
    expect([...productHeadings(comparePage, "Paper statement fee", 5)]).toEqual(["cash back checking"]);
    expect([...productHeadings(accountPdf, "paper statement fee", 4)]).toEqual(["cash back checking"]);
  });

  it("gives no heading under a section title or an entry in a list of products", () => {
    expect(productHeadings("Account Service Charges\nPaper statement fee $3.00", "Paper statement fee", 3).size).toBe(0);
    const list = "Checking\n\nSavings\n\nCertificates of Deposit (CDs)\n\nFDIC-insured IRAs\n\nIf balances drop below $20,000, you'll be charged a $25 monthly service fee";
    expect(productHeadings(list, "Monthly service fee", 25).size).toBe(0);
    expect(namesProduct("Cash Back Checking")).toBe(true);
    expect(namesProduct("Checking Account Fees")).toBe(false);
    expect(namesProduct("Checking | Safe Deposit Box")).toBe(false);
  });
});

describe("crossPageConflicts", () => {
  it("takes the older page's price down when one product has two prices on two current pages (551)", () => {
    const texts = new Map([[13386, [comparePage]], [20941, [accountPdf]]]);
    const out = crossPageConflicts([row(100434, 13386, 5, "2026-10-03T07:50:51Z"), row(79432, 20941, 4, "2026-10-07T08:35:58Z")], texts);
    expect(out.map((fee) => [fee.feePublishedId, fee.keptFeePublishedId, fee.heading])).toEqual([[100434, 79432, "cash back checking"]]);
    expect(out[0].reason).toBe("cross_page_conflict: #13386 older than #20941 (fee 79432)");
  });

  it("leaves two copies of one text alone: both print both prices, so one row is a misread", () => {
    const line = "Consumer Indexed Money Market | $15 monthly | Check Cashing | $5 each";
    const text = `Rewards Checking\n${line}`;
    const texts = new Map([[6272, [text]], [6273, [text]]]);
    const rows = [
      { ...row(31278, 6272, 5, "2026-10-01T00:00:00Z", "Check Cashing"), canonical_fee_key: "check_cashing" },
      { ...row(31279, 6273, 15, "2026-10-02T00:00:00Z", "Check Cashing"), canonical_fee_key: "check_cashing" },
    ];
    expect(crossPageConflicts(rows, texts)).toEqual([]);
  });

  it("leaves two products alone", () => {
    const texts = new Map([[1, ["Cash Back Checking\n• $5 paper statement fee"]], [2, ["Basic Checking Plus\n• $4 paper statement fee"]]]);
    expect(crossPageConflicts([row(1, 1, 5, "2026-10-01T00:00:00Z"), row(2, 2, 4, "2026-10-02T00:00:00Z")], texts)).toEqual([]);
  });
});

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

function createDb(pendingFlag: { flag_run_id: number; flagged_at: string } | null) {
  const query = (strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("to_regclass")) return Promise.resolve([{ ready: true }]);
    if (text.includes("FROM agent_source_texts")) {
      return Promise.resolve([{ source_document_id: 13386, normalized_text: comparePage }, { source_document_id: 20941, normalized_text: accountPdf }]);
    }
    if (text.includes("FROM pipeline_feedback")) {
      return Promise.resolve(pendingFlag ? [{ fee_published_id: 100434, kind: "takedown_pending", evidence: { ...pendingFlag, reason: "cross_page_conflict: #13386 older than #20941 (fee 79432)" } }] : []);
    }
    if (text.includes("SET rolled_back_at = NOW()")) return Promise.resolve([{ fee_published_id: 100434 }]);
    return Promise.resolve([]);
  };
  const db = vi.fn(query) as unknown as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
  db.unsafe = vi.fn(() => Promise.resolve([row(100434, 13386, 5, "2026-10-03T07:50:51Z"), row(79432, 20941, 4, "2026-10-07T08:35:58Z")]));
  return db as unknown as Parameters<typeof retireCrossPageConflicts>[0] & typeof db;
}
const options = { runId: 9, batchId: "agentic-run-9", dryRun: false };

// Valley (44): the 2025 and 2026 editions of one deposit agreement, both current. The shared body
// stands in for the agreement's ~2,000 other words.
const agreementBody = Array.from({ length: 260 }, (_, at) => `clause${String.fromCharCode(97 + (at % 26))}${String.fromCharCode(97 + Math.floor(at / 26))}word`).join(" ");
const edition2025 = `${agreementBody}\nRev. 01/30/25\nOverdrafts: $30 per paid item.\n• Valley debit card expedited delivery fee: $25.`;
const edition2026 = `${agreementBody}\nRev. 03/2026\nOverdrafts: $35 per paid item, up to 5 charges per day.\n• Valley debit card expedited delivery fee: $35.`;
const valley = (id: number, doc: number, amount: number, crawled: string, lastModified: string | null): CrossPageRow => ({
  fee_published_id: id, fee_verified_id: id + 1000, institution_id: 44, canonical_fee_key: "overdraft",
  fee_name: "Overdrafts", amount, source_document_id: doc, document_crawled_at: crawled, document_last_modified: lastModified,
});

describe("editions of one document", () => {
  it("keeps the newer edition's price by the documents' own dates, not fetch time (Valley 103414)", () => {
    // The 2025 edition was fetched five minutes after the 2026 one.
    const old = valley(103414, 23743, 30, "2026-10-09T07:13:48Z", "Mon, 17 Mar 2025 18:38:41 GMT");
    const current = valley(103405, 23731, 35, "2026-10-09T07:08:58Z", "Wed, 25 Mar 2026 17:43:42 GMT");
    const texts = new Map([[23743, [edition2025]], [23731, [edition2026]]]);
    const out = crossPageConflicts([old, current], texts);
    expect(out.map((fee) => [fee.feePublishedId, fee.keptFeePublishedId, fee.reason])).toEqual([
      [103414, 103405, "cross_page_conflict: #23743 older edition of #23731 (fee 103405)"],
    ]);
  });

  it("judges an edition pair only with both documents' own dates, a day or more apart", () => {
    const texts = new Map([[23743, [edition2025]], [23731, [edition2026]]]);
    const noHeader = [valley(103414, 23743, 30, "2026-10-09T07:13:48Z", null), valley(103405, 23731, 35, "2026-10-09T07:08:58Z", null)];
    expect(crossPageConflicts(noHeader, texts)).toEqual([]);
    const sameDay = [valley(103414, 23743, 30, "2026-10-09T07:13:48Z", "Wed, 25 Mar 2026 08:00:00 GMT"), valley(103405, 23731, 35, "2026-10-09T07:08:58Z", "Wed, 25 Mar 2026 17:43:42 GMT")];
    expect(crossPageConflicts(sameDay, texts)).toEqual([]);
    expect(newerDocument(noHeader[0], noHeader[1])).toBe(true);
    expect(newerDocument(noHeader[0], noHeader[1], true)).toBe(false);
  });

  it("does not take one product's schedule for an edition of the bank's full schedule (PNC Simple Checking)", () => {
    const fullOnly = Array.from({ length: 120 }, (_, at) => `product${String.fromCharCode(97 + (at % 26))}${String.fromCharCode(97 + Math.floor(at / 26))}name`).join(" ");
    expect(sameDocumentEdition([edition2025], [edition2026])).toBe(true);
    expect(sameDocumentEdition([agreementBody], [`${agreementBody} ${fullOnly}`])).toBe(false);
    expect(sameDocumentEdition([edition2025], [edition2025])).toBe(false);
    expect(sameDocumentEdition(["Overdrafts: $30"], ["Overdrafts: $35"])).toBe(false);
  });

  it("leaves an edition pair alone when either text prints both prices", () => {
    const both = `${edition2026}\nOverdrafts: $30 per paid item for accounts opened before 2026.`;
    const texts = new Map([[23743, [edition2025]], [23731, [both]]]);
    const rows = [valley(103414, 23743, 30, "2026-10-09T07:13:48Z", "Mon, 17 Mar 2025 18:38:41 GMT"), valley(103405, 23731, 35, "2026-10-09T07:08:58Z", "Wed, 25 Mar 2026 17:43:42 GMT")];
    expect(crossPageConflicts(rows, texts)).toEqual([]);
  });
});

describe("retireCrossPageConflicts", () => {
  it("only flags on the first look, keeping the fee live", async () => {
    const db = createDb(null);
    const result = await retireCrossPageConflicts(db, options);
    expect(result).toMatchObject({ conflicts: 1, flagged: 1, rolledBack: [] });
    expect(db.mock.calls.some((call) => templateText(call[0]).includes("SET rolled_back_at = NOW()"))).toBe(false);
    expect(String(db.unsafe.mock.calls[0][0])).toContain("superseded_by_id IS NULL");
  });

  it("archives the older price on its second look with both documents logged, never deleting", async () => {
    const db = createDb({ flag_run_id: 1, flagged_at: new Date(Date.now() - 13 * 3_600_000).toISOString() });
    const result = await retireCrossPageConflicts(db, options);
    expect(result.rolledBack.map((fee) => fee.feePublishedId)).toEqual([100434]);
    const calls = JSON.stringify(db.mock.calls);
    expect(calls).toContain("SET review_status = 'rejected'");
    expect(calls).not.toContain("DELETE");
    expect(calls).toContain('kept_document_id\\":20941');
    expect(calls).toContain('older_document_id\\":13386');
  });
});
