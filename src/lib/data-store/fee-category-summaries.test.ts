import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as { fee_category: string; amount: number | string | null; institution_id: number; charter_type: string }[],
  queries: [] as string[],
}));
vi.mock("./connection", () => {
  const sql = Object.assign(vi.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => {
    state.queries.push(parts.reduce((text, part, index) => text + part + (index < values.length ? String(values[index]) : ""), ""));
    return state.rows;
  }), { unsafe: vi.fn((text: string) => text) });
  return { sql, getSql: () => sql };
});

import { getFeeCategorySummaries } from "./fees";

beforeEach(() => { state.rows.length = 0; state.queries.length = 0; });

describe("getFeeCategorySummaries charter medians", () => {
  it("splits medians by charter and leaves thin charters null", async () => {
    const rows = state.rows;
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

  it("requires consumer evidence and does not turn a free tier into a no-fee claim", async () => {
    state.rows.push(
      { fee_category: "overdraft", amount: 0, institution_id: 1, charter_type: "bank" },
      { fee_category: "overdraft", amount: 35, institution_id: 1, charter_type: "bank" },
      { fee_category: "overdraft", amount: 0, institution_id: 2, charter_type: "bank" },
      { fee_category: "overdraft", amount: null, institution_id: 3, charter_type: "bank" },
      { fee_category: "overdraft", amount: "", institution_id: 4, charter_type: "bank" },
      { fee_category: "nsf", amount: "0.00", institution_id: 1, charter_type: "bank" },
    );
    const summaries = await getFeeCategorySummaries();
    expect(summaries.find((row) => row.fee_category === "overdraft")).toMatchObject({ zero_count: 1, institution_count: 2, median_amount: null });
    expect(summaries.find((row) => row.fee_category === "nsf")).toMatchObject({ zero_count: 1, institution_count: 1 });
    expect(state.queries[0]).toContain("ef.source_document_id IS NOT NULL");
    expect(state.queries[0]).toContain("ef.fee_audience IN ('consumer', 'both')");
    expect(state.queries[0]).toContain("ef.amount >= 0");
  });
});
