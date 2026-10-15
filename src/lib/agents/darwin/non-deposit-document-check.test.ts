import { describe, expect, it, vi } from "vitest";

import {
  NON_DEPOSIT_BATCH,
  NON_DEPOSIT_CHECK,
  NON_DEPOSIT_DOCUMENT_TAKEDOWN_LIVE,
  findNonDepositFees,
  nonDepositCountSql,
  nonDepositDetail,
  nonDepositSamplesSql,
  recheckNonDepositDocuments,
} from "./non-deposit-document-check";

const ROWS = [
  { fee_published_id: "101", fee_verified_id: "9001", institution_id: "5", fee_name: "Appraisal", amount: "400", canonical_fee_key: "other", source_document_id: "71", document_url: "https://www.bankofgreene.com/current-rates/" },
  { fee_published_id: "102", fee_verified_id: "9002", institution_id: "6", fee_name: "Research", amount: "20", canonical_fee_key: "account_research", source_document_id: "72", document_url: "https://www.usbank.com/investing/self-directed-investing/pricing.html" },
  { fee_published_id: "103", fee_verified_id: "9003", institution_id: "5", fee_name: "Loan Payment by Phone", amount: "5", canonical_fee_key: "other", source_document_id: "73", document_url: "https://www.example.com/fees/loan-payment-fee" },
  { fee_published_id: "104", fee_verified_id: "9004", institution_id: "6", fee_name: "Overdraft", amount: "35", canonical_fee_key: "overdraft", source_document_id: "74", document_url: "https://www.example.com/personal/Schedule-of-Fees-Personal-Checking.pdf" },
  { fee_published_id: "105", fee_verified_id: "9005", institution_id: "7", fee_name: "Wire", amount: "25", canonical_fee_key: "wire_domestic_outgoing", source_document_id: "75", document_url: "https://www.example.com/business/loans/rates" },
  { fee_published_id: "106", fee_verified_id: null, institution_id: "7", fee_name: "Stop Payment", amount: "30", canonical_fee_key: "stop_payment", source_document_id: null, document_url: null },
];

type DbMock = ReturnType<typeof vi.fn>;
function dbFor(rows: Array<Record<string, unknown>>, options: { cursor?: string | null; flags?: Array<Record<string, unknown>> } = {}): DbMock {
  return vi.fn((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (text.includes("FROM agent_run_events")) return Promise.resolve(options.cursor == null ? [] : [{ next_after_id: options.cursor }]);
    if (text.includes("information_schema") || text.includes("to_regclass")) return Promise.resolve([{ ready: true, exists: true, present: true }]);
    if (text.includes("FROM pipeline_feedback")) return Promise.resolve(options.flags ?? []);
    if (text.includes("UPDATE published_fee_records")) return Promise.resolve([{ fee_published_id: "101" }]);
    if (text.includes("FROM published_fee_records")) return Promise.resolve(rows);
    return Promise.resolve([]);
  });
}
const asDb = (db: DbMock) => db as unknown as Parameters<typeof recheckNonDepositDocuments>[0];
const texts = (db: DbMock) => db.mock.calls.map(([strings]) => (strings as TemplateStringsArray).join("?"));

describe("Darwin live non-deposit document re-check (#1442)", () => {
  it("ships with the switch off", () => {
    expect(NON_DEPOSIT_DOCUMENT_TAKEDOWN_LIVE).toBe(false);
    expect(NON_DEPOSIT_BATCH).toBe(2_000);
  });

  it("counts by kind and leaves deposit, business and undocumented fees alone", () => {
    const found = findNonDepositFees(ROWS);
    expect(found).toMatchObject({ checked: 6, withDocument: 5, matched: 2, byKind: { loan: 1, brokerage: 1 }, documents: 2, institutions: 2 });
    expect(found.matches.map((fee) => [fee.feePublishedId, fee.kind, fee.reason])).toEqual([
      [101, "loan", "non_deposit_document: loan #71"],
      [102, "brokerage", "non_deposit_document: brokerage #72"],
    ]);
    expect(found.passing).toEqual([103, 104, 105]);
  });

  it("in shadow, reports and moves the cursor but writes no fee and logs no flag", async () => {
    const db = dbFor(ROWS, { cursor: "100" });
    const result = await recheckNonDepositDocuments(asDb(db), { runId: 7, stepId: 70, dryRun: false });
    expect(result).toMatchObject({ live: false, matched: 2, afterId: 100, nextAfterId: 0, flagged: 0, takenDown: [] });
    const sent = texts(db);
    expect(sent.some((text) => text.includes("UPDATE"))).toBe(false);
    expect(sent.some((text) => text.includes("pipeline_feedback"))).toBe(false);
    const report = db.mock.calls.find(([strings]) => (strings as TemplateStringsArray).join("?").includes("INSERT INTO agent_run_events"));
    expect(report?.[3]).toBe(NON_DEPOSIT_CHECK);
    expect(String(report?.[4])).toContain("switch off, would take down, nothing written");
    expect(JSON.parse(String(report?.[5]))).toMatchObject({ next_after_id: 0, would_take_down: 2, by_kind: { loan: 1, brokerage: 1 }, switch_live: false });
  });

  it("reads the live fee's document through the document-owner join", async () => {
    const db = dbFor(ROWS);
    await recheckNonDepositDocuments(asDb(db), { runId: 7, dryRun: true });
    const read = texts(db).find((text) => text.includes("FROM published_fee_records")) ?? "";
    expect(read).toContain("fv.fee_verified_id = fp.lineage_ref");
    expect(read).toContain("fr.fee_raw_id = fv.fee_raw_id");
    expect(read).toContain("sd.id = fr.source_document_id");
    expect(read).toContain("fp.rolled_back_at IS NULL");
    expect(read).toContain("fp.quarantined_at IS NULL");
  });

  it("carries the cursor on when the batch is full", async () => {
    const result = await recheckNonDepositDocuments(asDb(dbFor(ROWS.slice(0, 2))), { runId: 7, dryRun: false, limit: 2 });
    expect(result.afterId).toBe(0);
    expect(result.nextAfterId).toBe(102);
  });

  it("a dry run writes nothing at all, even switched on", async () => {
    const db = dbFor(ROWS);
    await recheckNonDepositDocuments(asDb(db), { runId: 7, dryRun: true, live: true });
    expect(texts(db).some((text) => text.includes("UPDATE") || text.includes("INSERT"))).toBe(false);
  });

  it("switched on, a fee whose first look is older than 12 hours from another run is archived and logged", async () => {
    const now = new Date("2026-10-16T12:00:00Z");
    const db = dbFor(ROWS, {
      flags: [{ fee_published_id: "101", kind: "takedown_pending", evidence: { flag_run_id: 3, flagged_at: "2026-10-15T00:00:00Z", reason: "non_deposit_document: loan #71" } }],
    });
    const result = await recheckNonDepositDocuments(asDb(db), { runId: 7, stepId: 70, dryRun: false, live: true, now });
    expect(result.takenDown).toEqual([101]);
    const update = db.mock.calls.find(([strings]) => (strings as TemplateStringsArray).join("?").includes("UPDATE published_fee_records"));
    expect(update?.[1]).toBe("darwin-non-deposit-7");
    expect(update?.[2]).toEqual([101]);
    expect(update?.[3]).toEqual(["non_deposit_document: loan #71"]);
    const sent = texts(db);
    expect(sent.some((text) => text.includes("UPDATE verified_fee_observations"))).toBe(true);
    expect(JSON.stringify(db.mock.calls)).toContain("darwin.non_deposit_document_takedown");
  });

  it("an institution-scoped run leaves the cursor alone", async () => {
    const db = dbFor(ROWS, { cursor: "100" });
    const result = await recheckNonDepositDocuments(asDb(db), { runId: 7, dryRun: false, institutionId: 5 });
    expect(result.afterId).toBeNull();
    expect(result.nextAfterId).toBeNull();
    expect(texts(db).some((text) => text.includes("FROM agent_run_events"))).toBe(false);
  });

  it("gives step detail with the switch state and samples", () => {
    const detail = nonDepositDetail({
      ...findNonDepositFees(ROWS), live: false, dryRun: false, afterId: 0, nextAfterId: 0, flagged: 0, waiting: 0, cleared: 0, takenDown: [],
    });
    expect(detail).toMatchObject({ check: "darwin.non_deposit_document", switch_live: false, would_take_down: 2, taken_down: 0 });
    expect(detail.samples[0]).toMatchObject({ fee_published_id: 101, kind: "loan", document_url: "https://www.bankofgreene.com/current-rates/" });
  });
});

describe("read-only non-deposit document SQL", () => {
  it("counts live fees by kind with the shared classifier's Postgres patterns", () => {
    const text = nonDepositCountSql();
    expect(text).not.toMatch(/\\[bsdw]/);
    expect(text).toContain("[ /](?:business|commercial|corporate|treasury");
    expect(text).toContain("[ /](?:checking|savings|share drafts?|money market|deposits?|truth in savings");
    expect(text).toContain("(?:current|todays|today s|our) rates");
    expect(text).toContain("helocs?");
    expect(text).toContain("wealth management|wealth advisory|private wealth|investment management|self directed");
    expect(text).toContain("'([a-z])([A-Z])', '\\1 \\2', 'g'");
    expect(text).toContain("THEN 'brokerage'");
    expect(text).toContain("THEN 'loan'");
    expect(text).toContain("fv.fee_verified_id = fp.lineage_ref");
    expect(text).toContain("fp.rolled_back_at IS NULL AND fp.quarantined_at IS NULL");
    expect(text).toContain("GROUP BY ROLLUP (j.kind)");
    expect(text).not.toMatch(/\b(?:UPDATE|INSERT|DELETE)\b/);
  });

  it("samples the matched documents, most live fees first", () => {
    const text = nonDepositSamplesSql();
    expect(text).toContain("WHERE j.kind IS NOT NULL");
    expect(text).toContain("ORDER BY count(*) DESC");
    expect(text).toContain("LIMIT 60;");
    expect(text).not.toMatch(/\b(?:UPDATE|INSERT|DELETE)\b/);
  });
});
