import { describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({ sql: vi.fn() }));

import {
  changeBetween,
  countyFips,
  countyVsPeers,
  growthPoint,
  medianWithCount,
  migrationSummary,
  migrationTable,
  periodBack,
  rankCountyGrowth,
  type SeriesPoint,
} from "./market-growth-aggregates";

type Row = SeriesPoint & { series_key: string };
const pt = (geo_type: Row["geo_type"], geo_code: string, period: string, value: number | null, series_key = "popest_population"): Row => ({
  geo_type,
  geo_code,
  geo_name: null,
  period,
  value,
  unit: "count",
  note: null,
  series_key,
});

describe("market growth helpers", () => {
  it("steps periods back by years", () => {
    expect(periodBack("2025", 5)).toBe("2020");
    expect(periodBack("2026-08", 1)).toBe("2025-08");
    expect(periodBack("2026Q2", 1)).toBe("2025Q2");
    expect(periodBack("current", 1)).toBeNull();
  });

  it("computes change and leaves it null when the base is blank or zero", () => {
    expect(changeBetween(110, 100, "2024")).toEqual({ base_period: "2024", base_value: 100, change: 10, pct_change: 10 });
    expect(changeBetween(5, 0, "2024").pct_change).toBeNull();
    expect(changeBetween(null, 100, "2024").change).toBeNull();
  });

  it("gives medians their counts", () => {
    expect(medianWithCount([3, null, 1, 2])).toEqual({ median: 2, count: 3 });
    expect(medianWithCount([1, 2, 3, 4])).toEqual({ median: 2.5, count: 4 });
    expect(medianWithCount([1], 3)).toEqual({ median: null, count: 1 });
  });

  it("validates county codes", () => {
    expect(countyFips("1001")).toBe("01001");
    expect(countyFips("99001")).toBeNull();
    expect(countyFips("TX")).toBeNull();
  });

  it("reads annual and monthly series apart even under one key", () => {
    const rows = [pt("county", "48453", "2025", 100), pt("county", "48453", "2024", 90), pt("county", "48453", "2020", 80), pt("county", "48453", "2026-08", 9)];
    const annual = growthPoint(rows, "annual")!;
    expect(annual).toMatchObject({ period: "2025", value: 100 });
    expect(annual.one_year?.pct_change).toBe(11.11);
    expect(annual.five_year?.change).toBe(20);
    expect(growthPoint(rows, "monthly")).toMatchObject({ period: "2026-08", one_year: null });
  });

  it("lines the state and nation up with the county's latest period", () => {
    const rows = [
      pt("county", "48453", "2024", 110),
      pt("county", "48453", "2023", 100),
      pt("state", "TX", "2025", 3100),
      pt("state", "TX", "2024", 3000),
      pt("state", "TX", "2023", 2900),
      pt("nation", "US", "2024", 33000),
    ];
    const out = countyVsPeers(rows, "popest_population", "annual");
    expect(out.county?.period).toBe("2024");
    expect(out.state).toMatchObject({ period: "2024", value: 3000 });
    expect(out.state?.one_year?.change).toBe(100);
    expect(out.nation).toMatchObject({ period: "2024", one_year: null });
  });

  it("ranks a state's counties by growth with the median and its count", () => {
    const rows = [
      pt("county", "48001", "2025", 120),
      pt("county", "48001", "2024", 100),
      pt("county", "48003", "2025", 105),
      pt("county", "48003", "2024", 100),
      pt("county", "48005", "2025", 90),
      pt("county", "48005", "2024", 100),
      pt("county", "48007", "2025", null),
      pt("county", "48007", "2024", 100),
    ];
    const out = rankCountyGrowth(rows, "TX", "popest_population", 1, "annual");
    expect(out.period).toBe("2025");
    expect(out.base_period).toBe("2024");
    expect(out.counties.map((c) => [c.rank, c.geo_code])).toEqual([
      [1, "48001"],
      [2, "48003"],
      [3, "48005"],
    ]);
    expect(out.unranked).toBe(1);
    expect(out).toMatchObject({ median_pct_change: 5, median_count: 3 });
  });

  it("summarises migration with income and top flows", () => {
    const base = { geo_type: "county" as const, geo_code: "01001", geo_name: "Autauga County", period: "2022", raw_json: null };
    const out = migrationSummary(
      [
        { ...base, series_key: "irs_mig_inflow_returns", value: 1500, raw_json: { top_origins: [{ fips: "01101", state: "AL", name: "Montgomery County", returns: 600, individuals: 1200, agi: 30000 }] } },
        { ...base, series_key: "irs_mig_outflow_returns", value: 1200 },
        { ...base, series_key: "irs_mig_net_returns", value: 300 },
        { ...base, series_key: "irs_mig_net_agi", value: 30000 },
        { ...base, series_key: "irs_mig_inflow_agi_per_return", value: 60000 },
        { ...base, series_key: "irs_mig_outflow_agi_per_return", value: 50000 },
        { ...base, period: "2021", series_key: "irs_mig_net_returns", value: -5 },
      ],
      "2022",
    )!;
    expect(out.net).toMatchObject({ returns: 300, agi_thousands: 30000, individuals: null });
    expect(out.income_gap_per_return).toBe(10000);
    expect(out.top_origins[0].fips).toBe("01101");
    expect(out.top_destinations).toEqual([]);
  });

  it("tables a state's counties by net income moving in", () => {
    const r = (geo_code: string, series_key: string, value: number | null) => ({ geo_code, geo_name: null, series_key, value, period: "2022" });
    const out = migrationTable([r("48001", "irs_mig_net_agi", -100), r("48003", "irs_mig_net_agi", 500), r("48003", "irs_mig_net_returns", 20), r("48001", "irs_mig_net_returns", -4)], "TX", "2022");
    expect(out.counties.map((c) => c.geo_code)).toEqual(["48003", "48001"]);
    expect(out).toMatchObject({ median_net_returns: 8, median_net_returns_count: 2, median_net_agi_count: 2 });
  });
});
