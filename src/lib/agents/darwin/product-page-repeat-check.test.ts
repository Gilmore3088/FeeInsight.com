import { describe, expect, it, vi } from "vitest";

import {
  PRODUCT_PAGE_REPEAT_CHECK,
  PRODUCT_PAGE_REPEAT_CHECK_VERSION,
  findProductPageRepeats,
  recheckProductPageRepeats,
  repeatsScheduleLine,
  type ProductPageRepeatRow,
  type ProductPageRepeatTwin,
} from "./product-page-repeat-check";

const TD_CAMPAIGN = "https://www.td.com/us/en/personal-banking/checking-accounts?cm_sp=b000-80-0591";

// TD Bank (12), prod read-only 2026-10-20: the checking campaign page's "Paper statements" $3 live
// beside the fee schedule PDF's "Paper statement (per statement cycle)" $3 (#1910).
const TD_TWIN: ProductPageRepeatTwin = {
  fee_published_id: "68015", fee_name: "Paper statement (per statement cycle)", frequency: "monthly", fee_audience: "consumer", product_name: null, source_document_id: "19991",
};
const TD_ROW: ProductPageRepeatRow = {
  fee_published_id: "64717",
  fee_verified_id: "68895",
  institution_id: "12",
  fee_name: "Paper statements",
  amount: "3.00",
  canonical_fee_key: "paper_statement",
  frequency: "monthly",
  fee_audience: "consumer",
  product_name: null,
  source_document_id: "19132",
  document_url: TD_CAMPAIGN,
  twins: [TD_TWIN],
};

function row(overrides: Partial<ProductPageRepeatRow>): ProductPageRepeatRow {
  return { ...TD_ROW, ...overrides };
}

describe("repeatsScheduleLine (#1910)", () => {
  it("pairs a product page's line with the schedule's line for the same item", () => {
    expect(repeatsScheduleLine("Paper statements", "Paper statement (per statement cycle)")).toBe(true);
    expect(repeatsScheduleLine("Overdraft Fee", "Overdraft")).toBe(true);
    expect(repeatsScheduleLine("Stop payment", "Stop Payment Fee (each)")).toBe(true);
  });

  it("keeps two items of one category apart even at one price", () => {
    expect(repeatsScheduleLine("Research", "Account reconciliation")).toBe(false);
    expect(repeatsScheduleLine("Outgoing domestic wire", "Incoming domestic wire")).toBe(false);
    expect(repeatsScheduleLine("", "Overdraft")).toBe(false);
    expect(repeatsScheduleLine("Fee", "Overdraft")).toBe(false);
  });

  it("keeps a schedule line whose extra words name another item (prod dry run, 2026-10-21)", () => {
    expect(repeatsScheduleLine("Stop Payments (per item)", "Official Check Stop Payment (lost, stolen, or destroyed)")).toBe(false);
    expect(repeatsScheduleLine("Overdraft fee", "Cashier’s Check: Overdraft")).toBe(false);
    expect(repeatsScheduleLine("Plastic Card Rush Fee", "Card Services: Checking Account: Plastic Card Rush Fee")).toBe(true);
  });
});

describe("findProductPageRepeats (#1910)", () => {
  it("takes down TD's campaign-page paper statement fee that repeats the schedule's line at $3", () => {
    const found = findProductPageRepeats([TD_ROW]);
    expect(found.matched).toBe(1);
    expect(found.matches[0]).toMatchObject({ feePublishedId: 64717, twinFeePublishedId: 68015, reason: "product_page_repeat: #19132 twin #68015" });
    expect(found.passing).toEqual([]);
  });

  it("keeps a product-page fee whose schedule names another item, frequency, audience or product", () => {
    const found = findProductPageRepeats([
      row({ fee_published_id: "1", twins: [{ ...TD_TWIN, fee_name: "Statement copy" }] }),
      row({ fee_published_id: "2", twins: [{ ...TD_TWIN, frequency: "per_item" }] }),
      row({ fee_published_id: "3", twins: [{ ...TD_TWIN, fee_audience: "business" }] }),
      row({ fee_published_id: "4", product_name: "TD Complete Checking", twins: [TD_TWIN] }),
      row({ fee_published_id: "5", twins: [] }),
    ]);
    expect(found.matched).toBe(0);
    expect(found.passing).toEqual([1, 2, 3, 4, 5]);
  });

  it("pairs with an unknown frequency or audience, and prefers the twin of the same item words", () => {
    const found = findProductPageRepeats([
      row({
        frequency: null,
        fee_audience: "unknown",
        twins: [
          { fee_published_id: "70", fee_name: "Paper statement (per statement cycle)", frequency: "monthly", fee_audience: "consumer", product_name: null, source_document_id: "19991" },
          { fee_published_id: "80", fee_name: "Paper Statement Fee", frequency: null, fee_audience: null, product_name: null, source_document_id: "19992" },
        ],
      }),
    ]);
    expect(found.matches[0]?.twinFeePublishedId).toBe(80);
  });
});

type DbMock = ReturnType<typeof vi.fn>;
function dbFor(rows: ProductPageRepeatRow[], options: { flags?: Array<Record<string, unknown>> } = {}): DbMock {
  const db = vi.fn((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (text.includes("FROM pipeline_feedback")) return Promise.resolve(options.flags ?? []);
    if (text.includes("UPDATE published_fee_records")) return Promise.resolve([{ fee_published_id: "64717" }]);
    return Promise.resolve([]);
  });
  Object.assign(db, { unsafe: vi.fn((text: string) => Promise.resolve(text.includes("product_page_docs") ? rows : [])) });
  return db;
}
const asDb = (db: DbMock) => db as unknown as Parameters<typeof recheckProductPageRepeats>[0];
const sqlTexts = (db: DbMock) => db.mock.calls.map(([strings]) => (strings as TemplateStringsArray).join("?"));

describe("recheckProductPageRepeats (#1910)", () => {
  it("a dry run reports the match and writes nothing", async () => {
    const db = dbFor([TD_ROW]);
    const result = await recheckProductPageRepeats(asDb(db), { runId: 1, dryRun: true, live: true });
    expect(result).toMatchObject({ checked: 1, matched: 1, takenDown: [], dryRun: true });
    expect(sqlTexts(db).some((text) => /INSERT|UPDATE/.test(text))).toBe(false);
  });

  it("switched off, it records the report and takes nothing down", async () => {
    const db = dbFor([TD_ROW]);
    const result = await recheckProductPageRepeats(asDb(db), { runId: 1, dryRun: false, live: false });
    expect(result.takenDown).toEqual([]);
    const texts = sqlTexts(db);
    expect(texts.some((text) => text.includes("UPDATE published_fee_records"))).toBe(false);
    expect(texts.some((text) => text.includes("INSERT INTO agent_run_events"))).toBe(true);
  });

  it("switched on, a match takes its first look (no takedown before the second)", async () => {
    const db = dbFor([TD_ROW]);
    const result = await recheckProductPageRepeats(asDb(db), { runId: 1, dryRun: false, live: true });
    expect(result.matched).toBe(1);
    expect(result.takenDown).toEqual([]);
    expect(sqlTexts(db).some((text) => text.includes("UPDATE published_fee_records"))).toBe(false);
  });

  it("reports a failed read as nothing checked, without throwing", async () => {
    const db = Object.assign(vi.fn(() => Promise.reject(new Error("boom"))), { unsafe: vi.fn(() => Promise.reject(new Error("boom"))) });
    const result = await recheckProductPageRepeats(asDb(db), { runId: 1, dryRun: true });
    expect(result.checked).toBe(0);
  });

  it("names its check and version", () => {
    expect(PRODUCT_PAGE_REPEAT_CHECK).toBe("darwin.product_page_repeat");
    expect(PRODUCT_PAGE_REPEAT_CHECK_VERSION).toBe(1);
  });
});
