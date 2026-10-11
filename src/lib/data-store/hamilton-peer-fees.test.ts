import { describe, expect, it, vi } from "vitest";
import { getPublishedPeerFees } from "./hamilton-peer-fees";
import type { sql } from "./connection";

const row = (id: number, amount: number | null) => ({
  id, institution_id: 303, fee_name: id === 1 ? "NSF returned" : "NSF secondary", amount,
  frequency: "per_item", created_at: "2026-10-01T00:00:00Z", source_document_id: 12,
  document_url: "https://bank.example/fee-schedule", source_url: "javascript:unsafe",
});
function database(rows: ReturnType<typeof row>[]) {
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
    expect(statement).toContain("fee_audience IN ('consumer', 'both')");
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
