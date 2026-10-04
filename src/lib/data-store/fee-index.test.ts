import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => {
  const sql = vi.fn() as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
  sql.unsafe = vi.fn();
  return { sql, getSql: () => sql };
});

import { buildIndexEntries, getNationalIndexCached, refreshFeeIndexCache } from "./fee-index";
import { STATS_METHOD_VERSION } from "./fee-stats";
import { sql } from "./connection";

type Mock = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn>; savepoint?: ReturnType<typeof vi.fn> };
const db = sql as unknown as Mock;

function row(institution_id: number, amount: number | null, fee_category = "overdraft") {
  return {
    fee_category,
    amount,
    institution_id,
    review_status: "approved",
    created_at: "2026-10-03T00:00:00Z",
    charter_type: institution_id % 2 === 0 ? "bank" : "credit_union",
  };
}

function text(call: unknown[]): string {
  return Array.isArray(call[0]) ? (call[0] as string[]).join(" ") : String(call[0]);
}

describe("buildIndexEntries", () => {
  it("counts each institution once at its median and includes $0", () => {
    const [entry] = buildIndexEntries([row(1, 35), row(1, 36), row(1, 37), row(2, 0), row(3, 30), row(4, 32), row(5, 34)]);
    expect(entry).toMatchObject({ institution_count: 5, observation_count: 7, median_amount: 32, min_amount: 0, maturity_tier: "provisional" });
  });
});

describe("refreshFeeIndexCache", () => {
  beforeEach(() => {
    db.mockReset();
    db.unsafe.mockReset();
    delete db.savepoint;
  });

  it("does nothing before the migration", async () => {
    db.mockResolvedValueOnce([{ ready: false }]);
    const result = await refreshFeeIndexCache(db as never, { runId: 1, force: true });
    expect(result).toMatchObject({ refreshed: false, reason: "cache migration not applied" });
    expect(db.unsafe).not.toHaveBeenCalled();
  });

  it("skips a current cache unless forced", async () => {
    db.mockResolvedValueOnce([{ ready: true }]).mockResolvedValueOnce([{ newest: new Date(), method: STATS_METHOD_VERSION, rows: 49 }]);
    const result = await refreshFeeIndexCache(db as never, { runId: 1 });
    expect(result).toMatchObject({ refreshed: false, reason: "cache is current" });
    expect(db.unsafe).not.toHaveBeenCalled();
  });

  it("rebuilds a cache from an older method even when nothing was published", async () => {
    db.mockResolvedValue([]);
    db.mockResolvedValueOnce([{ ready: true }]).mockResolvedValueOnce([{ newest: new Date(), method: 1, rows: 49 }]);
    db.unsafe.mockResolvedValueOnce([row(1, 10)]);
    const result = await refreshFeeIndexCache(db as never, { runId: 5 });
    expect(result).toMatchObject({ refreshed: true, categories: 1, reason: "stale" });
  });

  it("replaces the cache, stamped with the method version and run id, inside a savepoint", async () => {
    db.mockResolvedValue([]);
    db.mockResolvedValueOnce([{ ready: true }]);
    db.savepoint = vi.fn(async (fn: (sp: unknown) => Promise<unknown>) => fn(db));
    db.unsafe.mockResolvedValueOnce(Array.from({ length: 20 }, (_, index) => row(index + 1, 30)));

    const result = await refreshFeeIndexCache(db as never, { runId: 77, force: true });

    expect(result).toMatchObject({ refreshed: true, categories: 1, reason: "published" });
    expect(db.savepoint).toHaveBeenCalledTimes(1);
    expect(db.mock.calls.some((call) => text(call).includes("DELETE FROM fee_index_cache"))).toBe(true);
    const insert = db.mock.calls.find((call) => text(call).includes("INSERT INTO fee_index_cache"))!;
    expect(insert).toEqual(expect.arrayContaining(["overdraft", "strong", STATS_METHOD_VERSION, 77]));
  });

  it("reports a write failure instead of throwing, so the publish survives", async () => {
    db.mockResolvedValueOnce([{ ready: true }]);
    db.savepoint = vi.fn(async () => {
      throw new Error("column missing");
    });
    db.unsafe.mockResolvedValueOnce([row(1, 10)]);
    const result = await refreshFeeIndexCache(db as never, { runId: 9, force: true });
    expect(result).toMatchObject({ refreshed: false, reason: "failed: column missing" });
  });
});

describe("getNationalIndexCached", () => {
  it("ignores cache rows from an older statistics method and computes live", async () => {
    db.mockReset();
    db.unsafe.mockReset();
    db.mockResolvedValueOnce([
      { fee_category: "overdraft", median_amount: 99, institution_count: 50, computed_at: new Date().toISOString(), stats_method_version: 1 },
    ]);
    db.unsafe.mockResolvedValueOnce(Array.from({ length: 5 }, (_, index) => row(index + 1, 30)));
    const [entry] = await getNationalIndexCached();
    expect(entry).toMatchObject({ fee_category: "overdraft", median_amount: 30, institution_count: 5 });
    expect(db.unsafe).toHaveBeenCalledTimes(1);
  });
});
