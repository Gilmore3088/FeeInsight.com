import { describe, expect, it } from "vitest";
import { buildFeeIncomeTrend } from "./report-trend";

function quarterEnd(i: number, startYear = 2015): string {
  const year = startYear + Math.floor(i / 4);
  return `${year}-${["03-31", "06-30", "09-30", "12-31"][i % 4]}`;
}

function quarterStart(i: number, startYear = 2015): string {
  const year = startYear + Math.floor(i / 4);
  return `${year}-${["01-01", "04-01", "07-01", "10-01"][i % 4]}`;
}

const QUARTERS = 40;
const seasonal = [0.96, 1.0, 1.03, 1.01];
// A bank whose fee income steps down 25% in 2022Q3 and then grows again.
const records = Array.from({ length: QUARTERS }, (_, i) => ({
  report_date: quarterEnd(i),
  source: "fdic",
  service_charge_income: Math.round(1_000 * 1.012 ** i * (i >= 30 ? 0.75 : 1) * seasonal[i % 4]),
}));
// Prices rise 0.5% a quarter.
const gdpPriceIndex = Array.from({ length: QUARTERS }, (_, i) => ({ date: quarterStart(i), value: 100 * 1.005 ** i }));
const industryServiceCharges = Array.from({ length: QUARTERS }, (_, i) => ({ date: quarterStart(i), value: 8_000 * 1.005 ** i }));

describe("buildFeeIncomeTrend", () => {
  it("reports real growth, the break and the industry comparison from data only", () => {
    const result = buildFeeIncomeTrend({ institutionName: "Clay County Bank", records, gdpPriceIndex, industryServiceCharges })!;
    expect(result).not.toBeNull();
    const { data } = result;
    expect(data).toMatchObject({ source: "fdic", quarters: 40, first_quarter: "2015Q1", last_quarter: "2024Q4", dollars_of: "2024Q4" });
    expect(data.structural_break).toMatchObject({ quarter: "2022Q3", significant: true });
    expect(data.structural_break!.level_shift_pct).toBeCloseTo(-25, 0);
    // Industry nominal grows with prices, so its real growth is about zero.
    expect(data.industry_real_cagr_pct).toBeCloseTo(0, 1);
    expect(data.seasonal_factors!.q1).toBeLessThan(1);
    expect(data.years.at(-1)).toMatchObject({ year: 2024 });

    const [trend, appendix] = result.exhibits;
    expect(trend.id).toBe("fee_income_trend");
    expect(trend.title).toContain("After inflation, Clay County Bank's deposit service charges");
    expect(trend.subtitle).toContain("shifted in 2022Q3");
    expect(trend.rows[0]).toHaveLength(trend.columns.length);
    expect(appendix.id).toBe("statistical_appendix");
    expect(appendix.rows.map((r) => r[0])).toEqual(["Trend growth, real", "Stationarity (ADF)", "Structural break", "Seasonal factors"]);
    expect(result.sources.map((s) => s.label)).toEqual(expect.arrayContaining(["GDP chain-type price index (GDPCTPI)"]));
  });

  it("returns nothing when there are too few quarters or no deflator", () => {
    expect(buildFeeIncomeTrend({ institutionName: "X", records: records.slice(-8), gdpPriceIndex, industryServiceCharges })).toBeNull();
    expect(buildFeeIncomeTrend({ institutionName: "X", records, gdpPriceIndex: [], industryServiceCharges })).toBeNull();
  });

  it("de-cumulates credit union year-to-date income and says the industry line is banks", () => {
    const ytd = Array.from({ length: QUARTERS }, (_, i) => {
      const q = i % 4;
      const base = 500 * 1.01 ** (i - q);
      return { report_date: quarterEnd(i), source: "ncua", service_charge_income: Math.round(base * (q + 1)) };
    });
    const result = buildFeeIncomeTrend({ institutionName: "Prairie CU", records: ytd, gdpPriceIndex, industryServiceCharges })!;
    expect(result.data.source).toBe("ncua");
    expect(result.data.income_label).toBe("fee income");
    expect(result.exhibits[0].note).toContain("The industry line covers banks");
  });
});
