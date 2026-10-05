import { describe, expect, it, vi } from "vitest";

const rows: { fee_category: string; amount: number; institution_id: number; charter_type: string }[] = [];
vi.mock("./connection", () => ({ sql: vi.fn(async () => rows) }));

import { getFeeCategorySummaries } from "./fees";

describe("getFeeCategorySummaries charter medians", () => {
  it("splits medians by charter and leaves thin charters null", async () => {
    rows.length = 0;
    // Six banks at 30..35, six credit unions at 20..25, one unknown charter at 100.
    for (let i = 0; i < 6; i++) rows.push({ fee_category: "overdraft", amount: 30 + i, institution_id: i + 1, charter_type: "bank" });
    for (let i = 0; i < 6; i++) rows.push({ fee_category: "overdraft", amount: 20 + i, institution_id: i + 101, charter_type: "credit_union" });
    rows.push({ fee_category: "overdraft", amount: 100, institution_id: 999, charter_type: "savings" });
    // Only two credit unions for NSF: below the minimum sample.
    for (let i = 0; i < 6; i++) rows.push({ fee_category: "nsf", amount: 28, institution_id: i + 1, charter_type: "bank" });
    for (let i = 0; i < 2; i++) rows.push({ fee_category: "nsf", amount: 15, institution_id: i + 101, charter_type: "credit_union" });

    const summaries = await getFeeCategorySummaries();
    const od = summaries.find((s) => s.fee_category === "overdraft")!;
    expect(od.bank_median_amount).toBe(32.5);
    expect(od.cu_median_amount).toBe(22.5);
    const nsf = summaries.find((s) => s.fee_category === "nsf")!;
    expect(nsf.bank_median_amount).toBe(28);
    expect(nsf.cu_median_amount).toBeNull();
  });
});
