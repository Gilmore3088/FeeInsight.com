import { describe, expect, it, vi } from "vitest";

import { loadStatePrices, parsePrice, priceCheck } from "./price-check";

type Db = NonNullable<Parameters<typeof loadStatePrices>[2]>;

const priced = (values: number[]) => ({
  institutions: values.map((value, i) => ({ id: i + 1, name: `Bank ${i + 1}`, value, documentUrl: null, sourceLine: null, readAt: null })),
});

describe("where a price sits", () => {
  const state = priced([0, 0, 10, 25, 30, 30, 32, 35, 35, 36]);

  it("counts lower, same, higher and $0 among source-checked institutions", () => {
    expect(priceCheck(30, state)).toEqual({ price: 30, count: 10, lower: 4, same: 2, higher: 4, zero: 2, median: 30, lowerShare: 40 });
  });

  it("takes $0 as a price like any other", () => {
    expect(priceCheck(0, state)).toMatchObject({ lower: 0, same: 2, higher: 8, zero: 2 });
  });

  it("says nothing below the site's median floor", () => {
    expect(priceCheck(30, priced([25, 30, 35]))).toBeNull();
    expect(priceCheck(-1, state)).toBeNull();
  });

  it("reads a typed dollar amount and nothing else", () => {
    expect(parsePrice("$35")).toBe(35);
    expect(parsePrice(" 12.50 ")).toBe(12.5);
    expect(parsePrice("0")).toBe(0);
    expect(parsePrice("1,000")).toBe(1000);
    expect(parsePrice("35%")).toBeNull();
    expect(parsePrice("abc")).toBeNull();
    expect(parsePrice(undefined)).toBeNull();
  });
});

describe("loading a state's figures", () => {
  const row = (institution: number, amount: number, text: string | null) => ({
    institution_id: institution,
    fee_category: "overdraft",
    fee_name: "Overdraft Fee",
    amount,
    canonical_fee_key: "overdraft",
    conditions: null,
    account_product_type: null,
    waiver_text: null,
    document_url: `https://bank${institution}.example/fees.pdf`,
    read_at: "2026-10-01T00:00:00Z",
    normalized_text: text,
  });

  it("keeps only figures that trace to their own schedule", async () => {
    const db = vi.fn((strings: TemplateStringsArray) =>
      Promise.resolve(strings.join("?").includes("FROM institution_sources") ? [{ id: 1, institution_name: "First Bank" }, { id: 2, institution_name: "Second Bank" }] : []),
    ) as unknown as Db & { unsafe: unknown };
    (db as unknown as { unsafe: unknown }).unsafe = vi.fn(async () => [
      row(1, 30, "Overdraft Fee $30.00 per item"),
      row(2, 25, "Monthly maintenance $10.00"),
    ]);
    const result = await loadStatePrices("tx", "overdraft", db);
    expect(result).toMatchObject({ stateCode: "TX", fee: "overdraft", uncheckedCount: 1 });
    expect(result?.institutions).toEqual([
      expect.objectContaining({ id: 1, name: "First Bank", value: 30, documentUrl: "https://bank1.example/fees.pdf" }),
    ]);
  });

  it("refuses a code that isn't a state", async () => {
    const db = vi.fn() as unknown as Db;
    expect(await loadStatePrices("ZZ", "overdraft", db)).toBeNull();
    expect(db).not.toHaveBeenCalled();
  });
});
