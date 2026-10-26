import { describe, expect, it, vi } from "vitest";
import { namesShareReading } from "./publish";
import {
  PUBLISH_REFUSE_SAME_LINE_READS_LIVE,
  pricePrints,
  readsSameLine,
  sameLineExcerptSql,
  selectSameLineReadOf,
} from "./same-line-read";

describe("pricePrints (#1876)", () => {
  it("counts the dollar prices equal to the amount", () => {
    expect(pricePrints("- $30.00 charge for each one-time debit overdraft.", 30)).toBe(1);
    expect(pricePrints("mailed paper statement fee | $2 | $2 | $2 | $2", 2)).toBe(4);
    expect(pricePrints("nsf return item fee is $35.00 per item; nsf paid item fee is $35.00 per", "35.00")).toBe(2);
    expect(pricePrints("2x5\" | $27.20 | $20.40", 27.2)).toBe(1);
    expect(pricePrints("there is a $2,500.00 minimum opening balance, a maintenance fee of $1.00", 2500)).toBe(1);
  });

  it("reads prices with cents when the line has no dollar sign, and free for $0", () => {
    expect(pricePrints("NSF Items or Closed Account Items ............... 30.00", 30)).toBe(1);
    expect(pricePrints("| 5 x 10 ... (per year) ............. 30.00", 30)).toBe(1);
    expect(pricePrints("online bill payment | month | free", 0)).toBe(1);
    expect(pricePrints("online bill payment | month | free", 5)).toBe(0);
    expect(pricePrints("no price here", null)).toBe(0);
  });
});

describe("readsSameLine (#1876)", () => {
  const line = { excerpt: "- $30.00 charge for each one-time debit overdraft.", linePrints: 1, amount: 30 };
  const deterministic = { fee_name: "charge for each one-time debit overdraft", frequency: null };
  const paid = { fee_name: "One-time debit overdraft charge", frequency: "per_item" };
  const share = (a: { fee_name: string | null }, b: { fee_name: string | null }) => namesShareReading(a.fee_name, b.fee_name);

  it("reads Access FCU's two $30 one-time debit overdraft rows as one printed line", () => {
    expect(readsSameLine(deterministic, paid, line, share(deterministic, paid))).toBe(true);
  });

  it("keeps two fees when the line is printed more than once, prints the price twice, or has no text", () => {
    expect(readsSameLine(deterministic, paid, { ...line, linePrints: 2 }, true)).toBe(false);
    expect(readsSameLine(deterministic, paid, { ...line, linePrints: null }, true)).toBe(false);
    expect(readsSameLine(deterministic, paid, { ...line, excerpt: "" }, true)).toBe(false);
    const window = "• courtesy pay fee……… $31.00/item | • ach overdraft fee ...... $31.00/item";
    expect(readsSameLine(deterministic, paid, { excerpt: window, linePrints: 1, amount: 31 }, true)).toBe(false);
  });

  it("keeps two fees whose frequencies differ or whose names share no reading", () => {
    expect(readsSameLine({ fee_name: "Maintenance fee", frequency: "per_transaction" }, { fee_name: "Maintenance fee", frequency: "monthly" }, line, true)).toBe(false);
    const ach = { fee_name: "ACH Overdraft Fee", frequency: "per_item" };
    const courtesy = { fee_name: "Courtesy Pay Fee", frequency: "per_item" };
    expect(share(ach, courtesy)).toBe(false);
    expect(readsSameLine(ach, courtesy, line, share(ach, courtesy))).toBe(false);
  });

  it("reads a box Knox named by its size beside the older read of the same row", () => {
    const old = { fee_name: "3x5", frequency: "annual" };
    const named = { fee_name: "Safe Deposit Box 3x5", frequency: null };
    expect(readsSameLine(named, old, { excerpt: "3x5 | $40.00", linePrints: 1, amount: 40 }, share(named, old))).toBe(true);
  });
});

describe("selectSameLineReadOf", () => {
  const candidate = {
    feeRawId: 633887, institutionId: 7235, canonicalFeeKey: "overdraft", variantType: null, amount: 30,
    feeAudience: "consumer", feeName: "One-time debit overdraft charge", frequency: "per_item",
  };
  function dbReturning(rows: unknown[] | Error) {
    const unsafe = vi.fn((_query: string, _params: unknown[]) => (rows instanceof Error ? Promise.reject(rows) : Promise.resolve(rows)));
    return { db: Object.assign(vi.fn(), { unsafe }) as unknown as Parameters<typeof selectSameLineReadOf>[0], unsafe };
  }

  it("is on: publish refuses a second read of a live fee's line", () => {
    expect(PUBLISH_REFUSE_SAME_LINE_READS_LIVE).toBe(true);
  });

  it("names the live fee this row would read a second time", async () => {
    const { db, unsafe } = dbReturning([
      { fee_published_id: 132908, fee_name: "charge for each one-time debit overdraft", frequency: null, excerpt: "- $30.00 charge for each one-time debit overdraft.", line_prints: 1 },
    ]);
    expect(await selectSameLineReadOf(db, candidate, namesShareReading)).toEqual({ state: "available", value: 132908 });
    const [query, params] = unsafe.mock.calls[0];
    expect(query).toContain(sameLineExcerptSql("live_raw"));
    expect(query).toContain("fp.rolled_back_at IS NULL");
    expect(params).toEqual([633887, "overdraft", null, 30, "consumer"]);
  });

  it("leaves a row publishable beside a separate line, and pending when the read fails", async () => {
    expect(await selectSameLineReadOf(dbReturning([
      { fee_published_id: 132907, fee_name: "charge for each ATM overdraft", frequency: "per_item", excerpt: "- $30.00 charge for each one-time debit overdraft.", line_prints: 1 },
    ]).db, candidate, namesShareReading)).toEqual({ state: "available", value: null });
    expect(await selectSameLineReadOf(dbReturning([]).db, candidate, namesShareReading)).toEqual({ state: "available", value: null });
    expect(await selectSameLineReadOf(dbReturning(new Error("secret")).db, candidate, namesShareReading)).toEqual({ state: "unavailable", check: "same_line_read" });
  });
});
