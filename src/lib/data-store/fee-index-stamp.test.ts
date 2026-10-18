import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => {
  const sql = vi.fn() as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
  sql.unsafe = vi.fn();
  return { sql, getSql: () => sql };
});

import {
  catalogStamp,
  getNationalIndexCached,
  getNationalIndexCachedStamped,
  getNationalIndexStamped,
  getPeerIndexStamped,
  getPeerIndexesStamped,
  scopeFilters,
} from "./fee-index";
import { STATS_METHOD_VERSION, statsCounting, statsPopulationFilters } from "./fee-stats";
import { sql } from "./connection";

type Mock = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
const db = sql as unknown as Mock;

function row(institution_id: number, amount: number, created_at = "2026-10-03T00:00:00Z") {
  return {
    fee_category: "overdraft",
    amount,
    institution_id,
    review_status: "approved",
    created_at,
    charter_type: "bank",
    asset_size_tier: "community",
    fed_district: 6,
    state_code: "GA",
  };
}

const clock = (iso: string) => ({ now: () => new Date(iso) });

describe("catalogStamp", () => {
  it("stamps a live catalog read with the contract's filters, method and counting rule", () => {
    const stamp = catalogStamp({ mode: "live", readAt: "2026-10-18T14:00:00Z", runId: null, newestRecordAt: null });
    expect(stamp).toMatchObject({
      dataset: "published_fee_catalog",
      mode: "live",
      readAt: "2026-10-18T14:00:00.000Z",
      runId: null,
      methodVersion: STATS_METHOD_VERSION,
      counting: statsCounting(),
      filters: statsPopulationFilters(),
    });
    expect(stamp.derivedFrom).toBeUndefined();
  });

  it("adds a peer group's filters in describePeerFilters' words", () => {
    expect(scopeFilters({ state_code: "GA", charter_type: "credit_union", asset_tiers: ["community_large"], fed_districts: [6] })).toEqual([
      { key: "peers:state:GA", label: "Institutions in Georgia" },
      { key: "peers:charter:credit_union", label: "Credit unions only" },
      { key: "peers:asset_tiers:community_large", label: "Assets $1B to $10B" },
      { key: "peers:fed_districts:6", label: "Fed district 6" },
    ]);
    expect(scopeFilters({ institutionIds: [12, 11, 12] })).toEqual([
      { key: "peers:institutions:11,12", label: "2 chosen institutions" },
    ]);
    expect(scopeFilters(null)).toEqual([]);
  });

  it("adds a question's segment in segmentLabel's words", () => {
    expect(
      scopeFilters({ label: "credit unions under $1 billion in Texas", minAssets: null, maxAssets: 1_000_000, charterType: "credit_union", stateCode: "TX", largest: null }),
    ).toEqual([
      { key: "segment:charter:credit_union", label: "Segment: credit unions" },
      { key: "segment:assets:-1000000", label: "Segment: institutions with under $1 billion in assets" },
      { key: "segment:state:TX", label: "Segment: institutions in Texas" },
    ]);
    expect(
      scopeFilters({ label: "the 25 largest banks", minAssets: null, maxAssets: null, charterType: "bank", stateCode: null, largest: 25 }),
    ).toEqual([
      { key: "segment:charter:bank", label: "Segment: banks" },
      { key: "segment:largest:25", label: "Segment: the 25 largest banks" },
    ]);
  });

  it("keeps every label free of em dashes, agent names and the old product name", () => {
    const labels = [
      ...statsPopulationFilters(),
      ...scopeFilters({ state_code: "GA", institutionIds: [] }),
    ].map((f) => f.label).join("\n");
    expect(labels).not.toMatch(/\u2014/);
    expect(labels).not.toMatch(/\b(Atlas|Magellan|Rosetta|Knox|Darwin|Hoovie)\b/);
    expect(labels).not.toMatch(/Hamilton Pro/);
  });
});

describe("live stamped readers", () => {
  beforeEach(() => {
    db.mockReset();
    db.unsafe.mockReset();
  });

  it("national: readAt is when the query returned, newestRecordAt the newest row", async () => {
    db.unsafe.mockResolvedValueOnce([row(1, 30, "2026-10-17T08:00:00Z"), row(2, 31, "2026-10-18T09:30:00Z")]);
    const { entries, stamp } = await getNationalIndexStamped(true, clock("2026-10-18T14:00:00Z"));
    expect(entries[0]).toMatchObject({ fee_category: "overdraft", institution_count: 2 });
    expect(stamp).toMatchObject({
      dataset: "published_fee_catalog",
      mode: "live",
      readAt: "2026-10-18T14:00:00.000Z",
      newestRecordAt: "2026-10-18T09:30:00.000Z",
      runId: null,
    });
  });

  it("national: the clock is read after the query, not before", async () => {
    let returned = false;
    db.unsafe.mockImplementationOnce(async () => {
      returned = true;
      return [];
    });
    const { stamp } = await getNationalIndexStamped(true, { now: () => new Date(returned ? "2026-10-18T14:00:05Z" : "2026-10-18T13:00:00Z") });
    expect(stamp.readAt).toBe("2026-10-18T14:00:05.000Z");
  });

  it("peer: one stamp per set, one read time, each with its own scope", async () => {
    db.unsafe.mockResolvedValueOnce([1, 2, 3, 4, 5].map((id) => row(id, 30)));
    const [ga, banks] = await getPeerIndexesStamped([{ state_code: "GA" }, { charter_type: "bank" }], true, clock("2026-10-18T14:00:00Z"));
    expect(ga.stamp.readAt).toBe(banks.stamp.readAt);
    expect(ga.stamp.filters.at(-1)).toEqual({ key: "peers:state:GA", label: "Institutions in Georgia" });
    expect(banks.stamp.filters.at(-1)).toEqual({ key: "peers:charter:bank", label: "Banks only" });
    expect(ga.stamp.id).not.toBe(banks.stamp.id);
  });

  it("single peer index carries its filters", async () => {
    db.unsafe.mockResolvedValueOnce([]);
    const { stamp } = await getPeerIndexStamped({ fed_districts: [7] }, true, clock("2026-10-18T14:00:00Z"));
    expect(stamp.filters.map((f) => f.key)).toContain("peers:fed_districts:7");
  });
});

describe("getNationalIndexCachedStamped", () => {
  it("keeps the cache's run id, computed_at and method version (bigint and Date from postgres.js)", async () => {
    db.mockReset();
    db.unsafe.mockReset();
    const computedAt = new Date(Date.now() - 60_000);
    db.mockResolvedValueOnce([
      { fee_category: "overdraft", median_amount: 30, institution_count: 2495, computed_at: computedAt, stats_method_version: STATS_METHOD_VERSION, agent_run_id: "9001" },
      { fee_category: "nsf", median_amount: 29, institution_count: 40, computed_at: computedAt, stats_method_version: String(STATS_METHOD_VERSION), agent_run_id: "9001" },
    ]);
    const { entries, stamp } = await getNationalIndexCachedStamped();
    expect(entries.map((e) => e.institution_count)).toEqual([2495, 40]);
    expect(stamp).toMatchObject({
      dataset: "fee_index_cache",
      derivedFrom: "published_fee_catalog",
      mode: "cached",
      readAt: computedAt.toISOString(),
      runId: 9001,
      newestRecordAt: null,
      methodVersion: STATS_METHOD_VERSION,
      counting: statsCounting(),
    });
    expect(db.unsafe).not.toHaveBeenCalled();
    // The entries-only reader is the same memoised read, so existing callers see no change.
    expect(await getNationalIndexCached()).toBe(entries);
    expect(db).toHaveBeenCalledTimes(1);
  });

  it("falls back to a live stamp when the cache is from an older method", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 120_000); // past the in-process memo from the test above
    db.mockReset();
    db.unsafe.mockReset();
    db.mockResolvedValueOnce([
      { fee_category: "overdraft", median_amount: 99, institution_count: 50, computed_at: new Date().toISOString(), stats_method_version: 1, agent_run_id: 7 },
    ]);
    db.unsafe.mockResolvedValueOnce([1, 2, 3, 4, 5].map((id) => row(id, 30)));
    const { stamp } = await getNationalIndexCachedStamped(clock("2026-10-18T14:00:00Z"));
    vi.useRealTimers();
    expect(stamp).toMatchObject({ dataset: "published_fee_catalog", mode: "live", runId: null, readAt: "2026-10-18T14:00:00.000Z" });
  });
});
