import { describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({ sql: vi.fn() }));

import { buildStateFeeIndexes } from "./fee-index";

function row(institution_id: number, charter_type: string, amount: number, fee_category = "overdraft") {
  return { fee_category, amount, institution_id, review_status: "approved", created_at: "2026-10-01", charter_type };
}

describe("buildStateFeeIndexes", () => {
  it("summarizes the state overall and by charter from one set of rows", () => {
    const rows = [
      ...[1, 2, 3, 4, 5, 6].map((id) => row(id, "bank", 30 + id)),
      ...[101, 102, 103, 104, 105].map((id) => row(id, "credit_union", 20 + id - 100)),
      row(1, "bank", 15, "nsf"),
    ];
    const result = buildStateFeeIndexes(rows);
    expect(result.verified_institutions).toBe(11);
    expect(result.verified_bank_institutions).toBe(6);
    expect(result.verified_cu_institutions).toBe(5);
    expect(result.verified_fees).toBe(12);
    expect(result.all.find((e) => e.fee_category === "overdraft")?.institution_count).toBe(11);
    expect(result.bank.find((e) => e.fee_category === "overdraft")?.median_amount).toBe(33.5);
    expect(result.credit_union.find((e) => e.fee_category === "overdraft")?.median_amount).toBe(23);
    // One institution is below the minimum sample, so no NSF median.
    expect(result.all.find((e) => e.fee_category === "nsf")?.median_amount).toBeNull();
  });
});
