import { describe, expect, it } from "vitest";
import { pageCopyRepeats, type PageCopyRow } from "./page-copy-collapse";

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

const TEXT = "Fee Schedule Stop Payment $30.00 Cashier's Check $10.00";

describe("pageCopyRepeats (#1439)", () => {
  it("closes the older copy of a line read from the same page under another address", () => {
    const older = row({ fee_published_id: 1, source_document_id: 100, document_url: "https://bank.com/fee-schedule.pdf?print=1", crawled_at: "2026-09-01" });
    const newer = row({ fee_published_id: 2, source_document_id: 200, document_url: "https://www.bank.com/fee%20schedule.pdf", crawled_at: "2026-10-10" });
    const found = pageCopyRepeats([older, newer], new Map([["200", TEXT]]));
    expect(found.collapses).toEqual([
      expect.objectContaining({ feePublishedId: 1, keptFeePublishedId: 2, sourceDocumentId: 100, keptSourceDocumentId: 200 }),
    ]);
  });

  it("reads a near name as the same line (\"Stop Payments\" / \"Stop Payment\")", () => {
    const older = row({ fee_published_id: 1, source_document_id: 100, fee_name: "Stop Payments" });
    const newer = row({ fee_published_id: 2, source_document_id: 200, crawled_at: "2026-10-10" });
    expect(pageCopyRepeats([older, newer], new Map([["200", TEXT]])).collapses).toHaveLength(1);
  });

  it("leaves rows of one document, other pages, and stated frequency or audience conflicts alone", () => {
    const sameDoc = [row({ fee_published_id: 1 }), row({ fee_published_id: 2 })];
    expect(pageCopyRepeats(sameDoc, new Map([["100", TEXT]])).pairs).toBe(0);
    const otherPage = [row({ fee_published_id: 1 }), row({ fee_published_id: 2, source_document_id: 200, document_url: "https://bank.com/business-fees.pdf" })];
    expect(pageCopyRepeats(otherPage, new Map([["200", TEXT]])).pairs).toBe(0);
    const frequency = [row({ fee_published_id: 1, frequency: "monthly" }), row({ fee_published_id: 2, source_document_id: 200, crawled_at: "2026-10-10", frequency: "per_item" })];
    expect(pageCopyRepeats(frequency, new Map([["200", TEXT]])).pairs).toBe(0);
    const audience = [row({ fee_published_id: 1, fee_audience: "business" }), row({ fee_published_id: 2, source_document_id: 200, crawled_at: "2026-10-10", fee_audience: "consumer" })];
    expect(pageCopyRepeats(audience, new Map([["200", TEXT]])).pairs).toBe(0);
  });

  it("keeps both when the newest copy has no text or does not print the kept line at the price", () => {
    const rows = [row({ fee_published_id: 1 }), row({ fee_published_id: 2, source_document_id: 200, crawled_at: "2026-10-10" })];
    expect(pageCopyRepeats(rows, new Map()).unproven).toBe(1);
    expect(pageCopyRepeats(rows, new Map([["200", "Stop Payment $25.00"]])).collapses).toHaveLength(0);
  });

  it("keeps two lines the newest copy prints apart at the price", () => {
    const text = "Stop Payment $30.00 ACH Stop Payment $30.00";
    const rows = [
      row({ fee_published_id: 1, fee_name: "ACH Stop Payment" }),
      row({ fee_published_id: 2, source_document_id: 200, crawled_at: "2026-10-10" }),
    ];
    const found = pageCopyRepeats(rows, new Map([["200", text]]));
    expect(found.apartOnPage).toBe(1);
    expect(found.collapses).toHaveLength(0);
  });
});
