import { describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({ sql: vi.fn(), getSql: vi.fn() }));

import { getBuyerCoverage, getSellableMarkets, summarizeMarketCoverage } from "./competitor-coverage";

describe("competitor coverage in one market", () => {
  const footprint = {
    1: { branches: 4, deposits: 500 }, // the buyer
    2: { branches: 6, deposits: 600 },
    3: { branches: 3, deposits: 300 },
    4: { branches: 1, deposits: 100 },
    5: { branches: 2, deposits: null }, // a credit union: counted, no deposits
  };

  it("counts competitors and weights the share by their deposits, leaving the buyer out", () => {
    const live = new Map([
      [1, { hasOverdraft: true }],
      [2, { hasOverdraft: true }],
      [3, { hasOverdraft: false }],
      [5, { hasOverdraft: true }],
    ]);
    expect(summarizeMarketCoverage(footprint, 1, live)).toEqual({
      competitors: 4,
      withFees: 3,
      withOverdraft: 2,
      depositShare: 0.9,
      depositShareOverdraft: 0.6,
    });
  });

  it("leaves national online and branchless banks out of the competitors", () => {
    const live = new Map([[2, { hasOverdraft: true }]]);
    expect(summarizeMarketCoverage(footprint, 1, live, new Set([2]))).toEqual({
      competitors: 3,
      withFees: 0,
      withOverdraft: 0,
      depositShare: 0,
      depositShareOverdraft: 0,
    });
  });

  it("has no deposit share when only credit unions compete", () => {
    const coverage = summarizeMarketCoverage({ 1: { branches: 1, deposits: 10 }, 9: { branches: 2, deposits: null } }, 1, new Map());
    expect(coverage).toEqual({ competitors: 1, withFees: 0, withOverdraft: 0, depositShare: null, depositShareOverdraft: null });
  });
});

describe("covered markets", () => {
  const row = {
    sod_year: 2026, total: "3", institution_id: "41", institution_name: "First Bank", state_code: "TX",
    own_dep: "812000", counties: "2", share: "0.85", share_od: "0.6", own_live: true,
  };
  function fakeDb(rows: unknown[]) {
    const calls: { query: string; values: unknown[] }[] = [];
    const db = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ query: strings.join("?"), values });
      return Promise.resolve(rows);
    }) as never;
    return { db, calls };
  }

  it("reads the size band and maps each bank's shares", async () => {
    const { db, calls } = fakeDb([row]);
    const found = await getSellableMarkets(db, { minDeposits: 500_000, maxDeposits: 2_000_000, limit: 50 });
    expect(found).toEqual({
      sodYear: 2026,
      total: 3,
      rows: [{ institutionId: 41, name: "First Bank", stateCode: "TX", deposits: 812000, counties: 2, share: 0.85, shareOverdraft: 0.6, ownFeesLive: true }],
    });
    expect(calls[0].values).toEqual(expect.arrayContaining([0.8, 500_000, 2_000_000, 50]));
  });

  it("looks up prospects at any share, and skips the query with no ids", async () => {
    const { db, calls } = fakeDb([row]);
    expect((await getBuyerCoverage([41, 42], db)).get(41)?.share).toBe(0.85);
    expect(calls[0].values).toEqual(expect.arrayContaining([0, [41, 42], 2]));
    expect((await getBuyerCoverage([], db)).size).toBe(0);
    expect(calls).toHaveLength(1);
  });
});
