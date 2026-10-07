import { describe, expect, it } from "vitest";
import {
  adfTest,
  annualTotals,
  cagrPct,
  deflate,
  latestContiguousRun,
  logTrend,
  ols,
  quarterlyDeflator,
  quarterlyServiceCharges,
  seasonallyAdjust,
  structuralBreak,
  type QuarterValue,
} from "./econometrics";

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function normal(next: () => number): number {
  return Math.sqrt(-2 * Math.log(next() + 1e-12)) * Math.cos(2 * Math.PI * next());
}

function quarters(values: number[], startYear = 2010): QuarterValue[] {
  return values.map((value, i) => ({ quarter: `${startYear + Math.floor(i / 4)}Q${(i % 4) + 1}`, value }));
}

describe("quarterlyServiceCharges", () => {
  it("uses FDIC quarters as reported and de-cumulates NCUA year-to-date figures", () => {
    const fdic = quarterlyServiceCharges([
      { report_date: "2026-03-31", source: "fdic", service_charge_income: 100 },
      { report_date: "2026-06-30", source: "fdic", service_charge_income: 110 },
      { report_date: "2026-06-30", source: "ffiec", service_charge_income: 9e9 },
    ]);
    expect(fdic).toEqual({ source: "fdic", series: [{ quarter: "2026Q1", value: 100_000 }, { quarter: "2026Q2", value: 110_000 }] });

    const ncua = quarterlyServiceCharges([
      { report_date: "2025-09-30", source: "ncua", service_charge_income: 300 },
      { report_date: "2025-12-31", source: "ncua", service_charge_income: 420 },
      { report_date: "2026-03-31", source: "ncua", service_charge_income: 90 },
      { report_date: "2026-06-30", source: "ncua", service_charge_income: 200 },
    ]);
    // 2025Q3 has no 2025Q2 to subtract, so the run starts at 2025Q4.
    expect(ncua?.series).toEqual([
      { quarter: "2025Q4", value: 120_000 },
      { quarter: "2026Q1", value: 90_000 },
      { quarter: "2026Q2", value: 110_000 },
    ]);
  });

  it("keeps only the latest unbroken run of quarters", () => {
    expect(latestContiguousRun(quarters([1, 2, 3, 4, 5, 6])).length).toBe(6);
    const gapped = [...quarters([1, 2]), ...quarters([3, 4], 2012)];
    expect(latestContiguousRun(gapped).map((p) => p.quarter)).toEqual(["2012Q1", "2012Q2"]);
  });
});

describe("deflate", () => {
  it("restates every quarter in the base quarter's dollars and drops quarters without a deflator", () => {
    const deflator = quarterlyDeflator([
      { date: "2025-01-01", value: 100 },
      { date: "2025-04-01", value: 110 },
    ]);
    const result = deflate(quarters([100, 100, 100], 2025), deflator);
    expect(result?.base).toBe("2025Q2");
    expect(result?.series).toEqual([{ quarter: "2025Q1", value: expect.closeTo(110, 9) }, { quarter: "2025Q2", value: 100 }]);
  });

  it("averages monthly observations into quarters", () => {
    const deflator = quarterlyDeflator([
      { date: "2025-01-01", value: 1 },
      { date: "2025-02-01", value: 2 },
      { date: "2025-03-01", value: 3 },
    ]);
    expect(deflator.get("2025Q1")).toBe(2);
  });
});

describe("seasonallyAdjust", () => {
  it("recovers known seasonal factors from a trending series", () => {
    const truth = [0.9, 1.0, 1.05, 1.05];
    const values = Array.from({ length: 40 }, (_, t) => 1000 * 1.01 ** t * truth[t % 4]);
    const result = seasonallyAdjust(quarters(values));
    expect(result.applied).toBe(true);
    result.factors.forEach((factor, i) => expect(factor).toBeCloseTo(truth[i], 2));
    // Adjusted series is the smooth trend.
    const ratios = result.adjusted.slice(1).map((p, i) => p.value / result.adjusted[i].value);
    ratios.forEach((ratio) => expect(ratio).toBeCloseTo(1.01, 2));
  });

  it("leaves short or non-positive series unadjusted", () => {
    expect(seasonallyAdjust(quarters([1, 2, 3])).applied).toBe(false);
    expect(seasonallyAdjust(quarters(Array.from({ length: 16 }, (_, i) => (i === 3 ? 0 : 5)))).applied).toBe(false);
  });
});

describe("ols and trend", () => {
  it("fits an exact line", () => {
    const fit = ols([[1, 0], [1, 1], [1, 2], [1, 3]], [1, 3, 5, 7]);
    expect(fit?.beta[0]).toBeCloseTo(1, 10);
    expect(fit?.beta[1]).toBeCloseTo(2, 10);
  });

  it("annualizes the quarterly log slope", () => {
    const next = rng(7);
    const values = Array.from({ length: 48 }, (_, t) => 500 * 0.99 ** t * Math.exp(0.01 * normal(next)));
    const trend = logTrend(values)!;
    expect(trend.annual_growth_pct).toBeCloseTo((0.99 ** 4 - 1) * 100, 0);
    expect(trend.significant).toBe(true);
  });
});

describe("adfTest", () => {
  it("rejects a unit root for a trend-stationary series and not for a random walk", () => {
    const next = rng(42);
    const stationary: number[] = [];
    let e = 0;
    for (let t = 0; t < 120; t += 1) {
      e = 0.3 * e + normal(next);
      stationary.push(0.05 * t + e);
    }
    expect(adfTest(stationary)!.trend_stationary).toBe(true);

    const walk: number[] = [0];
    for (let t = 1; t < 120; t += 1) walk.push(walk[t - 1] + normal(next));
    const result = adfTest(walk)!;
    expect(result.trend_stationary).toBe(false);
    expect(result.critical_5pct).toBeCloseTo(-3.41 - 4.39 / result.observations, 1);
  });

  it("needs at least 20 observations", () => {
    expect(adfTest([1, 2, 3])).toBeNull();
  });
});

describe("structuralBreak", () => {
  it("finds a level drop and the change in trend", () => {
    const next = rng(3);
    const values = Array.from({ length: 60 }, (_, t) =>
      (t < 40 ? 1000 * 1.01 ** t : 700 * 1.01 ** 40 * 0.995 ** (t - 40)) * Math.exp(0.01 * normal(next)),
    );
    const result = structuralBreak(quarters(values))!;
    expect(result.quarter).toBe("2020Q1");
    expect(result.significant).toBe(true);
    expect(result.level_shift_pct).toBeCloseTo(-30, 0);
    expect(result.growth_before_pct).toBeCloseTo((1.01 ** 4 - 1) * 100, 0);
    expect(result.growth_after_pct).toBeCloseTo((0.995 ** 4 - 1) * 100, 0);
  });

  it("does not call a break on a smooth series", () => {
    const next = rng(9);
    const values = Array.from({ length: 60 }, (_, t) => 1000 * 1.01 ** t * Math.exp(0.01 * normal(next)));
    expect(structuralBreak(quarters(values))!.significant).toBe(false);
  });
});

describe("annualTotals and cagrPct", () => {
  it("sums complete years and compounds between the first and last", () => {
    const nominal = quarters([10, 10, 10, 10, 11, 11, 11, 11, 12, 12], 2023);
    const real = quarters([20, 20, 20, 20, 22, 22, 22, 22, 24, 24], 2023);
    const years = annualTotals(nominal, real);
    expect(years).toEqual([
      { year: 2023, nominal: 40, real: 80, real_yoy_pct: null },
      { year: 2024, nominal: 44, real: 88, real_yoy_pct: expect.closeTo(10, 6) },
    ]);
    expect(cagrPct(years, "real")).toBeCloseTo(10, 6);
  });
});
