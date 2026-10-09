import { describe, expect, it, vi } from "vitest";

import { charterChecks, loadStatePrices, marketChecks, parsePrice, priceCheck } from "./price-check";

type Db = NonNullable<Parameters<typeof loadStatePrices>[2]>;

const priced = (values: number[], place: (i: number) => { charterType?: string; city?: string; cbsaName?: string } = () => ({})) => ({
  stateCode: "TX",
  institutions: values.map((value, i) => ({
    id: i + 1,
    name: `Bank ${i + 1}`,
    value,
    documentUrl: null,
    sourceLine: null,
    readAt: null,
    charterType: place(i).charterType ?? null,
    city: place(i).city ?? null,
    cbsaName: place(i).cbsaName ?? null,
  })),
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

describe("state detail", () => {
  it("splits banks from credit unions, leaving out a side too small to say", () => {
    const values = [10, 20, 25, 30, 30, 32, 35, 35, 36, 40, 0, 15];
    const state = priced(values, (i) => ({ charterType: i < 10 ? "bank" : "credit_union" }));
    expect(charterChecks(30, state)).toEqual([{ label: "Banks", count: 10, median: 31, lower: 3, same: 2, higher: 5 }]);
    expect(charterChecks(30, state, 2).map((check) => check.label)).toEqual(["Banks", "Credit unions"]);
  });

  it("groups by metro, or by city where an institution has no metro, largest first", () => {
    const state = priced([25, 30, 35, 20, 30, 40, 10], (i) =>
      i < 4 ? { cbsaName: "Houston-The Woodlands-Sugar Land, TX", city: "Houston" } : i < 6 ? { city: "Waco" } : { city: "Marfa" },
    );
    expect(marketChecks(30, state, 2)).toEqual([
      { label: "Houston-The Woodlands", count: 4, median: 27.5, lower: 2, same: 1, higher: 1 },
      { label: "Waco, TX", count: 2, median: 35, lower: 0, same: 1, higher: 1 },
    ]);
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
      Promise.resolve(strings.join("?").includes("FROM institution_sources") ? [{ id: 1, institution_name: "First Bank", charter_type: "bank", city: "Austin", cbsa_name: null }, { id: 2, institution_name: "Second Bank" }] : []),
    ) as unknown as Db & { unsafe: unknown };
    (db as unknown as { unsafe: unknown }).unsafe = vi.fn(async () => [
      row(1, 30, "Overdraft Fee $30.00 per item"),
      row(2, 25, "Monthly maintenance $10.00"),
    ]);
    const result = await loadStatePrices("tx", "overdraft", db);
    expect(result).toMatchObject({ stateCode: "TX", fee: "overdraft", uncheckedCount: 1 });
    expect(result?.institutions).toEqual([
      expect.objectContaining({ id: 1, name: "First Bank", value: 30, documentUrl: "https://bank1.example/fees.pdf", charterType: "bank", city: "Austin", cbsaName: null }),
    ]);
  });

  it("refuses a code that isn't a state", async () => {
    const db = vi.fn() as unknown as Db;
    expect(await loadStatePrices("ZZ", "overdraft", db)).toBeNull();
    expect(db).not.toHaveBeenCalled();
  });
});
