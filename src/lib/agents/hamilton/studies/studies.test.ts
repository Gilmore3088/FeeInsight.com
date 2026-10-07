import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import { assetBand, quarterLabel, type InstitutionPrice } from "./common";
import { buildFeeDependence, latestYearOf, withinTrend, type DependenceRow } from "./fee-dependence";
import { buildInferredVolume, type IncomeFeeRow } from "./inferred-volume";
import { runPriceStudy } from "./price-study";
import { median, midRankPercentile, ols, quartileOf, ranks, spearman } from "./stats";

describe("stats", () => {
  it("ranks ties at their mean rank and computes Spearman", () => {
    expect(ranks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
    expect(spearman([1, 2, 3, 4, 5], [2, 4, 6, 8, 10])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4, 5], [5, 4, 3, 2, 1])).toBeCloseTo(-1);
  });

  it("places a value by mid-rank percentile and quartile", () => {
    expect(midRankPercentile(30, [10, 20, 30, 40])).toBe(62.5);
    expect(quartileOf(62.5)).toBe(3);
    expect(median([3, 1, 2])).toBe(2);
  });

  it("recovers known OLS coefficients", () => {
    const x = Array.from({ length: 50 }, (_, i) => i);
    const z = x.map((v) => (v * 7) % 11);
    const y = x.map((v, i) => 3 + 2 * v - 0.5 * z[i]);
    const fit = ols(y, { x, z })!;
    const coef = Object.fromEntries(fit.coefficients.map((c) => [c.name, c.estimate]));
    expect(coef.intercept).toBeCloseTo(3);
    expect(coef.x).toBeCloseTo(2);
    expect(coef.z).toBeCloseTo(-0.5);
    expect(fit.r2).toBeCloseTo(1);
  });

  it("returns null for a singular design", () => {
    const x = Array.from({ length: 20 }, (_, i) => i);
    expect(ols(x, { a: x, b: x.map((v) => v * 2) })).toBeNull();
  });
});

describe("common", () => {
  it("bands assets stored in thousands", () => {
    expect(assetBand(50_000)).toBe("under $100M");
    expect(assetBand(385_833)).toBe("$100M-$1B");
    expect(assetBand(3_000_000)).toBe("$1B-$10B");
    expect(assetBand(66_000_000)).toBe("$10B+");
    expect(assetBand(null)).toBe("size unknown");
  });

  it("labels the calendar quarter", () => {
    expect(quarterLabel(new Date("2026-10-07T00:00:00Z"))).toBe("2026-Q4");
    expect(quarterLabel(new Date("2026-03-31T00:00:00Z"))).toBe("2026-Q1");
  });
});

describe("price study", () => {
  it("finds a price that rises with the driver, controlling for size and charter", () => {
    const prices: InstitutionPrice[] = [];
    const values = new Map<number, number>();
    for (let i = 1; i <= 200; i++) {
      const income = 40_000 + i * 300;
      values.set(i, income);
      const charter = i % 3 === 0 ? "credit_union" : "bank";
      const assets = 100_000 + ((i * 37) % 50) * 20_000;
      prices.push({ institutionId: i, charter, assetsThousands: assets, fee: "monthly_maintenance", amount: 5 + income / 10_000 + (i % 5) * 0.1 });
      prices.push({ institutionId: i, charter, assetsThousands: assets, fee: "overdraft", amount: 30 + ((i * 13) % 7) - 3 });
    }
    const result = runPriceStudy(prices, { key: "local_income", label: "local income", perUnits: 10_000, perLabel: "$10,000 of local income", values });
    const maintenance = result.fees.find((f) => f.fee === "monthly_maintenance")!;
    expect(maintenance.effect!.estimate).toBeCloseTo(1, 1);
    expect(maintenance.significant).toBe(true);
    expect(maintenance.fifths.map((f) => f.n).reduce((a, b) => a + b, 0)).toBe(200);
    expect(maintenance.fifths[4].meanPrice!).toBeGreaterThan(maintenance.fifths[0].meanPrice!);
    const overdraft = result.fees.find((f) => f.fee === "overdraft")!;
    expect(Math.abs(overdraft.spearman!)).toBeLessThan(0.2);
    expect(result.headline).toContain("monthly maintenance");
    expect(result.placements).toHaveLength(200);
    const top = result.placements.find((p) => p.institutionId === 200)!;
    expect(top.quartile).toBe(4);
    expect(top.detail?.fifth).toBe(5);
  });

  it("drops institutions without a driver value", () => {
    const prices: InstitutionPrice[] = [{ institutionId: 1, charter: "bank", assetsThousands: 1, fee: "nsf", amount: 30 }];
    const result = runPriceStudy(prices, { key: "x", label: "x", perUnits: 1, perLabel: "1", values: new Map() });
    expect(result.institutions).toBe(0);
    expect(result.fees).toHaveLength(0);
  });
});

describe("fee dependence", () => {
  const rows: DependenceRow[] = [];
  for (let id = 1; id <= 20; id++) {
    for (let year = 2010; year <= 2025; year++) {
      rows.push({ institutionId: id, charter: id <= 10 ? "bank" : "credit_union", year, assetsThousands: 200_000, ratio: (id <= 10 ? 0.06 : 0.1) - (year - 2010) * 0.002 + id * 0.0001 });
    }
  }
  rows.push({ institutionId: null, charter: "bank", year: 2010, assetsThousands: 50_000, ratio: 0.09 });

  it("measures the within-institution trend", () => {
    const t = withinTrend(rows.filter((r) => r.charter === "bank"))!;
    expect(t.slopePerYear).toBeCloseTo(-0.002);
    expect(t.institutions).toBe(10);
  });

  it("builds a series per charter and places current institutions", () => {
    const built = buildFeeDependence(rows)!;
    expect(built.record.asOf).toBe("2025");
    const series = built.record.findings.series as Record<string, Array<{ year: number; n: number; median: number }>>;
    expect(series.bank[0]).toMatchObject({ year: 2010, n: 11 });
    expect(series.credit_union.at(-1)!.year).toBe(2025);
    expect(built.placements).toHaveLength(20);
    const p = built.placements.find((x) => x.institutionId === 10)!;
    expect(p.peerGroup).toBe("banks $100M-$1B");
    expect(p.peerN).toBe(10);
    expect(p.detail?.first_year).toBe(2010);
    expect(String(built.record.findings.headline)).toContain("typical bank");
  });

  it("finds the latest year of a full-size panel without overflowing the call stack", () => {
    const years = Array.from({ length: 500_000 }, (_, i) => ({ year: 2010 + (i % 16) }));
    expect(latestYearOf(years)).toBe(2025);
  });
});

describe("inferred volume", () => {
  it("divides income by the published fee and labels the range inferred", () => {
    const input: IncomeFeeRow[] = [
      { institutionId: 1, charter: "credit_union", assetsThousands: 500_000, period: "2024-12-31", feeCategory: "overdraft", incomeDollars: 300_000, feeLow: 25, feeHigh: 30 },
      { institutionId: 2, charter: "credit_union", assetsThousands: 600_000, period: "2024-12-31", feeCategory: "overdraft", incomeDollars: 150_000, feeLow: 30, feeHigh: 30 },
    ];
    const built = buildInferredVolume(input);
    expect(built.rows[0]).toMatchObject({ itemsLow: 10_000, itemsHigh: 12_000, peerN: 2 });
    expect(built.rows[1]).toMatchObject({ itemsLow: 5_000, itemsHigh: 5_000 });
    expect(built.placements[0].detail?.label).toBe("inferred");
    expect(built.record.findings.label).toBe("inferred");
    expect(built.record.asOf).toBe("2024-12-31");
  });
});
