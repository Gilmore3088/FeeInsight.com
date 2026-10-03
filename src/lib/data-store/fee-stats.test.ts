import { describe, expect, it } from "vitest";
import {
  maturityTier,
  summarizeFees,
  summarizeFeesBy,
  valuePerInstitution,
} from "./fee-stats";

function rowsFor(amounts: (number | string | null)[], charter = "bank") {
  return amounts.map((amount, index) => ({ institution_id: index + 1, amount, charter_type: charter }));
}

describe("fee statistics contract", () => {
  it("counts each institution once, at the median of its own amounts", () => {
    const rows = [
      ...rowsFor([10, 20, 30, 40, 50]),
      { institution_id: 1, amount: 35, charter_type: "bank" },
      { institution_id: 1, amount: "12.00", charter_type: "bank" },
    ];
    expect(valuePerInstitution(rows).get(1)).toBe(12);

    const stats = summarizeFees(rows);
    expect(stats.institution_count).toBe(5);
    expect(stats.observation_count).toBe(7);
    expect(stats.median_amount).toBe(30);
  });

  it("includes $0 fees in the median", () => {
    const stats = summarizeFees(rowsFor([0, 0, 0, 25, 30]));
    expect(stats.median_amount).toBe(0);
    expect(stats.min_amount).toBe(0);
  });

  it("interpolates even-sized medians from NUMERIC strings", () => {
    const stats = summarizeFees(rowsFor(["10.00", "20.00", "30.00", "40.00", "50.00", "60.00"]));
    expect(stats.median_amount).toBe(35);
  });

  it("shows no distribution below five institutions", () => {
    const stats = summarizeFees(rowsFor([10, 20, 30, 40]));
    expect(stats.institution_count).toBe(4);
    expect(stats.median_amount).toBeNull();
    expect(stats.p25_amount).toBeNull();
    expect(stats.min_amount).toBeNull();
    expect(stats.maturity_tier).toBe("insufficient");
  });

  it("does not let duplicate rows reach the minimum sample", () => {
    const rows = [1, 1, 1, 2, 2, 3].map((id) => ({ institution_id: id, amount: 10, charter_type: "bank" }));
    expect(summarizeFees(rows).median_amount).toBeNull();
  });

  it("labels maturity by institutions, not rows", () => {
    expect(maturityTier(4)).toBe("insufficient");
    expect(maturityTier(5)).toBe("provisional");
    expect(maturityTier(19)).toBe("provisional");
    expect(maturityTier(20)).toBe("strong");
  });

  it("does not count unknown charter types as credit unions", () => {
    const stats = summarizeFees([
      { institution_id: 1, amount: 5, charter_type: "bank" },
      { institution_id: 2, amount: 5, charter_type: "credit_union" },
      { institution_id: 3, amount: 5, charter_type: null },
      { institution_id: 4, amount: 5, charter_type: "thrift" },
    ]);
    expect(stats.bank_count).toBe(1);
    expect(stats.cu_count).toBe(1);
    expect(stats.institution_count).toBe(4);
  });

  it("skips rows without an amount when computing values", () => {
    const stats = summarizeFees([...rowsFor([10, 20, 30, 40]), { institution_id: 9, amount: null, charter_type: "bank" }]);
    expect(stats.institution_count).toBe(5);
    expect(stats.median_amount).toBeNull();
  });

  it("summarizes each group separately", () => {
    const rows = [
      ...rowsFor([1, 2, 3, 4, 5]).map((row) => ({ ...row, fee_category: "atm" })),
      ...rowsFor([30, 35]).map((row) => ({ ...row, fee_category: "overdraft" })),
    ];
    const grouped = summarizeFeesBy(rows, (row) => row.fee_category);
    expect(grouped.get("atm")?.median_amount).toBe(3);
    expect(grouped.get("overdraft")?.median_amount).toBeNull();
  });
});
