import { describe, expect, it } from "vitest";

import { paydayAcrossStates, paydayFigures } from "./payday-reports-aggregates";

describe("payday report aggregates", () => {
  const row = (geo_code: string, period: string, value: number | null, series_key = "payday_avg_fee_per_loan") => ({ geo_code, series_key, period, value, unit: "dollars" });

  it("gives the newest year, the previous one and the change", () => {
    expect(paydayFigures([row("WA", "2022", 60), row("WA", "2024", 70), row("WA", "2023", 65)], 2)).toEqual([
      { series_key: "payday_avg_fee_per_loan", unit: "dollars", period: "2024", value: 70, previous_period: "2023", previous_value: 65, change: 10, change_from_period: "2022" },
    ]);
  });

  it("compares states on their newest year with a counted median", () => {
    const out = paydayAcrossStates([row("WA", "2023", 60), row("WA", "2024", 70), row("TX", "2025", 90)]);
    expect(out.states.map((s) => [s.geo_code, s.period])).toEqual([["TX", "2025"], ["WA", "2024"]]);
    expect(out.median).toEqual({ median: 80, count: 2 });
  });
});
