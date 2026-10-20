import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeeRevenueCorrelation } from "./fee-revenue";

const cache = vi.hoisted(() => ({ values: new Map<string, unknown>(), registered: [] as string[][] }));
vi.mock("next/cache", () => ({
  unstable_cache: <A extends unknown[], R>(read: (...args: A) => Promise<R>, keys: string[]) => {
    cache.registered.push(keys);
    return async (...args: A): Promise<R> => {
      const key = JSON.stringify([keys, args]);
      if (cache.values.has(key)) return cache.values.get(key) as R;
      const value = await read(...args);
      cache.values.set(key, value);
      return value;
    };
  },
}));
vi.mock("./connection", () => ({ getSql: vi.fn(), sql: Object.assign(vi.fn(), { unsafe: vi.fn() }) }));
vi.mock("./fee-revenue", () => ({
  getFeeRevenueData: vi.fn(), getTierFeeRevenueSummary: vi.fn(), getCharterFeeRevenueSummary: vi.fn(), getFiledFeeIncomeData: vi.fn(),
}));
import { getFeeRevenueData, getTierFeeRevenueSummary, getCharterFeeRevenueSummary } from "./fee-revenue";
import { getFeeRevenueResearchCached } from "./public-cached-reads";

const sample: FeeRevenueCorrelation = {
  institution_id: 1, institution_name: "Synthetic credit union", charter_type: "credit_union", regulatory_status: null,
  state_code: "VA", asset_size_tier: "regional", financial_source: "ncua", report_date: "2026-06-30",
  total_assets: 25000000, service_charge_income: 30032, avg_fee: 10, fee_count: 3, median_overdraft: null, fee_income_ratio: 12.01,
};

beforeEach(() => {
  cache.values.clear();
  vi.mocked(getFeeRevenueData).mockReset();
  vi.mocked(getTierFeeRevenueSummary).mockReset();
  vi.mocked(getCharterFeeRevenueSummary).mockReset();
});

describe("source/date research model public cache", () => {
  it("uses a new typed-model key and caches one complete read without nested summary caches", async () => {
    vi.mocked(getFeeRevenueData).mockResolvedValue([sample]);
    const first = await getFeeRevenueResearchCached();
    expect(first.groups[0]).toMatchObject({ institution_count: 1, ranking_preview: { limit: 50, total: 0, complete: true } });
    expect(first.groups[0]).not.toHaveProperty("institutions");
    expect(await getFeeRevenueResearchCached()).toEqual(first);
    expect(getFeeRevenueData).toHaveBeenCalledExactlyOnceWith();
    expect(getTierFeeRevenueSummary).not.toHaveBeenCalled();
    expect(getCharterFeeRevenueSummary).not.toHaveBeenCalled();
    expect(cache.registered.some((keys) => keys.includes("fee-revenue-research-source-date-preview-v1"))).toBe(true);
  });

  it("retries a truly empty family and caches a later truthful thin sample", async () => {
    vi.mocked(getFeeRevenueData).mockResolvedValueOnce([]).mockResolvedValueOnce([sample]);
    expect((await getFeeRevenueResearchCached()).groups).toEqual([]);
    const next = await getFeeRevenueResearchCached();
    expect(next.groups[0]).toMatchObject({ institution_count: 1, summary: { mean_income_usd: null }, rankings: [] });
    expect(await getFeeRevenueResearchCached()).toEqual(next);
    expect(getFeeRevenueData).toHaveBeenCalledTimes(2);
  });

  it("never caches a failed read as an empty or zero financial comparison", async () => {
    vi.mocked(getFeeRevenueData).mockRejectedValueOnce(new Error("database unavailable")).mockResolvedValueOnce([sample]);
    await expect(getFeeRevenueResearchCached()).rejects.toThrow("database unavailable");
    expect((await getFeeRevenueResearchCached()).groups).toHaveLength(1);
    expect(getFeeRevenueData).toHaveBeenCalledTimes(2);
  });
});
