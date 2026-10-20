import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./call-reports", () => ({ getDistrictFeeRevenue: vi.fn() }));

import { getDistrictFeeRevenue, type DistrictFeeRevenue } from "./call-reports";
import { districtFinancialGroup, getDistrictFinancialGroups } from "./district-financial-summary";

function filing(overrides: Partial<DistrictFeeRevenue> = {}): DistrictFeeRevenue {
  return {
    fed_district: 6,
    report_date: "2026-03-31",
    source: "fdic",
    institution_count: 10,
    total_sc_income: 1234,
    avg_sc_income: 123,
    total_other_noninterest: 500,
    ...overrides,
  };
}

describe("districtFinancialGroup", () => {
  it("converts stored thousands to US dollars once and labels the measure", () => {
    const group = districtFinancialGroup(6, "fdic", filing());

    expect(group).toMatchObject({
      source: "fdic",
      charter_type: "bank",
      measure: "deposit_service_charge_income",
      status: "reported",
      report_date: "2026-03-31",
      institution_count: 10,
      total_income_usd: 1_234_000,
      mean_income_usd: 123_400,
      unit: "USD",
      stored_unit: "thousands of dollars",
      period_basis: "standalone_quarter",
    });
  });

  it("keeps the credit-union measure separate and named as broad fee income", () => {
    const group = districtFinancialGroup(6, "ncua", filing({ source: "ncua" }));

    expect(group).toMatchObject({ source: "ncua", charter_type: "credit_union", measure: "broad_credit_union_fee_income", source_period_basis: "year_to_date" });
  });

  it("withholds the mean below the five-institution floor but keeps the total", () => {
    const group = districtFinancialGroup(6, "fdic", filing({ institution_count: 4, total_sc_income: 40 }));

    expect(group.total_income_usd).toBe(40_000);
    expect(group.mean_income_usd).toBeNull();
  });

  it("marks a missing read unavailable rather than zero", () => {
    const group = districtFinancialGroup(6, "ncua", null);

    expect(group).toMatchObject({ status: "unavailable", report_date: null, institution_count: 0, total_income_usd: null, mean_income_usd: null });
  });

  it("refuses a row from the other regulator", () => {
    expect(districtFinancialGroup(6, "ncua", filing({ source: "fdic" })).status).toBe("unavailable");
  });
});

describe("getDistrictFinancialGroups", () => {
  beforeEach(() => vi.mocked(getDistrictFeeRevenue).mockReset());

  it("reads each regulator separately, each dated by its own filing", async () => {
    vi.mocked(getDistrictFeeRevenue).mockImplementation(async (_district, _date, source) => source === "fdic"
      ? filing({ report_date: "2026-06-30" })
      : filing({ source: "ncua", report_date: "2026-03-31", institution_count: 7, total_sc_income: 70 }));

    const groups = await getDistrictFinancialGroups(6);

    expect(getDistrictFeeRevenue).toHaveBeenCalledWith(6, undefined, "fdic");
    expect(getDistrictFeeRevenue).toHaveBeenCalledWith(6, undefined, "ncua");
    expect(getDistrictFeeRevenue).not.toHaveBeenCalledWith(6);
    expect(groups.map((g) => [g.source, g.report_date, g.total_income_usd])).toEqual([
      ["fdic", "2026-06-30", 1_234_000],
      ["ncua", "2026-03-31", 70_000],
    ]);
  });

  it("logs a failed read and marks that regulator failed, distinct from no filing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getDistrictFeeRevenue).mockImplementation(async (_district, _date, source) => {
      if (source === "ncua") throw new Error("boom");
      return filing();
    });

    const groups = await getDistrictFinancialGroups(6);

    expect(groups.map((g) => [g.source, g.status])).toEqual([["fdic", "reported"], ["ncua", "failed"]]);
    expect(groups[1]).toMatchObject({ report_date: null, institution_count: 0, total_income_usd: null, mean_income_usd: null });
    expect(error).toHaveBeenCalledWith(expect.stringContaining("district 6 ncua"), expect.any(Error));
    error.mockRestore();
  });

  it("keeps a district with no filing unavailable, not failed", async () => {
    vi.mocked(getDistrictFeeRevenue).mockResolvedValue(null);

    const groups = await getDistrictFinancialGroups(6);

    expect(groups.map((g) => g.status)).toEqual(["unavailable", "unavailable"]);
  });
});
