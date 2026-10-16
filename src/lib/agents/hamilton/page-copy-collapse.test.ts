import { describe, expect, it, vi } from "vitest";
import { collapsePageCopies, pageCopyRepeats, sameScheduleText, type PageCopyRow } from "./page-copy-collapse";

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
    const fromLetter = pageCopyRepeats(rows, new Map([["100", letter], ["200", TEXT]]));
    expect(fromLetter.otherDocument).toBe(1);
    expect(fromLetter.collapses).toHaveLength(0);
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

  it("reads the audience a schedule keeps naming, not a menu or footer link", () => {
    const rows = [
      row({ fee_published_id: 1, source_document_id: 100, document_url: "https://bank.com/fees" }),
      row({ fee_published_id: 2, source_document_id: 200, document_url: "https://bank.com/fees?print=1", crawled_at: "2026-10-10" }),
    ];
    const rendered = `Skip to content Personal Business Commercial Lending About Us Corporate Office ${TEXT}`;
    expect(pageCopyRepeats(rows, new Map([["100", rendered], ["200", TEXT]])).collapses).toHaveLength(1);
    const footer = `${TEXT} Footer: Business Fees | Personal Banking | Careers`;
    expect(pageCopyRepeats(rows, new Map([["100", footer], ["200", `Personal Checking Fees Personal Savings ${TEXT} Personal Money Market`]])).collapses).toHaveLength(1);
    const late = (who: string) =>
      `First Bank 100 Main Street Member FDIC ${"Lorem ipsum ".repeat(40)} ${who} Checking Fees ${TEXT} ${who} Savings ${who} Money Market`;
    const apart = pageCopyRepeats(rows, new Map([["100", late("Business")], ["200", late("Personal")]]));
    expect(apart.otherDocument).toBe(1);
    expect(pageCopyRepeats(rows, new Map([["100", late("Commercial")], ["200", late("Consumer")]])).otherDocument).toBe(1);
    // A deadline in business days names no audience; a camel-case file name does.
    const deadlines = `Personal ${TEXT} within two business days, 3 business days, one business day, next business day`;
    expect(pageCopyRepeats(rows, new Map([["100", deadlines], ["200", TEXT]])).collapses).toHaveLength(1);
    const camel = [
      row({ fee_published_id: 1, source_document_id: 100, document_url: "https://bank.com/PersonalFeeSchedule.pdf" }),
      row({ fee_published_id: 2, source_document_id: 200, document_url: "https://bank.com/PersonalFeeSchedule.pdf?print=1", crawled_at: "2026-10-10" }),
    ];
    expect(pageCopyRepeats(camel, new Map([["100", late("Business")], ["200", TEXT]])).collapses).toHaveLength(1);
  });

  it("reads prices whole and needs most of them shared", () => {
    expect(sameScheduleText("Box $1000.00 Box $100.00", "Box $100.00 Box $1,000")).toBe(true);
    expect(sameScheduleText("Box $1000.00", "Box $100.00")).toBe(false);
    expect(sameScheduleText("Coin $.50 Wire $25", "Coin $0.50 Wire $25.00")).toBe(true);
    expect(sameScheduleText("Item $0.125", "Item $0.15")).toBe(false);
    expect(sameScheduleText("Stop Payment $ | 30.00 Wire $ | 25.00", "Stop Payment $30.00 Wire $25.00")).toBe(true);
    // A "popular fees" page with 6 of a schedule's 10 prices is not a copy of it.
    const all = Array.from({ length: 10 }, (_, i) => `Fee ${i} $${i + 1}.00`).join(" ");
    const some = Array.from({ length: 6 }, (_, i) => `Fee ${i} $${i + 1}.00`).join(" ");
    expect(sameScheduleText(all, some)).toBe(false);
  });

  it("orders by stated edition when every copy states one, else by read date; ties go to the later read", () => {
    const at = (id: number, doc: number, crawled: string) =>
      row({ fee_published_id: id, source_document_id: doc, document_url: `https://bank.com/fee-schedule.pdf?v=${doc}`, crawled_at: crawled });
    const mixed = pageCopyRepeats([at(1, 100, "2026-10-10"), at(2, 200, "2026-08-05")], new Map([["100", TEXT], ["200", `Effective August 1, 2026 ${TEXT}`]]));
    expect(mixed.collapses).toEqual([expect.objectContaining({ feePublishedId: 2, keptFeePublishedId: 1 })]);
    // An announced change does not hide the edition the copy states.
    const announced = pageCopyRepeats(
      [at(1, 100, "2026-10-10"), at(2, 200, "2026-09-01")],
      new Map([["100", `Effective January 1, 2025 ${TEXT}`], ["200", `Effective July 1, 2026 ${TEXT} New fees effective January 1, 2027`]]),
    );
    expect(announced.collapses).toEqual([expect.objectContaining({ feePublishedId: 1, keptFeePublishedId: 2 })]);
    const tie = pageCopyRepeats(
      [at(1, 100, "2026-10-10"), at(2, 200, "2025-08-01")],
      new Map([["100", `Effective July 1, 2025 ${TEXT}`], ["200", `Effective July 1, 2025 ${TEXT}`]]),
    );
    expect(tie.collapses).toEqual([expect.objectContaining({ feePublishedId: 2, keptFeePublishedId: 1 })]);
  });

  it("never pairs two amounts, two audiences named in the query, or keeps a replaced copy", () => {
    const priced = [
      row({ fee_published_id: 1, amount: 0.125 }),
      row({ fee_published_id: 2, source_document_id: 200, amount: 0.13, crawled_at: "2026-10-10" }),
    ];
    expect(pageCopyRepeats(priced, both).pairs).toBe(0);
    const query = [
      row({ fee_published_id: 1, document_url: "https://bank.com/disclosure.aspx?type=business" }),
      row({ fee_published_id: 2, source_document_id: 200, document_url: "https://bank.com/disclosure.aspx?type=personal", crawled_at: "2026-10-10" }),
    ];
    expect(pageCopyRepeats(query, both).otherDocument).toBe(1);
    const replaced = [
      row({ fee_published_id: 1, crawled_at: "2026-09-01" }),
      row({ fee_published_id: 2, source_document_id: 200, crawled_at: "2026-10-10", superseded: true }),
    ];
    expect(pageCopyRepeats(replaced, both).collapses).toEqual([expect.objectContaining({ feePublishedId: 2, keptFeePublishedId: 1 })]);
  });

  it("ranks a replaced copy below a current copy of the same address only, not of another address (#1439 review)", () => {
    // A superseded read of the bank's newer address (Oct 10) and a current read of an old address
    // (Sep 1): the old address may be an older edition, so the later read stays.
    const otherAddress = [
      row({ fee_published_id: 1, source_document_id: 100, document_url: "https://bank.com/fee-schedule.pdf?print=1", crawled_at: "2026-09-01" }),
      row({ fee_published_id: 2, source_document_id: 200, crawled_at: "2026-10-10", superseded: true }),
    ];
    expect(pageCopyRepeats(otherAddress, both).collapses).toEqual([expect.objectContaining({ feePublishedId: 1, keptFeePublishedId: 2 })]);
    // With a current read of that same address in the group, the replaced read is never kept.
    const three = new Map([...both, ["300", TEXT]]);
    const sameAddress = [...otherAddress, row({ fee_published_id: 3, source_document_id: 300, crawled_at: "2026-09-15" })];
    const kept = pageCopyRepeats(sameAddress, three).collapses.map((pick) => [pick.feePublishedId, pick.keptFeePublishedId]);
    expect(kept).toEqual(expect.arrayContaining([[2, 3]]));
    expect(kept.some(([, keptId]) => keptId === 2)).toBe(false);
  });
});

describe("pageCopyRepeats: a copy the newer copy replaced (#1348)", () => {
  const TEMP = "Fees Temporary checks (sheet of 3 checks) $1.00 Stop Payment $30.00 Cashier's Check $10.00 Wire Transfer Incoming $15.00 Outgoing $25.00";
  const texts = new Map([["297", TEMP], ["20497", TEMP]]);
  const pair = (oldName: string, newName: string) => [
    row({ fee_published_id: 7255, source_document_id: 297, document_url: "https://www.bankfive.com:443/fees", crawled_at: "2026-02-01", superseded: true, superseded_by_id: 20497, canonical_fee_key: "counter_check", amount: 1, fee_name: oldName }),
    row({ fee_published_id: 32758, source_document_id: 20497, document_url: "https://www.bankfive.com/fees", crawled_at: "2026-10-01", canonical_fee_key: "counter_check", amount: 1, fee_name: newName }),
  ];

  it("closes the replaced copy's read of the line under another name (Fall River 7255 / 32758)", () => {
    const found = pageCopyRepeats(pair("Temporary checks", "Temporary checks (sheet of 3 checks)"), texts);
    expect(found).toMatchObject({ pairs: 1, renamed: 1, apartOnPage: 0 });
    expect(found.collapses).toEqual([expect.objectContaining({ feePublishedId: 7255, keptFeePublishedId: 32758 })]);
  });

  it("keeps both when the newer copy prints the two names as lines of their own", () => {
    const apart = "Fees Counter Checks $1.00 Temporary checks (sheet of 3 checks) $1.00 Stop Payment $30.00 Cashier's Check $10.00 Wire Transfer Incoming $15.00 Outgoing $25.00";
    const found = pageCopyRepeats(pair("Counter Checks", "Temporary checks (sheet of 3 checks)").map((one, i) => (i === 1 ? { ...one, fee_name: "Counter checks (sheet of 3)" } : one)), new Map([["297", apart], ["20497", apart.replace("Temporary checks (sheet of 3 checks)", "Counter checks (sheet of 3)")]]));
    expect(found).toMatchObject({ pairs: 1, renamed: 1, apartOnPage: 1 });
    expect(found.collapses).toEqual([]);
  });

  it("pairs with the newer copy's row of the same name before one of another name", () => {
    const text = "Fees ACH Stop Payment $30.00 Stop Payment $30.00 Temporary checks $1.00 Cashier's Check $10.00 Wire Transfer Incoming $15.00 Outgoing $25.00";
    const rows = [
      row({ fee_published_id: 1, source_document_id: 297, crawled_at: "2026-02-01", superseded: true, superseded_by_id: 20497, amount: 30, fee_name: "Stop Payment" }),
      row({ fee_published_id: 3, source_document_id: 20497, crawled_at: "2026-10-01", amount: 30, fee_name: "Stop Payment" }),
      row({ fee_published_id: 9, source_document_id: 20497, crawled_at: "2026-10-01", amount: 30, fee_name: "ACH Stop Payment" }),
    ];
    const found = pageCopyRepeats(rows, new Map([["297", text], ["20497", text]]));
    expect(found).toMatchObject({ renamed: 0, apartOnPage: 0 });
    expect(found.collapses).toEqual([expect.objectContaining({ feePublishedId: 1, keptFeePublishedId: 3 })]);
  });

  it("never closes a line the newer copy dropped as a copy of an unrelated line", () => {
    const found = pageCopyRepeats(pair("Money Order", "Temporary checks (sheet of 3 checks)"), texts);
    expect(found).toMatchObject({ pairs: 0, renamed: 0 });
    expect(pageCopyRepeats(pair("Online Stop Payment", "Temporary checks (sheet of 3 checks)"), texts).pairs).toBe(0);
  });

  it("reads a box size as a shared word (\"Safe Deposit Box - 3x5\" / \"3 x 5\")", () => {
    const box = "Safe Deposit Boxes 3 x 5 $30.00 3 x 10 $45.00 Stop Payment $30.00 Cashier's Check $10.00 Wire Transfer Incoming $15.00";
    const rows = pair("Safe Deposit Box - 3x5", "3 x 5").map((one) => ({ ...one, canonical_fee_key: "safe_deposit_box", amount: 30 }));
    const found = pageCopyRepeats(rows, new Map([["297", box], ["20497", box]]));
    expect(found).toMatchObject({ renamed: 1 });
    expect(found.collapses).toEqual([expect.objectContaining({ feePublishedId: 7255, keptFeePublishedId: 32758 })]);
    const other = pair("Safe Deposit Box - 3x10", "3 x 5").map((one) => ({ ...one, canonical_fee_key: "safe_deposit_box", amount: 30 }));
    expect(pageCopyRepeats(other, new Map([["297", box], ["20497", box]])).pairs).toBe(0);
    // Both name the box, at other sizes: two boxes, even though "safe deposit box" is shared.
    const sizes = pair("Safe Deposit Box - 3x10", "Safe Deposit Box 3 x 5").map((one) => ({ ...one, canonical_fee_key: "safe_deposit_box", amount: 30 }));
    expect(pageCopyRepeats(sizes, new Map([["297", box], ["20497", box]])).pairs).toBe(0);
  });

  it("never pairs other names across documents that only share a page key", () => {
    const [older, newer] = pair("Counter Checks", "Temporary checks (sheet of 3 checks)");
    const found = pageCopyRepeats([{ ...older, superseded: false, superseded_by_id: null }, newer], texts);
    expect(found.pairs).toBe(0);
  });
});

describe("collapsePageCopies (#1439)", () => {
  it("reports a failed close as an error, not as nothing closed", async () => {
    const rows = [
      row({ fee_published_id: 1, source_document_id: 100, document_url: "https://bank.com/fee-schedule.pdf?print=1", crawled_at: "2026-09-01" }),
      row({ fee_published_id: 2, source_document_id: 200, crawled_at: "2026-10-10" }),
    ];
    const db = vi.fn((strings: TemplateStringsArray) => {
      const text = strings.join("");
      if (text.includes("agent_source_texts")) return Promise.resolve([{ source_document_id: 100, normalized_text: TEXT }, { source_document_id: 200, normalized_text: TEXT }]);
      if (text.includes("UPDATE")) return Promise.reject(new Error("deadlock detected"));
      return Promise.resolve([]);
    }) as unknown as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
    db.unsafe = vi.fn(() => Promise.resolve(rows));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await collapsePageCopies(db as unknown as Parameters<typeof collapsePageCopies>[0], { runId: 1, batchId: "agentic-run-1", dryRun: false, live: true });
    quiet.mockRestore();
    expect(result.collapses).toEqual([]);
    expect(result.error).toBe("close failed: deadlock detected");
  });
});
