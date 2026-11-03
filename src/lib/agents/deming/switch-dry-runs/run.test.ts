import { describe, expect, it, vi } from "vitest";

import { scoreFreshAudit, type FreshAuditResult } from "@/lib/agents/deming/fresh-audit";
import { parseSwitchAuditArgs } from "./args";
import { formatSwitchDryRuns } from "./format";
import { runSwitchDryRuns } from "./run";
import { DEFAULT_SWITCH_AUDIT_OPTIONS, type DailyCapRow, type LiveFeeRow, type SwitchAuditReader } from "./types";
import { AUDIENCE_CASES, RETIRED_CASES } from "@/lib/section-path-near-miss.fixtures";
import { ATM_HEADING_CASES } from "@/lib/fee-fold-atm-heading.fixtures";

// The data-store boundary, mocked: two cap rows on two documents, one dash list document (State key
// 10272's first run), one live limit row and one past limit takedown.
const capRow = (id: number, documentId: number, name: string, amount: number): DailyCapRow => ({
  fee_raw_id: id, institution_id: 10, institution_name: "Bank A", source_document_id: documentId, source_url: null, document_url: null, document_crawled_at: null, document_stream: null, raw_name: name, raw_amount: amount,
  product_name: null, outlier_flags: ["canonical_hint:od_daily_cap"], conditions: null, fee_verified_id: null, review_status: null, verified_key: null,
  verified_name: null, verified_amount: null, fee_published_id: null, published_key: null, published_name: null, published_amount: null,
  removed: null, rolled_back_reason: null, verify_decision: "needs_review", verify_reason: "outside_envelope", verify_key: null,
});

const TEXTS = new Map<number, string>([
  [100, "Paid Overdraft Charge: $30.00/item ($150.00 max daily)"],
  [200, "Overdraft Daily Cap | $175"],
  [7, ["Fee Schedule", "Checking Fees", "$25.00 - NSF Check/ACH/ATM item", "$20.00 - Stop Payment (single check)", "$35.00 - Stop Payment (range of checks)"].join("\n")],
  // #1092: a grandfathered section set a blank line apart, and a business share section (Texas keys 2445, 2434).
  [9, (RETIRED_CASES.find((c) => c.name.startsWith("a grandfathered heading")) as (typeof RETIRED_CASES)[number]).text],
  [11, (AUDIENCE_CASES.find((c) => c.name.startsWith("a business share section")) as (typeof AUDIENCE_CASES)[number]).text],
  // #1092: Texas key 2416's "Non-TBT or Non-Allpoint ATM1:" section.
  [13, ATM_HEADING_CASES[0].text],
  // v161: a skipped loan payment live under late payment, and a bare title fee (held, as on main).
  [15, ["Loan Fees", "Skip-a-Loan payment | $25 per request", "Title Fee | $18.00", "Stop Payment | $30.00"].join("\n")],
]);

const liveFee: LiveFeeRow = {
  fee_published_id: 1, institution_id: 3, institution_name: "Crow Wing Power CU", canonical_fee_key: "stop_payment", fee_name: "Stop Payment (single check)",
  raw_fee_name: "Stop Payment (single check)", amount: 35, amount_kind: "flat", rate_percent: null, frequency: null, variant_type: null, fee_audience: "consumer", product_name: null,
  published_at: "2026-10-01T00:00:00Z", source_url: "https://cw.example/fees", source_document_id: 7, document_crawled_at: "2026-09-01T00:00:00Z",
  document_stream: null, document_url: "https://cw.example/fees",
};

const sectionFee = (id: number, documentId: number, key: string, name: string, amount: number, audience: string): LiveFeeRow => ({
  ...liveFee, fee_published_id: id, institution_id: 4, institution_name: "Bank S", canonical_fee_key: key, fee_name: name, raw_fee_name: name, amount, fee_audience: audience,
  source_url: null, source_document_id: documentId, document_url: null,
});
const SECTION_FEES = [
  sectionFee(70, 9, "monthly_maintenance", "Regular Checking Accounts (CK03) Monthly service charge", 5, "both"),
  sectionFee(71, 9, "early_closure", "Closed Account Fee", 10, "both"),
  sectionFee(72, 11, "early_closure", "Account Closing Fee", 25, "unknown"),
];
const VOCABULARY_FEES = [
  { ...sectionFee(80, 15, "late_payment", "Skip-a-Loan payment", 25, "unknown"), institution_id: 5, institution_name: "Bank V" },
  { ...sectionFee(81, 15, "stop_payment", "Stop Payment", 30, "unknown"), institution_id: 5, institution_name: "Bank V" },
];

function reader(): SwitchAuditReader & { calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = { sourceTexts: [], liveFeesAt: [], caps: [], scan: [] };
  const fresh: FreshAuditResult = { readable: true, seed: "2026-11-01", categoryGuardVersion: 1, sourceCheckVersion: 28, ...scoreFreshAudit([], new Map()), sampled: 10, scorable: 8, noText: 2, amountMiss: 1, categoryMiss: 1, right: 5 };
  return {
    calls,
    dailyCapRows: vi.fn(async (limit: number) => {
      calls.caps.push(limit);
      return [capRow(1, 100, "Paid Overdraft Charge daily maximum", 150), capRow(2, 200, "Overdraft Daily Cap", 175)];
    }),
    sourceTexts: vi.fn(async (ids: number[]) => {
      calls.sourceTexts.push(ids);
      return new Map(ids.filter((id) => TEXTS.has(id)).map((id) => [id, TEXTS.get(id) as string]));
    }),
    dashListDocuments: vi.fn(async (limit: number, offset: number) => {
      calls.scan.push([limit, offset]);
      return { scanned: 2, documents: [{ source_document_id: 7, institution_id: 3, institution_name: "Crow Wing Power CU", document_url: "https://cw.example/fees", crawled_at: "2026-09-01T00:00:00Z", document_stream: null }] };
    }),
    sectionPathDocuments: vi.fn(async () => ({
      scanned: 2,
      documents: [9, 11].map((id) => ({ source_document_id: id, institution_id: 4, institution_name: "Bank S", document_url: null, crawled_at: null, document_stream: null })),
    })),
    heldVocabularyDocuments: vi.fn(async () => ({
      scanned: 1,
      documents: [{ source_document_id: 15, institution_id: 5, institution_name: "Bank V", document_url: null, crawled_at: null, document_stream: null }],
    })),
    liveFeesAt: vi.fn(async (ids: number[]) => {
      calls.liveFeesAt.push(ids);
      return [liveFee, ...SECTION_FEES, ...VOCABULARY_FEES].filter((fee) => ids.includes(Number(fee.institution_id)));
    }),
    limitRows: vi.fn(async () => [{ fee_published_id: 50, institution_id: 10, institution_name: "Bank A", source_document_id: 100, canonical_fee_key: "zelle_fee", fee_name: "Zelle", amount: 150, conditions: 'excerpt="Zelle | $150 Limit"' }]),
    excerptLimitTakedowns: vi.fn(async () => [{ fee_published_id: 60, institution_id: 10, institution_name: "Bank A", canonical_fee_key: "zelle_fee", fee_name: "Zelle", amount: 200, rolled_back_reason: "limit_as_fee:source_states_limit: x", live_names: [] }]),
    atmHeadingRows: vi.fn(async () => [{
      fee_raw_id: 80, institution_id: 12, institution_name: "Bank T", source_document_id: 13, raw_name: "Balance inquiry", raw_amount: 0.75,
      fee_verified_id: 81, review_status: "verified", verified_key: "balance_inquiry", verified_name: "Balance inquiry", verified_amount: 0.75,
      fee_published_id: null, published_key: null, published_name: null, published_amount: null, live: null,
    }]),
    liveNonNetworkFees: vi.fn(async () => [
      { fee_published_id: 90, lineage_ref: 90, institution_id: 12, institution_name: "Bank T", source_document_id: 13, text_hash: "t13", canonical_fee_key: "atm_non_network",
        fee_name: "Withdrawal (per transaction)", amount: 2, raw_fee_name: "Withdrawal (per transaction)", fee_audience: "consumer", pulled: false, lesson_flag: null, name_filed: false },
    ]),
    documentTexts: vi.fn(async (ids: number[]) => {
      calls.sourceTexts.push(ids);
      return new Map(ids.filter((id) => TEXTS.has(id)).map((id) => [id, [{ id: 1, source_document_id: id, text_hash: `t${id}`, normalized_text: TEXTS.get(id) as string }]]));
    }),
    // #1092: the shadow lab's "No Fee for Stop Payments" in a list of free items, and the bank's own
    // $0 notary row under its heading (state key 5608's line), which stays.
    zeroWaiverRowRows: vi.fn(async () => [
      { fee_published_id: 64331, fee_verified_id: 1, institution_id: 20, fee_name: "Stop Payments", canonical_fee_key: "stop_payment",
        source_line: 'Knox read a free fee from Rosetta artifact #31. excerpt="No Fee for Stop Payments"', artifact_id: 31 },
      { fee_published_id: 5608, fee_verified_id: 2, institution_id: 21, fee_name: "notarization of Bank documents", canonical_fee_key: "notary_fee",
        source_line: 'Knox read a free fee from Rosetta artifact #32. excerpt="No charge for notarization of Bank documents."', artifact_id: 32 },
      { fee_published_id: 9, fee_verified_id: 3, institution_id: 22, fee_name: "Stop Payments", canonical_fee_key: "stop_payment",
        source_line: 'excerpt="No Fee for Stop Payments"', artifact_id: null },
    ]),
    htmlReaderExposure: vi.fn(async () => [
      { reader: "legacy", documents: 2, institutions: 2, documents_with_live_fees: 1, live_fees: 9 },
      { reader: "read.html_dom", documents: "6", institutions: "5", documents_with_live_fees: "4", live_fees: "52" },
      { reader: "read.js_fallback", documents: 1, institutions: 1, documents_with_live_fees: 1, live_fees: 9 },
    ]),
    pdfReaderExposure: vi.fn(async () => [
      { reader: "legacy", documents: 2, institutions: 2, documents_with_live_fees: 1, live_fees: 9 },
      { reader: "read.ocr_tesseract", documents: 3, institutions: 3, documents_with_live_fees: 2, live_fees: 14 },
      { reader: "read.pdf_layout", documents: "40", institutions: "31", documents_with_live_fees: "22", live_fees: "310" },
    ]),
    zeroWaiverRowTexts: vi.fn(async (ids: number[]) => new Map([
      [31, "Elite Checking Package:\nNo Fee for Cashier’s Checks\n\nNo Fee for Stop Payments\n\n$1,000 Overdraft Service"],
      [32, "Notary Service\n\nNo charge for notarization of Bank documents.\n\n$10 per signature for notarization of non-Bank documents"],
    ].filter(([id]) => ids.includes(id as number)) as Array<[number, string]>)),
    // #1092 (state key 5608): River City's online banking row would come down; an account's own row stays.
    // Paged by fee id as the SQL pages it; with a row cap of 2 the account's row (7002) is left unjudged.
    serviceMaintenanceRows: vi.fn(async (limit: number, afterId: number) => SERVICE_ROWS.filter((row) => row.fee_published_id > afterId).slice(0, limit)),
    serviceMaintenanceRemaining: vi.fn(async (afterId: number) => SERVICE_ROWS.filter((row) => row.fee_published_id > afterId).length),
    serviceMaintenanceTexts: vi.fn(async (ids: number[]) => new Map([
      [41, "Consumer Online Banking Services and Mobile Banking Fees\n\nSet Up Fee | No charge\n\nMonthly Maintenance Fee | No charge"],
      [42, "Personal Checking\n\nMonthly Maintenance Fee | $8.00\n\nOnline Banking\n\nBill Pay | Free"],
    ].filter(([id]) => ids.includes(id as number)) as Array<[number, string]>)),
    freshAudit: vi.fn(async () => fresh),
  };
}

const SERVICE_ROWS = [
      { fee_published_id: 10, fee_verified_id: 6, institution_id: 32, fee_name: "Monthly Maintenance Fee", amount: 0,
        source_line: 'excerpt="Monthly Maintenance Fee | No charge"', artifact_id: null },
      { fee_published_id: 5608, fee_verified_id: 4, institution_id: 30, fee_name: "Monthly Maintenance Fee", amount: 0,
        source_line: 'Knox read a free fee from Rosetta artifact #41. excerpt="Monthly Maintenance Fee | No charge"', artifact_id: 41 },
      { fee_published_id: 7002, fee_verified_id: 5, institution_id: 31, fee_name: "Monthly Maintenance Fee", amount: 8,
        source_line: 'Knox deterministic extraction from Rosetta artifact #42. excerpt="Monthly Maintenance Fee | $8.00"', artifact_id: 42 },
];

describe("switch dry runs: one pass over every pending count", () => {
  it("should_count_each_section_from_the_reader_a_chunk_of_documents_at_a_time", async () => {
    const mock = reader();
    const options = { ...DEFAULT_SWITCH_AUDIT_OPTIONS, chunkSize: 1, rowCap: 2, sampleCap: 5, accuracySample: 10, maxDocuments: 2, scanOffset: 4 };
    const report = await runSwitchDryRuns(mock, options, new Date("2026-11-01T12:00:00Z"));
    // Cap rows: document 100's $150 cap gains the trace; document 200's $175 traces either way.
    expect(report.dailyCapLines.summary).toMatchObject({ rows: 2, nowTraces: 1, liveNowTraces: 0, nowTracesLines: 1, gainLines: 1, alreadyLiveSamePriceLines: 0, priceChangeLines: 0, stopsTracing: 0, noText: 0 });
    expect(report.dailyCapLines.summary.byTier.held).toEqual({ rows: 2, noText: 0, nowTraces: 1, stopsTracing: 0 });
    // Two rows came back against a cap of two, so the count says it may be short.
    expect(report.dailyCapLines.rowsRead).toEqual({ read: 2, cap: 2, truncated: true });
    // One document per chunk: texts for 100, then 200, then the dash list document 7.
    expect(mock.calls.sourceTexts).toEqual([[100], [200], [7], [9], [11], [13], [13], [15]]);
    expect(mock.calls.liveFeesAt).toEqual([[3], [4], [4], [5]]);
    // The bound and the offset reach the scan itself; 2 scanned of a bound of 2, so more remain.
    expect(mock.calls.scan).toEqual([[2, 4]]);
    expect(report.dashListRows.scan).toEqual({ offset: 4, bound: 2, scanned: 2, truncated: true, nextOffset: 6 });
    expect(report.dashListRows.documentsMatched).toBe(1);
    // Dash list: the live $35 single check is no longer read, and its $20 would publish beside it.
    expect(report.dashListRows.summary).toMatchObject({ documentsRead: 1, documentsWithRuns: 1, documentsChanged: 1, lost: 1, beside: 1 });
    expect(report.dashListRows.summary.watch).toHaveLength(1);
    // The JSON carries the steps the replay leaves out.
    expect(report.dashListRows.notReplayed.length).toBeGreaterThan(0);
    expect(report.excerptAtPublish.summary).toMatchObject({ liveHeld: 1, takenDown: 1 });
    expect(report.excerptAtPublish.mapsToSwitch).toBe(false);
    // Section path: nothing on the grandfathered document changes (the switch holds nothing); the business closing fee is relabelled from unknown.
    expect(report.sectionPath.summary).toMatchObject({ documents: 2, documentsChanged: 1, feesRead: 3, relabels: 1, relabelsWritten: 1, relabelsByChange: { "unknown->business": 1 } });
    // v161: the live late fee at the skipped payment's price could be re-filed with the switch on; the
    // skipped payment is a new read, which publishes whatever the switch says; the bare title fee stays held.
    expect(report.heldVocabulary.summary).toMatchObject({
      documents: 1, documentsChanged: 1, feesRead: 2, refiles: 1, renames: 0,
      byChange: { "late_payment->other_lending_fee": 1 },
      newReads: 1, newReadsByCategory: { other_lending_fee: 1 },
    });
    // Marked ATM heading: the verified $0.75 inquiry under "Non-TBT or Non-Allpoint ATM1:" re-files in.
    expect(report.footnotedAtmHeading.summary).toMatchObject({ rows: 1, changed: 1, wouldRefileIn: 1, liveWouldRefileIn: 0 });
    // Every live atm_non_network fee the re-check reads is judged on its own text, switch off and on.
    expect(report.footnotedAtmHeading.summary.liveNonNetwork).toMatchObject({ fees: 1, documents: 1, noText: 0, wouldLeave: 0 });
    // Waiver-row $0s: the list item would come down, the notary row stays, the textless row is not judged.
    expect(report.zeroWaiverRow.summary).toMatchObject({
      checked: 3, noText: 1, wouldTakeDown: 1, institutions: 1, byKind: { no_fee_sentence: 1, waiver_requirement: 0, avoid_fee_advice: 0 }, byCategory: { stop_payment: 1 },
    });
    expect(report.zeroWaiverRow.summary.samples.map((m) => m.feePublishedId)).toEqual([64331]);
    // Service-heading monthly maintenance: the online banking row would come down, the account's row stays.
    expect(report.serviceMaintenance.summary).toMatchObject({
      checked: 2, noText: 1, unconfirmed: 0, unjudged: 1, wouldTakeDown: 1, alsoNotAccountFeeLine: 0, institutions: 1, free: 1, priced: 0, byServices: { "online_banking+mobile_banking": 1 },
    });
    expect(report.serviceMaintenance.summary.samples.map((m) => m.feePublishedId)).toEqual([5608]);
    // Fresh audit: 8 scorable - 1 amount - 1 category = 6 of 8.
    expect(report.liveAccuracy).toMatchObject({ amountAndCategory: 6, share: 0.75, right: 5 });
    expect(mock.freshAudit).toHaveBeenCalledWith(10);
    // HTML row pairing: exposure by reader, never a text diff (the bytes are in the vault).
    expect(report.htmlRowPairing.summary).toMatchObject({
      html: { documents: 7, documentsWithLiveFees: 5, liveFees: 61 },
      legacy: { documents: 2, documentsWithLiveFees: 1, liveFees: 9 },
      textDiffed: false,
    });
    // PDF column reading: the same exposure statement over the PDF layout readers, never a text diff.
    expect(report.pdfColumnReading.summary).toMatchObject({
      pdf: { documents: 43, documentsWithLiveFees: 24, liveFees: 324 },
      legacy: { documents: 2, documentsWithLiveFees: 1, liveFees: 9 },
      textDiffed: false,
    });
    expect(mock.pdfReaderExposure).toHaveBeenCalledTimes(1);
  });

  it("should_print_every_section_with_its_totals", async () => {
    const report = await runSwitchDryRuns(reader(), { ...DEFAULT_SWITCH_AUDIT_OPTIONS, rowCap: 2, maxDocuments: 2 }, new Date("2026-11-01T12:00:00Z"));
    const text = formatSwitchDryRuns(report);
    expect(text).toContain("## 1. DAILY_CAP_LINES_LIVE");
    expect(text).toContain("Gains: 1 fee lines newly trace with nothing of that name live at the institution");
    expect(text).toContain("LIVE PRICE WOULD CHANGE: 0 lines");
    expect(text).toContain("Would publish beside a live price elsewhere: 0 lines");
    expect(text).toContain("Live price stays: 0 lines");
    expect(text).toContain("0 already fail today on Knox's excerpt (not caused by the switch)");
    expect(text).toContain("NOT REPLAYED (each can move these counts):");
    expect(text).toContain("NOT ASSESSED");
    expect(text).toContain("CAP 2 REACHED");
    expect(text).toContain("Scan bound (--max-documents, applied before any text is read): candidates 0 to 2; 2 scanned, 1 print a dash list line. BOUND REACHED");
    expect(text).toContain("--scan-offset 2");
    expect(text).toContain("run it off-peak");
    expect(text).toContain("Darwin's verified recheck on those 0 live rows");
    expect(text).toContain("Live fees today's reading reads and the switch-on reading no longer reads: 1.");
    expect(text).toContain("would publish beside a same-named live fee of the category and audience at another price: 1.");
    expect(text).toContain("read today: yes | read switch on: no | switch-on price(s): $20.00");
    expect(text).toContain("Maps to no live switch");
    expect(text).toContain("## 4. SECTION_PATH_LIVE (#1092)");
    expect(text).not.toContain("WOULD COME DOWN (trace today");
    expect(text).toContain("unknown -> business (relabel writes)");
    expect(text).toContain("## 5. FOOTNOTED_ATM_HEADING_LIVE (#1092");
    expect(text).toContain("## 6. HELD_VOCABULARY_RELABEL_LIVE (#1092, Knox v161)");
    expect(text).toContain("Switch on, the live-correction paths could re-file at most 1 live fees and rename 0 (live -> added read: late_payment->other_lending_fee 1).");
    expect(text).toContain('refile: other_lending_fee "Skip-a-Loan payment"');
    expect(text).toContain("LIVE RE-FILE: 1 live or verified fees would be re-filed into atm_non_network by Hamilton's fold step (0 of them live).");
    expect(text).toContain("LIVE TAKEDOWN RISK: 0 live atm_non_network fees pass the re-check today and fail it with the switch on");
    expect(text).toContain("Of 1 live fees on 1 documents:");
    expect(text).toContain("## 7. ZERO_WAIVER_ROW_TAKEDOWN_LIVE (#1092, Knox v163)");
    expect(text).toContain("LIVE TAKEDOWN: switched on, 1 of 3 selected live $0 fees at 1 institutions would come down");
    expect(text).toContain("## 8. HTML_ROW_PAIRING_LIVE (#1092, Rosetta read.html_dom)");
    expect(text).toContain("cannot re-read a page or say how many stored texts would change");
    expect(text).toContain("EXPOSED: 7 current HTML documents (5 with live fees) carry 61 live fees");
    expect(text).toContain("Legacy texts with no reader recorded (format unknown): 2 documents, 9 live fees.");
    expect(text).toContain("## 9. SERVICE_MAINTENANCE_TAKEDOWN_LIVE (#1092, Knox v174)");
    expect(text).toContain("LIVE TAKEDOWN: switched on, 1 of 2 selected live monthly maintenance fees at 1 institutions would come down");
    expect(text).toContain("1 live monthly maintenance fees past the row cap were left unjudged (re-run with a higher --row-cap)");
    expect(text).toContain("## 10. PDF_COLUMN_READING_LIVE (#1092, Rosetta read.pdf_layout)");
    expect(text).toContain("EXPOSED: 43 current PDF documents (24 with live fees) carry 324 live fees");
    expect(text).toContain("  read.pdf_layout: 40 documents at 31 institutions, 22 with live fees, 310 live fees");
    expect(text).toContain("## 11. Live accuracy");
    // The daily receipt's own figure leads; the derived share follows, labelled.
    const receipt = text.indexOf("Daily receipt's figure (right on amount, category, source, fee line and name): 5 / 8 = 62.50%");
    const derived = text.indexOf("Amount and category only (not the receipt's figure): 6 / 8 = 75.00%");
    expect(receipt).toBeGreaterThan(0);
    expect(derived).toBeGreaterThan(receipt);
  });
});

describe("switch dry runs: flags", () => {
  it("should_read_the_flags_and_refuse_unknown_or_bad_ones", () => {
    expect(parseSwitchAuditArgs([])).toEqual({ json: false, options: DEFAULT_SWITCH_AUDIT_OPTIONS });
    expect(parseSwitchAuditArgs(["--json", "--sample", "5", "--max-documents=100"]).options).toMatchObject({ sampleCap: 5, maxDocuments: 100 });
    expect(parseSwitchAuditArgs(["--json"]).json).toBe(true);
    expect(() => parseSwitchAuditArgs(["--write"])).toThrow(/unknown flag/);
    expect(() => parseSwitchAuditArgs(["--sample", "0"])).toThrow(/whole number/);
    expect(() => parseSwitchAuditArgs(["--row-cap"])).toThrow(/whole number/);
    expect(parseSwitchAuditArgs(["--institution", "3,10"]).options.institutionIds).toEqual([3, 10]);
    expect(parseSwitchAuditArgs(["--scan-offset", "0"]).options.scanOffset).toBe(0);
    expect(parseSwitchAuditArgs(["--scan-offset=3000"]).options.scanOffset).toBe(3000);
    expect(() => parseSwitchAuditArgs(["--scan-offset", "-1"])).toThrow(/0 or more/);
    expect(() => parseSwitchAuditArgs(["--institution", "3,x"])).toThrow(/whole number/);
  });
});
