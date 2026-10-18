import { describe, expect, it, vi } from "vitest";
import type { PageCopyRow } from "./page-copy-collapse";
import { inFoldedCategory, pageCopyKeeper, selectPageCopyKeeper } from "./page-copy-refuse";

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
const CANDIDATE = Number.MAX_SAFE_INTEGER;

describe("pageCopyKeeper: refuse at publish what the page-copy collapse would close", () => {
  it("refuses an older copy of a line already live from the newer copy of the page", () => {
    const live = row({ fee_published_id: 5, source_document_id: 200, document_url: "https://www.bank.com/fee%20schedule.pdf", crawled_at: "2026-10-10" });
    const candidate = row({ fee_published_id: CANDIDATE, source_document_id: 100, document_url: "https://bank.com/fee-schedule.pdf?print=1", crawled_at: "2026-09-01" });
    expect(pageCopyKeeper(candidate, [live], both)).toBe(5);
  });

  it("publishes the newer edition (the collapse then closes the older live copy)", () => {
    const live = row({ fee_published_id: 5, source_document_id: 100, document_url: "https://bank.com/fee-schedule.pdf?print=1", crawled_at: "2026-09-01" });
    const candidate = row({ fee_published_id: CANDIDATE, source_document_id: 200, document_url: "https://www.bank.com/fee%20schedule.pdf", crawled_at: "2026-10-10" });
    expect(pageCopyKeeper(candidate, [live], both)).toBeNull();
  });

  it("publishes when the copy is another page, another audience, or unproven by the kept text", () => {
    const candidate = row({ fee_published_id: CANDIDATE, source_document_id: 100, crawled_at: "2026-09-01" });
    expect(pageCopyKeeper(candidate, [row({ fee_published_id: 5, source_document_id: 200, document_url: "https://bank.com/business-fees.pdf", crawled_at: "2026-10-10" })], both)).toBeNull();
    expect(pageCopyKeeper({ ...candidate, fee_audience: "consumer" }, [row({ fee_published_id: 5, source_document_id: 200, crawled_at: "2026-10-10", fee_audience: "business" })], both)).toBeNull();
    expect(pageCopyKeeper(candidate, [row({ fee_published_id: 5, source_document_id: 200, crawled_at: "2026-10-10" })], new Map())).toBeNull();
  });

  it("an equal edition read at the same time keeps the row the step inserts last", () => {
    const live = row({ fee_published_id: 5, source_document_id: 200, document_url: "https://bank.com/fee-schedule.pdf?print=1" });
    const candidate = row({ fee_published_id: CANDIDATE, source_document_id: 100, document_url: "https://www.bank.com/fee-schedule.pdf" });
    // Same read time: the higher document id wins first, as in the collapse.
    expect(pageCopyKeeper(candidate, [live], both)).toBe(5);
  });
});

describe("inFoldedCategory: a twin joins the row's split category only when its own name splits", () => {
  it("moves a returned mail twin filed under account research, and leaves a research line put", () => {
    expect(inFoldedCategory({ canonical_fee_key: "account_research", fee_name: "Returned Mail" }, "returned_mail")).toBe(true);
    expect(inFoldedCategory({ canonical_fee_key: "account_research", fee_name: "Account Research (per hour)" }, "returned_mail")).toBe(false);
    expect(inFoldedCategory({ canonical_fee_key: "returned_mail", fee_name: "Return Mail" }, "returned_mail")).toBe(true);
  });

  it("never pairs the row with a near-name twin that stays under the old category", async () => {
    // The row ("Address Research") moves to returned mail; the live twin "Research" does not,
    // so the collapse, which groups by category, never closes the row behind it.
    const live = [{ fee_published_id: 5, institution_id: 7, source_document_id: 200, document_url: "https://www.bank.com/fee-schedule.pdf",
      crawled_at: "2026-10-10", superseded: false, superseded_by_id: null, canonical_fee_key: "account_research", variant_type: null,
      amount: 30, fee_name: "Research", frequency: "per_item", fee_audience: "unknown" }];
    const own = [{ document_url: "https://bank.com/fee-schedule.pdf?print=1", crawled_at: "2026-09-01", superseded: false, superseded_by_id: null }];
    const texts = [{ source_document_id: 100, normalized_text: "Fee Schedule Research $30.00 Cashier Check $10.00 Wire Transfer $15.00" }, { source_document_id: 200, normalized_text: "Fee Schedule Research $30.00 Cashier Check $10.00 Wire Transfer $15.00" }];
    const replies = [live, own, texts];
    const db = vi.fn(async () => replies.shift() ?? []);
    const keeper = await selectPageCopyKeeper(db as unknown as Parameters<typeof selectPageCopyKeeper>[0], {
      institutionId: 7, canonicalFeeKey: "account_research", variantType: null, amount: 30, feeName: "Address Research",
      frequency: "per_item", feeAudience: "unknown", sourceDocumentId: 100,
    });
    expect(keeper).toBeNull();
  });
});

describe("selectPageCopyKeeper", () => {
  const candidate = {
    institutionId: 7, canonicalFeeKey: "stop_payment", variantType: null, amount: 30, feeName: "Stop Payment",
    frequency: "per_item", feeAudience: "unknown", sourceDocumentId: 100,
  };

  it("reads no further when no other document has the line live", async () => {
    const db = vi.fn(async () => []);
    expect(await selectPageCopyKeeper(db as unknown as Parameters<typeof selectPageCopyKeeper>[0], candidate)).toBeNull();
    expect(db).toHaveBeenCalledTimes(1);
  });

  it("refuses nothing when the read fails", async () => {
    const db = vi.fn(async () => { throw new Error("boom"); });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await selectPageCopyKeeper(db as unknown as Parameters<typeof selectPageCopyKeeper>[0], candidate)).toBeNull();
    spy.mockRestore();
  });
});
