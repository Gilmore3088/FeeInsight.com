import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => {
  const sql = vi.fn() as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
  sql.unsafe = vi.fn();
  return { sql, getSql: () => sql };
});

import { buildIndexEntries, getInstitutionFeeValues, getPeerIndexes, getNationalIndexCached, refreshFeeIndexCache } from "./fee-index";
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

describe("getInstitutionFeeValues", () => {
  beforeEach(() => {
    db.unsafe.mockReset();
  });

  it("returns the institution's median per category from approved, sourced rows", async () => {
    db.unsafe.mockResolvedValueOnce([
      { fee_category: "wire_transfer", amount: "30.00" },
      { fee_category: "wire_transfer", amount: "35.50" },
      { fee_category: "wire_transfer", amount: "40.00" },
      { fee_category: "overdraft", amount: 0 },
      { fee_category: "nsf", amount: null },
    ]);

    const values = await getInstitutionFeeValues(2945, ["wire_transfer", "overdraft", "nsf"]);

    expect(Object.fromEntries(values)).toEqual({ wire_transfer: 35.5, overdraft: 0 });
    const [query, params] = db.unsafe.mock.calls[0];
    expect(query).toContain("source_document_id IS NOT NULL");
    expect(query).toContain("review_status = 'approved'");
    expect(params).toEqual([2945, ["wire_transfer", "overdraft", "nsf"]]);
  });
});

describe("getPeerIndexes", () => {
  beforeEach(() => {
    db.unsafe.mockReset();
  });

  function peerRow(institution_id: number, amount: number, extra: Record<string, unknown>) {
    return { ...row(institution_id, amount), asset_size_tier: "community", fed_district: 6, state_code: "GA", ...extra };
  }

  it("answers every filter set from one query, in order", async () => {
    db.unsafe.mockResolvedValueOnce([
      ...[1, 2, 3, 4, 5].map((id) => peerRow(id, 30, { charter_type: "bank", state_code: "GA" })),
      ...[6, 7, 8, 9, 10].map((id) => peerRow(id, 20, { charter_type: "bank", state_code: "FL" })),
      peerRow(11, 99, { charter_type: "credit_union", state_code: "GA" }),
    ]);

    const [gaBanks, banks, georgia] = await getPeerIndexes([
      { charter_type: "bank", state_code: "GA" },
      { charter_type: "bank" },
      { state_code: "GA" },
    ]);

    expect(db.unsafe).toHaveBeenCalledTimes(1);
    const [query, params] = db.unsafe.mock.calls[0];
    expect(query).toContain("ct.charter_type = ANY($1::text[]) OR ct.state_code = ANY($2::text[])");
    expect(params).toEqual([["bank"], ["GA"]]);
    expect(gaBanks[0]).toMatchObject({ institution_count: 5, median_amount: 30 });
    expect(banks[0]).toMatchObject({ institution_count: 10, median_amount: 25 });
    expect(georgia[0]).toMatchObject({ institution_count: 6, median_amount: 30 });
  });

  it("loads all rows when a filter set has no charter or state anchor", async () => {
    db.unsafe.mockResolvedValueOnce([]);

    await getPeerIndexes([{ asset_tiers: ["community"] }]);

    expect(db.unsafe.mock.calls[0][0]).not.toContain("ANY($1");
    expect(db.unsafe.mock.calls[0][1]).toEqual([]);
  });
});
