import { describe, expect, it } from "vitest";

import { bankruptcyTrend, compareToBenchmark, joinWithBenchmarks, medianWithCount, oewsMetroComparison, yearEarlier, type AreaValueRow } from "./risk-costs-aggregates";

const r = (series_key: string, period: string, value: number | null, note: string | null = null): AreaValueRow => ({ series_key, period, value, unit: "count", note, geo_name: null });

describe("risk-cost aggregate helpers", () => {
  it("takes medians over published values only and says how many", () => {
    expect(medianWithCount([3, null, 1, 2])).toEqual({ median: 2, count: 3 });
    expect(medianWithCount([4, 1])).toEqual({ median: 2.5, count: 2 });
    expect(medianWithCount([null])).toEqual({ median: null, count: 0 });
  });

  it("compares with a benchmark and finds the period a year earlier", () => {
    expect(compareToBenchmark(110, 100)).toEqual({ difference: 10, ratio: 1.1 });
    expect(compareToBenchmark(null, 100)).toEqual({ difference: null, ratio: null });
    expect(yearEarlier("2025Q2")).toBe("2024Q2");
    expect(yearEarlier("2025")).toBe("2024");
  });

  it("puts a state's newest value next to the nation with the change from a year earlier", () => {
    const out = joinWithBenchmarks(
      [r("bankruptcy_3mo_nonbusiness_all_chapters", "2025Q2", 1200), r("bankruptcy_3mo_nonbusiness_all_chapters", "2024Q2", 1000), r("bankruptcy_3mo_nonbusiness_all_chapters", "2025Q1", 1100)],
      [r("bankruptcy_3mo_nonbusiness_all_chapters", "2025Q2", 120000)],
    );
    expect(out[0]).toMatchObject({ period: "2025Q2", value: 1200, prior_period: "2024Q2", change_pct: 20, nation: { value: 120000, vs: { ratio: 0.01 } }, state: null });
  });

  it("compares survey waves with the previous wave", () => {
    const out = joinWithBenchmarks([r("nfcs_overdraws_checking", "2024", 22), r("nfcs_overdraws_checking", "2021", 20)], [], null, "previous");
    expect(out[0]).toMatchObject({ prior_period: "2021", change_pct: 10, nation: { value: null } });
  });

  it("builds a quarterly bankruptcy trend with year-over-year change", () => {
    const state = [r("k", "2025Q2", 110), r("k", "2024Q2", 100)];
    const nation = [r("k", "2025Q2", 11000), r("k", "2024Q2", 10000)];
    expect(bankruptcyTrend(state, nation, 1)).toEqual([
      { period: "2025Q2", state_value: 110, nation_value: 11000, state_share_of_nation_pct: 1, state_change_yoy_pct: 10, nation_change_yoy_pct: 10 },
    ]);
  });

  it("compares a metro's wages with its state and the nation, keeping BLS marks", () => {
    const metro = [r("oews_tellers_hourly_median", "2024", 18), r("oews_tellers_employment", "2024", null, "**"), r("oews_tellers_annual_median", "2024", 37440)];
    const out = oewsMetroComparison(metro, [r("oews_tellers_hourly_median", "2024", 20)], [r("oews_tellers_hourly_median", "2024", 19)], "TX");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ occupation: "tellers", hourly_median: 18, employment: null, notes: { employment: "**" }, vs_state: { difference: -2, ratio: 0.9 }, vs_nation: { difference: -1 } });
  });
});
