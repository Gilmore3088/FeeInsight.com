import { describe, expect, it, vi } from "vitest";
import { getPublishedPeerFees, getPublishedPeerRateFees } from "./hamilton-peer-fees";
import type { sql } from "./connection";

const row = (id: number, amount: number | null) => ({
  id, institution_id: 303, fee_name: id === 1 ? "NSF returned" : "NSF secondary", amount,
  frequency: "per_item", created_at: "2026-10-01T00:00:00Z", source_document_id: 12,
  document_url: "https://bank.example/fee-schedule", source_url: "javascript:unsafe",
});
function database(rows: Array<Record<string, unknown>>) {
  const unsafe = vi.fn().mockResolvedValue(rows);
  return { unsafe } as unknown as typeof sql;
}
describe("exact selected published fee evidence", () => {
  it("retains distinct fee rows and known zero while rejecting non-https provenance", async () => {
    const db = database([row(1, 0), row(2, 30)]);
    const result = await getPublishedPeerFees([303], "nsf", db);
    expect(result.map(f => [f.id, f.amount])).toEqual([[1, 0], [2, 30]]);
    expect(result[0].documentUrl).toBe("https://bank.example/fee-schedule");
    expect(result[0].sourceUrl).toBeNull();
    const [statement, params] = vi.mocked(db.unsafe).mock.calls[0];
    expect(statement).toContain("fee_audience IN ('consumer', 'both', 'unknown')");
    expect(statement).toContain("source_document_id IS NOT NULL");
    expect(params).toEqual([[303], "nsf"]);
  });
  it("rejects duplicate, invalid, or oversized selections before running SQL", async () => {
    const db = database([]);
    await expect(getPublishedPeerFees([303, 303], "nsf", db)).rejects.toThrow();
    await expect(getPublishedPeerFees([0], "nsf", db)).rejects.toThrow();
    await expect(getPublishedPeerFees(Array.from({length:52},(_,i)=>i+1), "nsf", db)).rejects.toThrow();
    expect(vi.mocked(db.unsafe)).not.toHaveBeenCalled();
  });
  it("fails closed when too many distinct rows would be omitted", async () => {
    const db = database(Array.from({length:501},(_,i)=>row(i+1, 30)));
    await expect(getPublishedPeerFees([303], "nsf", db)).rejects.toThrow(/Too many/);
  });
});

const rate = (id: number, extra: Record<string, unknown> = {}) => ({
  id, institution_id: 303, fee_name: "Foreign transaction", frequency: "per_item", created_at: "2026-09-01T00:00:00Z",
  source_document_id: 14, document_url: "https://bank.example/fee-schedule", source_url: null,
  amount_kind: "percent", rate_percent: "1.1", rate_min_amount: null, rate_max_amount: null, rate_basis: "transaction", ...extra,
});
describe("exact selected published rate fee evidence", () => {
  it("reads the rate view under the same consumer filter and keeps each rate as a rate", async () => {
    const db = database([rate(7), rate(8, { rate_percent: 3, rate_basis: "advance", rate_min_amount: "10" })]);
    const result = await getPublishedPeerRateFees([303], "card_foreign_txn", db);
    expect(result.map(f => [f.id, f.rateLabel])).toEqual([[7, "1.1% of the transaction"], [8, "3% of the advance ($10 minimum)"]]);
    // No dollar field exists on a rate line, so nothing can pool it with dollar amounts.
    expect(result[0]).not.toHaveProperty("amount");
    expect(result[0].publishedAt).toBe("2026-09-01T00:00:00Z");
    expect(result[0].documentUrl).toBe("https://bank.example/fee-schedule");
    const [statement, params] = vi.mocked(db.unsafe).mock.calls[0];
    expect(statement).toContain("FROM published_fee_rate_catalog ef");
    expect(statement).not.toContain("published_fee_catalog ef");
    expect(statement).toContain("ef.amount_kind = 'percent'");
    expect(statement).toContain("fee_audience IN ('consumer', 'both', 'unknown')");
    expect(statement).toContain("source_document_id IS NOT NULL");
    expect(params).toEqual([[303], "card_foreign_txn"]);
  });
  it("leaves out a row without a usable rate instead of showing it as a price", async () => {
    const db = database([rate(7, { rate_percent: null }), rate(8, { amount_kind: "flat" }), rate(9, { rate_percent: "0" }), rate(10)]);
    expect((await getPublishedPeerRateFees([303], "card_foreign_txn", db)).map(f => f.id)).toEqual([10]);
  });
  it("rejects rows for institutions outside the exact selection", async () => {
    const db = database([rate(7, { institution_id: 999 })]);
    await expect(getPublishedPeerRateFees([303], "card_foreign_txn", db)).rejects.toThrow(/Invalid published fee evidence/);
  });
  it("checks the selection before running SQL and returns nothing for no peers", async () => {
    const db = database([]);
    expect(await getPublishedPeerRateFees([], "card_foreign_txn", db)).toEqual([]);
    await expect(getPublishedPeerRateFees([303, 303], "card_foreign_txn", db)).rejects.toThrow();
    await expect(getPublishedPeerRateFees([303], "not_a_fee", db)).rejects.toThrow(/Unknown fee category/);
    expect(vi.mocked(db.unsafe)).not.toHaveBeenCalled();
  });
  it("fails closed when too many distinct rate rows would be omitted", async () => {
    const db = database(Array.from({ length: 501 }, (_, i) => rate(i + 1)));
    await expect(getPublishedPeerRateFees([303], "card_foreign_txn", db)).rejects.toThrow(/Too many/);
  });
});
