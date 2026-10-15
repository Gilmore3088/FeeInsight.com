import { describe, expect, it } from "vitest";
import { pageCopyRepeats, sameScheduleText, type PageCopyRow } from "./page-copy-collapse";

const row = (over: Partial<PageCopyRow>): PageCopyRow => ({
  fee_published_id: 1,
  institution_id: 7,
  source_document_id: 100,
  document_url: "https://www.bank.com/fee-schedule.pdf",
  crawled_at: "2026-10-01",
  canonical_fee_key: "stop_payment",
  variant_type: null,
  amount: 30,
  fee_name: "Stop Payment",
  frequency: "per_item",
  fee_audience: "unknown",
  ...over,
});

const TEXT = "Fee Schedule Stop Payment $30.00 Cashier's Check $10.00 Wire Transfer Incoming $15.00 Outgoing $25.00";
const both = new Map([["100", TEXT], ["200", TEXT]]);

describe("pageCopyRepeats (#1439)", () => {
  it("closes the older copy of a line read from the same page under another address", () => {
    const older = row({ fee_published_id: 1, source_document_id: 100, document_url: "https://bank.com/fee-schedule.pdf?print=1", crawled_at: "2026-09-01" });
    const newer = row({ fee_published_id: 2, source_document_id: 200, document_url: "https://www.bank.com/fee%20schedule.pdf", crawled_at: "2026-10-10" });
    const found = pageCopyRepeats([older, newer], both);
    expect(found.collapses).toEqual([
      expect.objectContaining({ feePublishedId: 1, keptFeePublishedId: 2, sourceDocumentId: 100, keptSourceDocumentId: 200 }),
    ]);
  });

  it("reads a near name as the same line (\"Stop Payments\" / \"Stop Payment\")", () => {
    const older = row({ fee_published_id: 1, source_document_id: 100, fee_name: "Stop Payments" });
    const newer = row({ fee_published_id: 2, source_document_id: 200, crawled_at: "2026-10-10" });
    expect(pageCopyRepeats([older, newer], both).collapses).toHaveLength(1);
  });

  it("leaves rows of one document, other pages, and stated frequency or audience conflicts alone", () => {
    const sameDoc = [row({ fee_published_id: 1 }), row({ fee_published_id: 2 })];
    expect(pageCopyRepeats(sameDoc, both).pairs).toBe(0);
    const otherPage = [row({ fee_published_id: 1 }), row({ fee_published_id: 2, source_document_id: 200, document_url: "https://bank.com/business-fees.pdf" })];
    expect(pageCopyRepeats(otherPage, both).pairs).toBe(0);
    const frequency = [row({ fee_published_id: 1, frequency: "monthly" }), row({ fee_published_id: 2, source_document_id: 200, crawled_at: "2026-10-10", frequency: "per_item" })];
    expect(pageCopyRepeats(frequency, both).pairs).toBe(0);
    const audience = [row({ fee_published_id: 1, fee_audience: "business" }), row({ fee_published_id: 2, source_document_id: 200, crawled_at: "2026-10-10", fee_audience: "consumer" })];
    expect(pageCopyRepeats(audience, both).pairs).toBe(0);
  });

  it("keeps both when the newest copy has no text or does not print the kept line at the price", () => {
    const rows = [row({ fee_published_id: 1 }), row({ fee_published_id: 2, source_document_id: 200, crawled_at: "2026-10-10" })];
    expect(pageCopyRepeats(rows, new Map()).unproven).toBe(1);
    expect(pageCopyRepeats(rows, new Map([["100", TEXT], ["200", "Stop Payment $25.00"]])).collapses).toHaveLength(0);
  });

  it("keeps two lines the newest copy prints apart at the price", () => {
    const text = "Stop Payment $30.00 ACH Stop Payment $30.00";
    const rows = [
      row({ fee_published_id: 1, fee_name: "ACH Stop Payment" }),
      row({ fee_published_id: 2, source_document_id: 200, crawled_at: "2026-10-10" }),
    ];
    const found = pageCopyRepeats(rows, new Map([["100", text], ["200", text]]));
    expect(found.apartOnPage).toBe(1);
    expect(found.collapses).toHaveLength(0);
  });

  it("keeps both when two documents share a page key but not their prices or audience (\"?id=101\" / \"?id=202\")", () => {
    const business = "Business Account Fees Stop Payment $30.00 Account Analysis $15.00 Deposited Item $0.12 Night Deposit Bag $25.00";
    const letter = "Fee changes: Stop Payment $30.00 Overdraft $35.00 Statement copy $3.00 Research $20.00 Coin $1.00";
    const rows = [
      row({ fee_published_id: 1, source_document_id: 100, document_url: "https://bank.com/disclosure.aspx?id=101", fee_name: "Stop Payments" }),
      row({ fee_published_id: 2, source_document_id: 200, document_url: "https://bank.com/disclosure.aspx?id=202", crawled_at: "2026-10-10" }),
    ];
    // A consumer and a business schedule from one template share most prices; the audiences differ.
    const found = pageCopyRepeats(rows, new Map([["100", business], ["200", `Personal ${TEXT}`]]));
    expect(found.otherDocument).toBe(1);
    expect(found.collapses).toHaveLength(0);
    expect(pageCopyRepeats(rows, new Map([["100", letter], ["200", TEXT]])).otherDocument).toBe(1);
    expect(found.collapses).toHaveLength(0);
    expect(pageCopyRepeats(rows, new Map([["200", TEXT]])).otherDocument).toBe(1);
  });

  it("keeps a line the newest copy prints under both a personal and a business heading (#1302)", () => {
    const text = "SCHEDULE OF FEES FOR PERSONAL ACCOUNTS Visa Gift Cards, each: $4.25 SCHEDULE OF FEES FOR BUSINESS ACCOUNTS Visa Gift Cards, each: $4.25";
    const rows = [
      row({ fee_published_id: 1, canonical_fee_key: "gift_card", amount: 4.25, fee_name: "Visa Gift Card" }),
      row({ fee_published_id: 2, source_document_id: 200, canonical_fee_key: "gift_card", amount: 4.25, fee_name: "Visa Gift Cards", crawled_at: "2026-10-10" }),
    ];
    const found = pageCopyRepeats(rows, new Map([["100", text], ["200", text]]));
    expect(found.apartOnPage).toBe(1);
    expect(found.collapses).toHaveLength(0);
  });

  it("reads one schedule's prices through another layout, and a change letter as another document", () => {
    const columns = "Fee Schedule Stop Payment Cashier's Check Wire Transfer Incoming Outgoing $30.00 $10.00 $15.00 $25.00";
    expect(sameScheduleText(TEXT, columns)).toBe(true);
    expect(sameScheduleText(TEXT, "General Fee Changes effective August 1, 2026: Stop Payment $30.00")).toBe(false);
  });

  it("keeps the copy from the latest stated edition, not the latest read", () => {
    const july = `Effective July 1, 2025 ${TEXT}`;
    const january = `Effective January 1, 2025 ${TEXT}`;
    const rows = [
      row({ fee_published_id: 1, source_document_id: 100, document_url: "https://bank.com/Fees-July-1-2025.pdf", crawled_at: "2026-09-01" }),
      row({ fee_published_id: 2, source_document_id: 200, document_url: "https://bank.com/Fees-January-1-2025.pdf", crawled_at: "2026-10-10" }),
    ];
    const found = pageCopyRepeats(rows, new Map([["100", july], ["200", january]]));
    expect(found.collapses).toEqual([expect.objectContaining({ feePublishedId: 2, keptFeePublishedId: 1 })]);
  });
});
