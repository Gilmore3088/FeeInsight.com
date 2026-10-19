import { describe, expect, it } from "vitest";

import { compareCounty, getUrbanDebtComparison, medianWithCount, type AreaValueRow } from "./state-lists-aggregates";

describe("state-lists aggregates helpers", () => {
  it("gives each median with its count", () => {
    expect(medianWithCount([3, null, 1, 2])).toEqual({ median: 2, count: 3 });
    expect(medianWithCount([4, 1])).toEqual({ median: 2.5, count: 2 });
    expect(medianWithCount([null])).toEqual({ median: null, count: 0 });
  });

  it("compares a county with its state's counties, the state total and the nation", () => {
    const s = "nonbank_check_casher_licensees";
    const row = (geo_type: "county" | "state", geo_code: string, state_code: string, value: number | null): AreaValueRow => ({ geo_type, geo_code, state_code, series_key: s, period: "2026-09", value, unit: "count" });
    const rows = [row("county", "36047", "NY", 10), row("county", "36061", "NY", 4), row("county", "48201", "TX", 1), row("state", "NY", "NY", 30), row("state", "TX", "TX", 5)];
    expect(compareCounty(rows, "36047", [s])).toEqual([
      {
        series_key: s,
        unit: "count",
        period: "2026-09",
        county_value: 10,
        state_value: 30,
        state_county_median: { median: 7, count: 2 },
        nation_county_median: { median: 4, count: 3 },
        nation_state_median: { median: 17.5, count: 2 },
      },
    ]);
  });

  it("carries the Urban Institute attribution with every Debt in America read", async () => {
    await expect(getUrbanDebtComparison("not-a-county")).resolves.toEqual({
      licence: "ODC-By 1.0",
      attribution: "Braga et al., Debt in America, Urban Institute",
      series: [],
    });
  });
});
