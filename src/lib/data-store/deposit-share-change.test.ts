import { describe, expect, it } from "vitest";

import { computeShareChanges, marketCodes, type SodRow } from "./deposit-share-change";

const row = (year: number, cert: number, deposits: number | null, extra: Partial<SodRow> = {}): SodRow => ({
  year,
  market: 39095,
  cert,
  institution_id: cert * 10,
  deposits,
  branches: 1,
  ...extra,
});

describe("deposit share change", () => {
  it("computes shares and 1- and 5-year changes in percentage points", () => {
    const [m] = computeShareChanges(
      [
        row(2025, 1, 600), row(2025, 2, 300), row(2025, 3, 100),
        row(2024, 1, 500), row(2024, 2, 500),
        row(2020, 1, 200), row(2020, 2, 600), row(2020, 4, 200),
      ],
      2025,
    );
    expect(m).toMatchObject({ market: 39095, year: 2025, total_deposits: 1000, institutions: 3, total_deposits_1y_ago: 1000, total_deposits_5y_ago: 1000 });
    const byCert = Object.fromEntries(m.rows.map((r) => [r.cert, r]));
    expect(byCert[1]).toMatchObject({ rank: 1, share: 60, share_1y_ago: 50, change_1y_pp: 10, share_5y_ago: 20, change_5y_pp: 40 });
    expect(byCert[2]).toMatchObject({ share: 30, change_1y_pp: -20, change_5y_pp: -30 });
    // New entrant: zero share in years the market had rows, not unknown.
    expect(byCert[3]).toMatchObject({ share: 10, share_1y_ago: 0, change_1y_pp: 10, deposits_1y_ago: 0 });
    // Gone by the end year: not listed.
    expect(byCert[4]).toBeUndefined();
  });

  it("gives no change when the market has no rows in the comparison year", () => {
    const [m] = computeShareChanges([row(2025, 1, 100), row(2024, 1, 50)], 2025);
    expect(m.rows[0]).toMatchObject({ change_1y_pp: 0, share_5y_ago: null, change_5y_pp: null, deposits_5y_ago: null });
    expect(m.total_deposits_5y_ago).toBeNull();
  });

  it("leaves blank deposit figures out of the sums and counts them", () => {
    const [m] = computeShareChanges([row(2025, 1, 100), row(2025, 1, null, { branches: 2 }), row(2025, 2, 100)], 2025);
    expect(m.total_deposits).toBe(200);
    expect(m.blank_deposit_offices).toBe(2);
    expect(m.rows.find((r) => r.cert === 1)).toMatchObject({ share: 50, branches: 1 });
  });

  it("merges split groups of one cert and keeps separate markets apart", () => {
    const out = computeShareChanges(
      [row(2025, 1, 50, { institution_id: null }), row(2025, 1, 50), row(2025, 2, 400, { market: 6037 })],
      2025,
    );
    expect(out.map((m) => m.market)).toEqual([6037, 39095]);
    expect(out[1].rows[0]).toMatchObject({ cert: 1, deposits: 100, branches: 2, institution_id: 10, share: 100 });
  });

  it("skips a market with no deposits in the end year", () => {
    expect(computeShareChanges([row(2024, 1, 100)], 2025)).toEqual([]);
  });

  it("normalises market codes", () => {
    expect(marketCodes(["39095", 39095, "06037", "x", 0])).toEqual([39095, 6037]);
  });
});
