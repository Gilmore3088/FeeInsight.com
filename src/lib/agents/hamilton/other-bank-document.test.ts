import { describe, expect, it, vi } from "vitest";

import { otherBankFeesSql, retireOtherBankDocumentFees } from "./other-bank-document";

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

// Peoples Bank of Rock Valley, Iowa (915) read Peoples Bank of Bellingham, Washington's PDF (Oct 8).
const rows = [
  {
    fee_published_id: 1, fee_verified_id: 11, institution_id: 915, source_document_id: 15827,
    document_url: "https://www.peoplesbank-wa.com/wp-content/uploads/2024/11/Personal-Fee-Schedule.pdf",
    document_host: "peoplesbank-wa.com", other_institution_id: 505, other_institution_name: "Peoples Bank", names_own_bank: false,
  },
  // A schedule hosted elsewhere that names the bank's own city stays live (Hema FCU, Silver Spring).
  {
    fee_published_id: 2, fee_verified_id: 12, institution_id: 6365, source_document_id: 12911,
    document_url: "https://bienestarfcu.org/fees.pdf", document_host: "bienestarfcu.org",
    other_institution_id: 5066, other_institution_name: "Paho/Who Federal Credit Union", names_own_bank: true,
  },
];

function createDb(pendingFlag: { flag_run_id: number; flagged_at: string } | null) {
  const query = (strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("to_regclass")) return Promise.resolve([{ ready: true }]);
    if (text.includes("FROM pipeline_feedback")) {
      return Promise.resolve(pendingFlag ? [{ fee_published_id: 1, kind: "takedown_pending", evidence: { ...pendingFlag, reason: "other bank" } }] : []);
    }
    if (text.includes("SET rolled_back_at = NOW()")) return Promise.resolve([{ fee_published_id: 1 }]);
    if (text.includes("SET fee_schedule_url = NULL")) return Promise.resolve([{ id: 915 }]);
    return Promise.resolve([]);
  };
  const db = vi.fn(query) as unknown as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
  db.unsafe = vi.fn(() => Promise.resolve(rows));
  return db as unknown as Parameters<typeof retireOtherBankDocumentFees>[0] & typeof db;
}
const writes = (db: ReturnType<typeof createDb>) => db.mock.calls.map((call) => templateText(call[0]));
const options = { runId: 5, batchId: "agentic-run-5", dryRun: false };

describe("retireOtherBankDocumentFees", () => {
  it("reads only fees whose document is on another institution's website, not the bank's own", () => {
    const text = otherBankFeesSql(true);
    expect(text).toContain("own.host IS DISTINCT FROM d.host");
    expect(text).toContain("o.host = d.host AND o.id <> l.institution_id");
    expect(text).toContain("fp.institution_id = $1");
    expect(otherBankFeesSql(false)).not.toContain("$1");
  });

  it("only logs another bank's fee the first time, keeping it live", async () => {
    const db = createDb(null);
    const result = await retireOtherBankDocumentFees(db, options);
    expect(result).toMatchObject({ otherBankFees: 2, namesOwnBank: 1, flagged: 1, rolledBack: [] });
    expect(writes(db).some((text) => text.includes("SET rolled_back_at = NOW()"))).toBe(false);
    expect(JSON.stringify(db.mock.calls)).toContain("takedown_pending");
  });

  it("archives it on its second look, sends the link back to discovery and teaches Magellan", async () => {
    const db = createDb({ flag_run_id: 1, flagged_at: new Date(Date.now() - 13 * 3_600_000).toISOString() });
    const result = await retireOtherBankDocumentFees(db, options);
    expect(result.rolledBack.map((fee) => [fee.feePublishedId, fee.reason])).toEqual([[1, "other_bank_document: peoplesbank-wa.com"]]);
    expect(result.linksCleared).toBe(1);
    expect(writes(db).some((text) => text.includes("SET review_status = 'rejected'"))).toBe(true);
    expect(writes(db).some((text) => text.includes("rejected_source_urls"))).toBe(true);
    expect(writes(db).some((text) => text.includes("DELETE"))).toBe(false);
    const calls = JSON.stringify(db.mock.calls);
    expect(calls).toContain("hamilton.other_bank_document:doc:15827");
    expect(calls).toContain("wrong_document");
    expect(writes(db).some((text) => text.includes("hamilton.other_bank_document_rolled_back"))).toBe(true);
  });

  it("changes nothing in a dry run", async () => {
    const db = createDb({ flag_run_id: 1, flagged_at: new Date(Date.now() - 13 * 3_600_000).toISOString() });
    const result = await retireOtherBankDocumentFees(db, { ...options, dryRun: true });
    expect(result.rolledBack).toHaveLength(1);
    expect(writes(db).some((text) => /UPDATE|INSERT INTO/.test(text))).toBe(false);
  });
});
