import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => {
  const sql = vi.fn() as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
  sql.unsafe = vi.fn();
  return { sql, getSql: () => sql };
});

import { buildIndexEntries, refreshFeeIndexCache } from "./fee-index";
import { sql } from "./connection";

type Mock = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
const db = sql as unknown as Mock;

function row(institution_id: number, amount: number | null, sourced = false, fee_category = "overdraft") {
  return {
    fee_category,
    amount,
    institution_id,
    review_status: "approved",
    created_at: "2026-10-03T00:00:00Z",
    charter_type: institution_id % 2 === 0 ? "bank" : "credit_union",
    source_document_id: sourced ? institution_id * 10 : null,
  };
}

function text(call: unknown[]): string {
  return Array.isArray(call[0]) ? (call[0] as string[]).join(" ") : String(call[0]);
}

describe("buildIndexEntries under the statistics contract", () => {
  it("counts each institution once (at its median) and includes $0", () => {
    const [entry] = buildIndexEntries([
      row(1, 35), row(1, 36), row(1, 37),
      row(2, 0), row(3, 30), row(4, 32), row(5, 34),
    ]);
    expect(entry).toMatchObject({
      institution_count: 5,
      observation_count: 7,
      median_amount: 32,
      min_amount: 0,
      maturity_tier: "provisional",
      basis: "blended",
      stats_method_version: 2,
    });
  });

  it("labels a category sourced once twenty institutions trace to documents", () => {
    const sourcedIds = Array.from({ length: 20 }, (_, index) => index + 1);
    const [entry] = buildIndexEntries([
      ...sourcedIds.map((id) => row(id, 30, true)),
      ...[101, 102, 103].map((id) => row(id, 10)),
    ]);
    expect(entry).toMatchObject({ basis: "sourced", institution_count: 20, sourced_institution_count: 20, legacy_institution_count: 3, median_amount: 30 });
  });

  it("withholds the median below five institutions", () => {
    const [entry] = buildIndexEntries([row(1, 10), row(2, 20)]);
    expect(entry).toMatchObject({ median_amount: null, maturity_tier: "insufficient", institution_count: 2 });
  });
});

describe("refreshFeeIndexCache", () => {
  beforeEach(() => {
    db.mockReset();
    db.unsafe.mockReset();
  });

  it("does nothing before the migration", async () => {
    db.mockResolvedValueOnce([{ ready: false }]);
    const result = await refreshFeeIndexCache(db as never, { runId: 1, force: true });
    expect(result).toMatchObject({ refreshed: false, reason: "cache migration not applied" });
    expect(db.unsafe).not.toHaveBeenCalled();
  });

  it("skips a current cache unless forced", async () => {
    db.mockResolvedValueOnce([{ ready: true }]).mockResolvedValueOnce([{ newest: new Date(), method: 2, rows: 49 }]);
    const result = await refreshFeeIndexCache(db as never, { runId: 1 });
    expect(result).toMatchObject({ refreshed: false, reason: "cache is current" });
  });

  it("rewrites the cache with method, basis and run id when forced", async () => {
    db.mockResolvedValue([]);
    db.mockResolvedValueOnce([{ ready: true }]);
    db.unsafe.mockResolvedValueOnce(Array.from({ length: 20 }, (_, index) => row(index + 1, 30, true)));

    const result = await refreshFeeIndexCache(db as never, { runId: 77, force: true });

    expect(result).toMatchObject({ refreshed: true, categories: 1, sourcedCategories: 1 });
    const calls = db.mock.calls.map(text);
    expect(calls.some((sqlText) => sqlText.includes("DELETE FROM fee_index_cache"))).toBe(true);
    const insert = db.mock.calls.find((call) => text(call).includes("INSERT INTO fee_index_cache"))!;
    expect(insert).toEqual(expect.arrayContaining(["overdraft", "sourced", 2, 77]));
  });
});
