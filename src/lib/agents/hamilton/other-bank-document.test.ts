import { describe, expect, it, vi } from "vitest";

import { otherBankFeesSql, retireOtherBankDocumentFees, unconfirmedHostFeesSql } from "./other-bank-document";

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

// USF FCU (Tampa, usffcu.com) read from usfcu.com, a host that is no institution's in the registry
// and whose text never names USF FCU (admin audit, Oct 9).
const unconfirmedRows = [
  {
    fee_published_id: 3, fee_verified_id: 13, institution_id: 6745, source_document_id: 20001,
    document_url: "https://www.usfcu.com/fees.pdf", document_host: "usfcu.com",
    other_institution_id: 0, other_institution_name: "usfcu.com", names_own_bank: false,
  },
];

function createDb(
  pendingFlag: { flag_run_id: number; flagged_at: string } | null,
  options: { unconfirmed?: typeof unconfirmedRows; pendingIds?: number[] } = {},
) {
  const query = (strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("to_regclass")) return Promise.resolve([{ ready: true }]);
    if (text.includes("FROM pipeline_feedback")) {
      const ids = options.pendingIds ?? [1];
      return Promise.resolve(
        pendingFlag ? ids.map((id) => ({ fee_published_id: id, kind: "takedown_pending", evidence: { ...pendingFlag, reason: "other bank" } })) : [],
      );
    }
    if (text.includes("SET rolled_back_at = NOW()")) return Promise.resolve((options.pendingIds ?? [1]).map((id) => ({ fee_published_id: id })));
    if (text.includes("SET fee_schedule_url = NULL")) return Promise.resolve([{ id: 915 }]);
    return Promise.resolve([]);
  };
  const db = vi.fn(query) as unknown as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
  db.unsafe = vi.fn((text: string) => Promise.resolve(text.includes("own_label") ? options.unconfirmed ?? [] : rows));
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
    expect(otherBankFeesSql("fees")).toContain("fp.fee_published_id = ANY($1::bigint[])");
    expect(unconfirmedHostFeesSql("fees")).toContain("fp.fee_published_id = ANY($1::bigint[])");
  });

  it("archives another bank's fee on the first run that sees it, with its first look logged (James, Oct 8)", async () => {
    const db = createDb(null);
    const result = await retireOtherBankDocumentFees(db, options);
    expect(result).toMatchObject({ otherBankFees: 2, namesOwnBank: 1, flagged: 1 });
    expect(result.rolledBack.map((fee) => fee.feePublishedId)).toEqual([1]);
    expect(writes(db).some((text) => text.includes("SET rolled_back_at = NOW()"))).toBe(true);
    expect(JSON.stringify(db.mock.calls)).toContain("takedown_pending");
  });

  it("archives it, sends the link back to discovery and teaches Magellan", async () => {
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

  it("reads documents on a host that is neither the bank's nor another institution's, skipping file hosts", () => {
    const text = unconfirmedHostFeesSql(true);
    expect(text).toContain("NOT EXISTS (SELECT 1 FROM sites o WHERE o.host = d.host AND o.id <> l.institution_id)");
    expect(text).toContain("squarespace");
    expect(text).toContain("locked_by_correction IS TRUE");
    expect(text).toContain("m.own_label = m.document_label");
    expect(text).toContain("fp.institution_id = $1");
    expect(unconfirmedHostFeesSql(false)).not.toContain("$1");
  });

  it("only logs a first look for a fee on an unconfirmed host", async () => {
    const db = createDb(null, { unconfirmed: unconfirmedRows });
    const result = await retireOtherBankDocumentFees(db, options);
    expect(result).toMatchObject({ unconfirmedHostFees: 1, unconfirmedHostFlagged: 1 });
    expect(result.rolledBack.map((fee) => fee.feePublishedId)).toEqual([1]);
    expect(JSON.stringify(db.mock.calls)).toContain("hamilton.second_look:hamilton.unconfirmed_document_host:pub:3");
  });

  it("archives a fee on an unconfirmed host on its second look and sends the link back to discovery", async () => {
    const db = createDb(
      { flag_run_id: 1, flagged_at: new Date(Date.now() - 13 * 3_600_000).toISOString() },
      { unconfirmed: unconfirmedRows, pendingIds: [1, 3] },
    );
    const result = await retireOtherBankDocumentFees(db, options);
    expect(result.rolledBack.map((fee) => [fee.feePublishedId, fee.reason, fee.kind])).toEqual([
      [1, "other_bank_document: peoplesbank-wa.com", "other_bank"],
      [3, "unconfirmed_document_host: usfcu.com", "unconfirmed_host"],
    ]);
    const calls = JSON.stringify(db.mock.calls);
    expect(calls).toContain("magellan_unconfirmed_document_host");
    expect(calls).toContain("hamilton.unconfirmed_document_host:doc:20001");
    expect(writes(db).some((text) => text.includes("DELETE"))).toBe(false);
  });
});
