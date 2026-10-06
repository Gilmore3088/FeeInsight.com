import { describe, expect, it } from "vitest";
import type { InstitutionFinancialHistoryRow } from "@/lib/data-store/financial";
import type { PeerPercentiles } from "@/lib/data-store/financial";
import {
  buildFinancialSeries,
  computeGrowth,
  findOutliers,
  toPeerMedianPoints,
  toPeerRankRows,
} from "./financial-history";

function row(overrides: Partial<InstitutionFinancialHistoryRow>): InstitutionFinancialHistoryRow {
  return {
    institution_id: 1,
    report_date: "2026-03-31",
    source: "fdic",
    total_assets: 1_000_000,
    total_deposits: 800_000,
    total_loans: 600_000,
    service_charge_income: 1_500,
    other_noninterest_income: null,
    net_interest_margin: 3.1,
    efficiency_ratio: 58,
    roa: 1.1,
    roe: null,
    tier1_capital_ratio: 13,
    branch_count: 10,
    employee_count: null,
    member_count: null,
    total_revenue: null,
    fee_income_ratio: null,
    overdraft_revenue: null,
    net_income: 2_500,
    net_interest_income: null,
    noninterest_expense: null,
    provision_for_losses: null,
    net_charge_offs: null,
    noncurrent_loans: null,
    total_equity: 100_000,
    loans_real_estate: 300_000,
    loans_commercial: 150_000,
    loans_consumer: 100_000,
    loans_agricultural: null,
    net_charge_off_rate: 0.4,
    noncurrent_loan_rate: 0.7,
    leverage_ratio: null,
    total_capital_ratio: null,
    total_securities: null,
    loans_credit_card: null,
    loans_auto: null,
    core_deposits: null,
    brokered_deposits: null,
    uninsured_deposits: null,
    fetched_at: null,
    ...overrides,
  };
}

describe("financial history series", () => {
  it("converts thousands to dollars, keeps one source per quarter, oldest first", () => {
    const series = buildFinancialSeries([
      row({ report_date: "2026-03-31" }),
      row({ report_date: "2026-03-31", source: "ffiec", total_assets: 999 }),
      row({ report_date: "2025-12-31", total_assets: 900_000 }),
    ]);

    expect(series.map((p) => p.quarter)).toEqual(["Q4 2025", "Q1 2026"]);
    expect(series[1]).toMatchObject({
      source: "fdic",
      assets: 1_000_000_000,
      netIncome: 2_500_000,
      serviceCharges: 1_500_000,
      loansOther: 50_000_000,
      roaPct: 1.1,
    });
  });

  it("drops income from legacy rows that predate the registry", () => {
    const [ncua] = buildFinancialSeries([row({ source: "ncua", roa: 0, net_income: null })]);
    expect(ncua.netIncome).toBeNull();
    expect(ncua.serviceCharges).toBeNull();
    expect(ncua.roaPct).toBeNull();

    const [legacy] = buildFinancialSeries([row({ net_income: null })]);
    expect(legacy.serviceCharges).toBeNull();
    expect(legacy.assets).toBe(1_000_000_000);
  });

  it("hides peer medians built from too few peers", () => {
    const base = {
      report_date: "2026-03-31",
      source: "fdic",
      roa: 1,
      net_interest_margin: 3,
      efficiency_ratio: 60,
      net_charge_off_rate: 0.2,
      noncurrent_loan_rate: 0.5,
      tier1_capital_ratio: 12,
      fee_income_ratio: 0.04,
      roe: 10,
      leverage_ratio: 9,
      total_capital_ratio: 13,
    };
    expect(toPeerMedianPoints({ ...base, peer_count: 2 })).toBeNull();
    expect(toPeerMedianPoints({ ...base, peer_count: 40 })).toMatchObject({ quarter: "Q1 2026", roaPct: 1 });
  });

  it("turns registry NCUA year-to-date income into quarterly figures within each year", () => {
    const ncua = (report_date: string, net_income: number | null, fee: number) =>
      row({ source: "ncua", report_date, net_income, service_charge_income: fee });
    const series = buildFinancialSeries([
      ncua("2025-09-30", 300, 90),
      ncua("2025-12-31", 420, 120),
      ncua("2026-03-31", 110, 35),
      ncua("2026-06-30", 230, 70),
      ncua("2026-12-31", 500, 150), // Q3 2026 missing: no contiguous prior quarter
    ]);
    expect(series.map((p) => [p.quarter, p.netIncome, p.serviceCharges])).toEqual([
      ["Q3 2025", null, null],
      ["Q4 2025", 120_000, 30_000],
      ["Q1 2026", 110_000, 35_000],
      ["Q2 2026", 120_000, 35_000],
      ["Q4 2026", null, null],
    ]);
  });
});

/** Quarter-end dates from `from` for `count` quarters. */
function quarters(from: string, count: number): string[] {
  const out: string[] = [];
  let year = Number(from.slice(0, 4));
  let q = Math.floor(Number(from.slice(5, 7)) / 3);
  for (let i = 0; i < count; i++) {
    out.push(`${year}-${["03-31", "06-30", "09-30", "12-31"][q - 1]}`);
    q += 1;
    if (q === 5) {
      q = 1;
      year += 1;
    }
  }
  return out;
}

describe("growth", () => {
  it("compares balances a quarter, a year, five and ten years back", () => {
    const dates = quarters("2016-06-30", 41); // Q2 2016 .. Q2 2026
    const series = buildFinancialSeries(
      dates.map((report_date, i) => row({ report_date, total_assets: 1_000_000 + i * 10_000 })),
    );
    const assets = computeGrowth(series).find((r) => r.key === "assets")!;
    expect(assets.latestQuarter).toBe("Q2 2026");
    expect(assets.latest).toBe(1_400_000_000);
    expect(assets.qoq).toBeCloseTo((1_400 / 1_390 - 1) * 100, 6);
    expect(assets.yoy).toBeCloseTo((1_400 / 1_360 - 1) * 100, 6);
    expect(assets.cagr5).toBeCloseTo((Math.pow(1_400 / 1_200, 1 / 5) - 1) * 100, 6);
    expect(assets.cagr10).toBeCloseTo((Math.pow(1_400 / 1_000, 1 / 10) - 1) * 100, 6);
  });

  it("uses four-quarter totals for income and leaves gaps empty", () => {
    const dates = quarters("2024-03-31", 10); // Q1 2024 .. Q2 2026
    const series = buildFinancialSeries(
      dates.map((report_date, i) => row({ report_date, service_charge_income: i < 6 ? 100 : 150 })),
    );
    const charges = computeGrowth(series).find((r) => r.key === "serviceCharges")!;
    expect(charges.latest).toBe(600_000); // 4 x 150 thousand
    expect(charges.qoq).toBeNull();
    expect(charges.yoy).toBeCloseTo(50, 6); // 600 vs 400
    expect(charges.cagr5).toBeNull();

    const withGap = computeGrowth(buildFinancialSeries([row({ report_date: "2026-06-30" })]));
    expect(withGap.find((r) => r.key === "serviceCharges")).toBeUndefined();
    expect(withGap.find((r) => r.key === "assets")?.yoy).toBeNull();
  });

  it("never reports growth from a zero or negative base", () => {
    const series = buildFinancialSeries([
      row({ report_date: "2025-06-30", total_securities: 0 }),
      row({ report_date: "2026-06-30", total_securities: 5_000 }),
    ]);
    expect(computeGrowth(series).find((r) => r.key === "securities")?.yoy).toBeNull();
  });
});

describe("outliers and peer rank", () => {
  const peers = (percentiles: Partial<PeerPercentiles["percentiles"]>): PeerPercentiles => ({
    report_date: "2026-06-30",
    source: "fdic",
    peer_count: 894,
    percentiles: {
      total_assets: 50,
      asset_growth: null,
      deposit_growth: null,
      loan_growth: null,
      roa: null,
      roe: null,
      net_interest_margin: null,
      efficiency_ratio: null,
      fee_income_ratio: null,
      net_charge_off_rate: null,
      noncurrent_loan_rate: null,
      tier1_capital_ratio: null,
      brokered_share: null,
      uninsured_share: null,
      ...percentiles,
    },
  });

  it("states fee income outpacing assets, a merger-sized jump, and a loss", () => {
    const dates = quarters("2024-09-30", 8); // Q3 2024 .. Q2 2026
    const series = buildFinancialSeries(
      dates.map((report_date, i) =>
        row({
          report_date,
          total_assets: i < 4 ? 1_000_000 : 1_400_000,
          service_charge_income: i < 4 ? 100 : 200,
          net_income: -50,
        }),
      ),
    );
    const flags = findOutliers(series, computeGrowth(series), null);
    expect(flags.map((f) => f.id)).toEqual(["fees-vs-assets", "asset-jump", "net-loss"]);
    expect(flags[0].text).toBe("Deposit service charges +100% over the past year while total assets moved +40%.");
  });

  it("flags only the top and bottom 5% of peers, never asset size", () => {
    const flags = findOutliers([], [], peers({ total_assets: 99, roa: 2, fee_income_ratio: 99, roe: 50 }));
    expect(flags.map((f) => f.id)).toEqual(["peer-low-roa", "peer-high-fee_income_ratio"]);
    expect(flags[1].text).toBe("Fee income share of revenue is in the highest 5% of peers.");
  });

  it("lists only ranked metrics", () => {
    expect(toPeerRankRows(null)).toEqual([]);
    expect(toPeerRankRows(peers({ roa: 40 })).map((r) => [r.metric, r.percentile])).toEqual([
      ["total_assets", 50],
      ["roa", 40],
    ]);
  });

  it("notes a record high in deposit service charges only with five years on file", () => {
    const dates = quarters("2020-03-31", 26);
    const series = buildFinancialSeries(dates.map((report_date, i) => row({ report_date, service_charge_income: 100 + i })));
    expect(findOutliers(series, computeGrowth(series), null).map((f) => f.id)).toContain("fees-record-high");
    const short = buildFinancialSeries(quarters("2024-03-31", 10).map((report_date, i) => row({ report_date, service_charge_income: 100 + i })));
    expect(findOutliers(short, computeGrowth(short), null).map((f) => f.id)).not.toContain("fees-record-high");
  });
});
