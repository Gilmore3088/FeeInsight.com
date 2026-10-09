import { describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({ sql: vi.fn(), getSql: vi.fn() }));

import { summarizeMarketCoverage } from "./competitor-coverage";

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

  it("has no deposit share when only credit unions compete", () => {
    const coverage = summarizeMarketCoverage({ 1: { branches: 1, deposits: 10 }, 9: { branches: 2, deposits: null } }, 1, new Map());
    expect(coverage).toEqual({ competitors: 1, withFees: 0, withOverdraft: 0, depositShare: null, depositShareOverdraft: null });
  });
});
