import { describe, expect, it } from "vitest";

import type { ExtractedFeeCandidate, HeldFeeCandidate } from "./rules";
import { runFreeSpecialists } from "./specialists";
import {
  classifyPaidFind,
  KNOX_PAID_FIND_MISS_VERSION,
  pageHost,
  paidFindLineShape,
  paidFindMissMessage,
  repeatedPaidFindMisses,
  sameLineRead,
  summarizePaidFindMisses,
  type PaidFind,
} from "./paid-find-misses";

function read(overrides: Partial<ExtractedFeeCandidate>): ExtractedFeeCandidate {
  return { feeName: "Stop Payment Fee", amount: 30, frequency: null, canonicalHint: "stop_payment", confidence: 0.9, excerpt: "Stop Payment Fee | $30.00", waivable: false, ...overrides };
}

function hold(overrides: Partial<HeldFeeCandidate>): HeldFeeCandidate {
  return { shape: "unclassified", feeName: "Zipper Bag Fee", amount: 4, amountMax: null, percent: null, frequency: null, canonicalHint: null, excerpt: "Zipper Bag Fee $4.00", ...overrides };
}

const stopPayment: PaidFind = { feeName: "Stop Payment Fee", canonicalKey: "stop_payment", amount: 30, sourceLine: "Stop Payment Fee | $30.00" };

describe("paid finds filed against the free team (#1101)", () => {
  it("names the source line's shape without the length half", () => {
    expect(paidFindLineShape("Stop Payment Fee | $30.00")).toBe("table");
    expect(paidFindLineShape("Stop payment ........ $30.00")).toBe("leaders");
    expect(paidFindLineShape("We will charge you a fee of $30.00 for each stop payment.")).toBe("sentences");
    expect(paidFindLineShape("Stop payment orders cost $30.00")).toBe("plain");
    expect(paidFindLineShape("No price here")).toBe("no_prices");
  });

  it("matches a free read by its line or by the name's words, never by price alone", () => {
    expect(sameLineRead(stopPayment, { feeName: "Stop Pay", excerpt: "Stop Payment Fee | $30.00 per item" })).toBe(true);
    expect(sameLineRead(stopPayment, { feeName: "Stop Payments", excerpt: "elsewhere" })).toBe(true);
    expect(sameLineRead(stopPayment, { feeName: "Wire Transfer", excerpt: "Wire Transfer | $30.00" })).toBe(false);
    // Two-word names share both words; one shared word is not enough.
    expect(sameLineRead({ ...stopPayment, feeName: "Stop Payment Renewal" }, { feeName: "Payment Reversal", excerpt: "x" })).toBe(false);
  });

  it("files a find the free team already read as free_read", () => {
    expect(classifyPaidFind(stopPayment, { candidates: [read({})], held: [] })).toEqual({ kind: "free_read", lineShape: "table" });
  });

  it("files a find read under another category as free_other_category", () => {
    expect(classifyPaidFind(stopPayment, { candidates: [read({ canonicalHint: "check_printing" })], held: [] })).toEqual({
      kind: "free_other_category",
      lineShape: "table",
      freeCategory: "check_printing",
    });
  });

  it("files a find the free team held as free_held with its shape", () => {
    const find: PaidFind = { feeName: "Zipper Bag Fee", canonicalKey: "other_deposit", amount: 4, sourceLine: "Zipper Bag Fee $4.00" };
    expect(classifyPaidFind(find, { candidates: [], held: [hold({})] })).toMatchObject({ kind: "free_held", heldShape: "unclassified" });
    // A range hold covers the price.
    expect(classifyPaidFind({ ...find, amount: 6 }, { candidates: [], held: [hold({ shape: "range", amount: 4, amountMax: 8 })] })).toMatchObject({ kind: "free_held", heldShape: "range" });
  });

  it("files a find with nothing at its price on its line as free_missed", () => {
    expect(classifyPaidFind(stopPayment, { candidates: [read({ amount: 31 })], held: [hold({ amount: 30 })] })).toEqual({ kind: "free_missed", lineShape: "table" });
  });

  it("summarises one text with its layout, host and platform", () => {
    const text = ["Stop Payment Fee | $30.00", "Each item we return costs members 25.00 dollars, $25.00 in all."].join("\n");
    const missed: PaidFind = { feeName: "Returned item", canonicalKey: "nsf", amount: 25, sourceLine: "Each item we return costs members 25.00 dollars, $25.00 in all." };
    const { summary, misses } = summarizePaidFindMisses({
      text,
      sourceUrl: "https://WWW.Example-Bank.com/fees?x=1",
      platform: " Q2 ",
      finds: [stopPayment, missed],
      free: { candidates: [read({})], held: [] },
    });
    expect(misses.map((miss) => miss.kind)).toEqual(["free_read", "free_missed"]);
    expect(summary).toEqual({
      version: KNOX_PAID_FIND_MISS_VERSION,
      layout: "table/short",
      host: "example-bank.com",
      platform: "q2",
      paid_finds: 2,
      by_kind: { free_read: 1, free_other_category: 0, free_held: 0, free_missed: 1 },
      missed_line_shapes: { plain: 1 },
      held_shapes: {},
      other_categories: {},
      missed_examples: [missed.sourceLine],
    });
  });

  it("files against the real free team: a fee the rules read is free_read", () => {
    const text = ["Stop Payment Fee | $30.00", "Overdraft Fee | $35.00"].join("\n");
    const free = runFreeSpecialists(text);
    const { summary } = summarizePaidFindMisses({ text, sourceUrl: null, platform: null, finds: [stopPayment], free });
    expect(summary.by_kind.free_read).toBe(1);
  });

  it("reports a miss only once it repeats at two banks under one layout and line shape", () => {
    const base = summarizePaidFindMisses({
      text: "Stop payment orders cost $30.00",
      sourceUrl: "https://a.example/fees",
      platform: "q2",
      finds: [{ ...stopPayment, sourceLine: "Stop payment orders cost $30.00" }],
      free: { candidates: [], held: [] },
    }).summary;
    expect(repeatedPaidFindMisses([{ institutionId: 1, summary: base }, { institutionId: 1, summary: base }])).toEqual([]);
    const repeated = repeatedPaidFindMisses([
      { institutionId: 1, summary: base },
      { institutionId: 2, summary: { ...base, host: "b.example", platform: "banno" } },
    ]);
    expect(repeated).toEqual([
      { layout: "plain/short", lineShape: "plain", banks: 2, finds: 2, hosts: ["a.example", "b.example"], platforms: ["banno", "q2"], examples: ["Stop payment orders cost $30.00", "Stop payment orders cost $30.00"] },
    ]);
    expect(paidFindMissMessage({ free_read: 0, free_other_category: 0, free_held: 0, free_missed: 2 }, repeated)).toBe(
      "Knox's paid pass kept 2 fees: the free team already read 0, read 0 under another category, held 0 and missed 2. Most repeated miss: plain lines in plain/short texts at 2 banks.",
    );
  });

  it("reads a page's host, or null", () => {
    expect(pageHost("not a url")).toBeNull();
    expect(pageHost(null)).toBeNull();
    expect(pageHost("https://www.bank.example/a.pdf")).toBe("bank.example");
  });
});
