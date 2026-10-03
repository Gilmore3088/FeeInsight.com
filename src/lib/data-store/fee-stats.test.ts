import { describe, expect, it } from "vitest";

import { categoryStats, institutionValues, maturityFor, MIN_INSTITUTIONS, type ContractRow } from "./fee-stats";

function rows(amounts: Array<number | null>, opts: { sourced?: boolean; startId?: number; charter?: string } = {}): ContractRow[] {
  return amounts.map((amount, index) => ({
    institution_id: (opts.startId ?? 1) + index,
    amount,
    sourced: opts.sourced ?? false,
    charter_type: opts.charter ?? "bank",
  }));
}

describe("institutionValues", () => {
  it("counts a bank with six overdraft variants once, at the median of its amounts", () => {
    const variants: ContractRow[] = [35, 36, 32, 34, 38, 33].map((amount) => ({ institution_id: 7, amount, sourced: false }));
    expect(institutionValues(variants)).toEqual([{ institutionId: 7, amount: 34.5, sourced: false, charterType: null }]);
  });

  it("keeps $0, drops null, empty and negative amounts", () => {
    const values = institutionValues([
      { institution_id: 1, amount: 0, sourced: false },
      { institution_id: 2, amount: null, sourced: false },
      { institution_id: 3, amount: "", sourced: false },
      { institution_id: 4, amount: -5, sourced: false },
      { institution_id: 5, amount: "12.50", sourced: false },
    ]);
    expect(values.map((value) => [value.institutionId, value.amount])).toEqual([[1, 0], [5, 12.5]]);
  });

  it("treats an institution as sourced if any of its rows is", () => {
    const [value] = institutionValues([
      { institution_id: 9, amount: 30, sourced: false },
      { institution_id: 9, amount: 35, sourced: true },
    ]);
    expect(value).toMatchObject({ amount: 32.5, sourced: true });
  });
});

describe("categoryStats", () => {
  it("withholds the median below five institutions", () => {
    const stats = categoryStats(rows([10, 20, 30, 40]));
    expect(stats).toMatchObject({ median: null, p25: null, p75: null, institution_count: 4, maturity: "insufficient", basis: "blended" });
    expect(stats.min).toBe(10);
  });

  it("gives a provisional median at five and strong at twenty institutions", () => {
    expect(categoryStats(rows([0, 10, 20, 30, 40]))).toMatchObject({ median: 20, maturity: "provisional" });
    expect(categoryStats(rows(Array.from({ length: 20 }, (_, index) => index)))).toMatchObject({ maturity: "strong", institution_count: 20 });
    expect(maturityFor(MIN_INSTITUTIONS - 1)).toBe("insufficient");
  });

  it("includes $0 in the median", () => {
    expect(categoryStats(rows([0, 0, 0, 30, 30])).median).toBe(0);
  });

  it("blends legacy and sourced rows until twenty sourced institutions exist, and labels it", () => {
    const sourced = rows(Array.from({ length: 19 }, () => 30), { sourced: true });
    const legacy = rows([5, 5, 5], { startId: 100 });
    const stats = categoryStats([...sourced, ...legacy]);
    expect(stats).toMatchObject({ basis: "blended", institution_count: 22, sourced_institution_count: 19, legacy_institution_count: 3, median: 30 });
  });

  it("switches to sourced values only once twenty sourced institutions exist", () => {
    const sourced = rows(Array.from({ length: 20 }, () => 30), { sourced: true });
    const legacy = rows(Array.from({ length: 30 }, () => 5), { startId: 100 });
    const stats = categoryStats([...sourced, ...legacy]);
    expect(stats).toMatchObject({ basis: "sourced", institution_count: 20, sourced_institution_count: 20, legacy_institution_count: 30, median: 30, maturity: "strong" });
  });

  it("splits banks and credit unions by institution", () => {
    const stats = categoryStats([...rows([10, 20, 30], { charter: "bank" }), ...rows([10, 20], { startId: 50, charter: "credit_union" })]);
    expect(stats).toMatchObject({ bank_count: 3, cu_count: 2, institution_count: 5 });
  });
});
