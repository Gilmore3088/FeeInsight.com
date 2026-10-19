import { describe, expect, it, vi } from "vitest";

import {
  CANADIAN_DOCUMENT_CHECK,
  CANADIAN_DOCUMENT_TAKEDOWN_LIVE,
  CANADIAN_MARKS_SQL,
  US_INSURER_SQL,
  canadianDocument,
  canadianDocumentDetail,
  findCanadianDocuments,
  recheckCanadianDocuments,
} from "./canadian-document-check";

const CHEQUING = "https://www.nbc.ca/personal/accounts/chequing.html";
const GUIDE = "https://www.nbc.ca/content/dam/shared/pdf/personal/17692-fee-guide-pbs.pdf";

// Natbank's live rows on Canadian pages, 2026-10-19 (prod, read-only).
const ROWS = [
  { fee_published_id: "127401", fee_verified_id: "143893", institution_id: "2675", fee_name: "Bill payment service", amount: "2.00", canonical_fee_key: "bill_pay", source_document_id: "26834", document_url: GUIDE },
  { fee_published_id: "127400", fee_verified_id: "143892", institution_id: "2675", fee_name: "Monthly fee", amount: "2.50", canonical_fee_key: "monthly_maintenance", source_document_id: "26833", document_url: ` ${CHEQUING} ` },
  { fee_published_id: "127408", fee_verified_id: "143900", institution_id: "2675", fee_name: "Transaction that leads to or increases overdraft", amount: "5.00", canonical_fee_key: "overdraft", source_document_id: "26834", document_url: GUIDE },
];

type DbMock = ReturnType<typeof vi.fn>;
function dbFor(rows: Array<Record<string, unknown>>, options: { lastReadAt?: Date | null; flags?: Array<Record<string, unknown>>; failRead?: boolean } = {}): DbMock {
  return vi.fn((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (text.includes("information_schema") || text.includes("to_regclass")) return Promise.resolve([{ ready: true, exists: true, present: true }]);
    if (text.includes("FROM pipeline_feedback")) return Promise.resolve(options.flags ?? []);
    if (text.includes("FROM agent_run_events")) return Promise.resolve(options.lastReadAt ? [{ created_at: options.lastReadAt }] : []);
    if (text.includes("UPDATE published_fee_records")) return Promise.resolve([{ fee_published_id: "127400" }]);
    if (text.includes("WITH live AS")) return options.failRead ? Promise.reject(new Error("read failed")) : Promise.resolve(rows);
    return Promise.resolve([]);
  });
}
const asDb = (db: DbMock) => db as unknown as Parameters<typeof recheckCanadianDocuments>[0];
const texts = (db: DbMock) => db.mock.calls.map(([strings]) => (strings as TemplateStringsArray).join("?"));

describe("canadianDocument (#2022)", () => {
  it("reads National Bank of Canada's pages as Canadian and U.S. schedules as not", () => {
    expect(canadianDocument("Unlimited Interac e-Transfers with no fees")).toBe(true);
    expect(canadianDocument("Fee Guide for Personal Banking Solutions ... Interac e-Transfer ... 28")).toBe(true);
    expect(canadianDocument("Eligible deposits are insured by the Canada Deposit Insurance Corporation")).toBe(true);
    expect(canadianDocument("Member CDIC")).toBe(true);
    // Natbank's U.S. page (doc 17161): no Canadian marker.
    expect(canadianDocument("NatCheck Unlimited Monthly fee $5 ... Florida")).toBe(false);
    // "interactive" matched 352 live documents on Oct 19; whole words only.
    expect(canadianDocument("Use our interactive fee calculator or interact with a banker")).toBe(false);
    // RBC Bank's cross-border page names CDIC beside FDIC: a U.S. bank's document.
    expect(canadianDocument("RBC Bank (Georgia), N.A. Member FDIC. Not insured by CDIC.")).toBe(false);
    expect(canadianDocument("Interac ATM in Canada ... Federally insured by NCUA")).toBe(false);
    expect(canadianDocument(null)).toBe(false);
  });

  it("writes the same words for Postgres", () => {
    expect(CANADIAN_MARKS_SQL).toBe("\\m(interac|cdic|canada deposit insurance)\\M");
    expect(US_INSURER_SQL).toBe("\\m(fdic|ncua)\\M");
  });
});

describe("findCanadianDocuments (#2022)", () => {
  it("lists each fee once, in id order, with the document in the reason", () => {
    const found = findCanadianDocuments([...ROWS, ROWS[0]]);
    expect(found.matches.map((fee) => [fee.feePublishedId, fee.reason])).toEqual([
      [127400, "canadian_document: #26833"],
      [127401, "canadian_document: #26834"],
      [127408, "canadian_document: #26834"],
    ]);
    expect(found).toMatchObject({ matched: 3, documents: 2, institutions: 1 });
    expect(found.matches[0].documentUrl).toBe(CHEQUING);
  });
});

describe("recheckCanadianDocuments (#2022)", () => {
  it("is on, and a first failure is flagged, not taken down", async () => {
    expect(CANADIAN_DOCUMENT_TAKEDOWN_LIVE).toBe(true);
    const db = dbFor(ROWS);
    const result = await recheckCanadianDocuments(asDb(db), { runId: 7, stepId: 70, dryRun: false });
    expect(result).toMatchObject({ live: true, skipped: false, matched: 3, takenDown: [] });
    expect(result.flagged).toBe(3);
    expect(texts(db).some((text) => text.includes("UPDATE published_fee_records"))).toBe(false);
    expect(texts(db).some((text) => text.includes("INSERT INTO agent_run_events"))).toBe(true);
  });

  it("takes a fee down on its second look, at least 12 hours after the first", async () => {
    const flaggedAt = new Date("2026-10-19T00:00:00Z");
    const db = dbFor([ROWS[1]], {
      flags: [{ fee_published_id: "127400", kind: "takedown_pending", evidence: { flag_run_id: 3, flagged_at: flaggedAt.toISOString(), reason: "canadian_document: #26833" } }],
    });
    const result = await recheckCanadianDocuments(asDb(db), { runId: 9, dryRun: false, now: new Date("2026-10-19T13:00:00Z") });
    expect(result.takenDown).toEqual([127400]);
    const update = texts(db).find((text) => text.includes("UPDATE published_fee_records"))!;
    expect(update).toContain("rolled_back_reason = v.reason");
    expect(texts(db).some((text) => text.includes("UPDATE verified_fee_observations"))).toBe(true);
  });

  it("reads at most hourly, unless the run is scoped to an institution", async () => {
    const now = new Date("2026-10-19T02:00:00Z");
    const recent = dbFor(ROWS, { lastReadAt: new Date("2026-10-19T01:30:00Z") });
    const skipped = await recheckCanadianDocuments(asDb(recent), { runId: 1, dryRun: false, now });
    expect(skipped).toMatchObject({ skipped: true, matched: 0 });
    expect(texts(recent).some((text) => text.includes("WITH live AS"))).toBe(false);

    const old = dbFor(ROWS, { lastReadAt: new Date("2026-10-19T00:30:00Z") });
    expect((await recheckCanadianDocuments(asDb(old), { runId: 1, dryRun: false, now })).matched).toBe(3);

    const scoped = dbFor(ROWS, { lastReadAt: new Date("2026-10-19T01:30:00Z") });
    expect((await recheckCanadianDocuments(asDb(scoped), { runId: 1, dryRun: false, now, institutionId: 2675 })).matched).toBe(3);
  });

  it("writes nothing in a dry run or with the switch off, and survives a failed read", async () => {
    const dry = dbFor(ROWS);
    expect((await recheckCanadianDocuments(asDb(dry), { runId: 1, dryRun: true })).matched).toBe(3);
    expect(texts(dry).some((text) => /INSERT|UPDATE/.test(text))).toBe(false);

    const off = dbFor(ROWS);
    const result = await recheckCanadianDocuments(asDb(off), { runId: 1, dryRun: false, live: false });
    expect(result).toMatchObject({ live: false, matched: 3, flagged: 0 });
    expect(texts(off).some((text) => text.includes("pipeline_feedback") && text.includes("INSERT"))).toBe(false);
    expect(canadianDocumentDetail(result)).toMatchObject({ check: CANADIAN_DOCUMENT_CHECK, switch_live: false, matched: 3, documents: 2 });

    const failed = dbFor(ROWS, { failRead: true });
    expect(await recheckCanadianDocuments(asDb(failed), { runId: 1, dryRun: false })).toMatchObject({ matched: 0, takenDown: [] });
  });
});
