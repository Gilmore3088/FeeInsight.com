import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => {
  const mockSql = Object.assign(vi.fn(), { unsafe: vi.fn((text: string) => text) });
  return { getSql: () => mockSql, sql: mockSql };
});

import { sql } from "./connection";
import { getCharterFeeRevenueSummary, getFeeRevenueData, getFiledFeeIncomeData, getTierFeeRevenueSummary } from "./fee-revenue";
import { unfilteredFinancialReads } from "./financial-sources.test-helper";

const mock = sql as unknown as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };

beforeEach(() => {
  mock.mockReset();
  mock.mockResolvedValue([]);
  mock.unsafe.mockClear();
});

describe("fee revenue reads use fdic and ncua rows only", () => {
  it.each([
    ["getFiledFeeIncomeData", () => getFiledFeeIncomeData()],
    ["getFeeRevenueData", () => getFeeRevenueData()],
    ["getTierFeeRevenueSummary", () => getTierFeeRevenueSummary()],
    ["getCharterFeeRevenueSummary", () => getCharterFeeRevenueSummary()],
  ])("%s filters the join and the latest-quarter subquery", async (_name, read) => {
    await read();
    expect(unfilteredFinancialReads(mock)).toEqual([]);
  });
});

describe("financial SQL numeric boundary", () => {
  const row = {
    institution_id: "4382", institution_name: "Pentagon Federal Credit Union", charter_type: "credit_union",
    regulatory_status: null, state_code: "VA", asset_size_tier: "regional", fed_district: "5",
    report_date: "2026-06-30", financial_source: "ncua", total_assets: "29196093",
    service_charge_income: "30032", fee_income_ratio: "10.29", avg_fee: "0", fee_count: "3", median_overdraft: null,
  };

  it.each([
    ["filing-only", getFiledFeeIncomeData], ["price/income correlation", getFeeRevenueData],
  ])("returns numeric %s values without converting USD thousands twice", async (_name, read) => {
    mock.mockResolvedValue([row]);
    expect(await read("ncua")).toEqual([expect.objectContaining({
      institution_id: 4382, fed_district: 5, financial_source: "ncua", report_date: "2026-06-30",
      total_assets: 29_196_093, service_charge_income: 30_032, fee_income_ratio: 10.29,
    })]);
  });

  it("retains genuine numeric zeros, missing nullable fields, and decimal fee prices", async () => {
    mock.mockResolvedValue([{ ...row, total_assets: "0", service_charge_income: "0", fee_income_ratio: "0", avg_fee: "12.75", median_overdraft: "0" },
      { ...row, institution_id: "2", total_assets: null, service_charge_income: null, fee_income_ratio: null, fed_district: null }]);
    expect(await getFeeRevenueData()).toEqual([
      expect.objectContaining({ institution_id: 4382, total_assets: 0, service_charge_income: 0, fee_income_ratio: 0, avg_fee: 12.75, fee_count: 3, median_overdraft: 0 }),
      expect.objectContaining({ institution_id: 2, total_assets: null, service_charge_income: null, fee_income_ratio: null, fed_district: null, median_overdraft: null }),
    ]);
  });

  it.each([undefined, "", "   ", "NaN", "Infinity", Number.NaN, false])("does not fabricate zero from an unusable optional numeric value %s", async (value) => {
    mock.mockResolvedValue([{ ...row, total_assets: value, service_charge_income: value, fee_income_ratio: value, fed_district: value, median_overdraft: value }]);
    expect(await getFeeRevenueData()).toEqual([expect.objectContaining({
      total_assets: null, service_charge_income: null, fee_income_ratio: null, fed_district: null, median_overdraft: null,
    })]);
  });

  it.each([null, "", "NaN", "Infinity", "0", "-1", "1.5", "9007199254740992"])("rejects an invalid institution identifier %s", async (id) => {
    mock.mockResolvedValue([{ ...row, institution_id: id }]);
    await expect(getFeeRevenueData()).rejects.toThrow(/Invalid .*financial/);
  });

  it.each(["avg_fee", "fee_count"])("does not manufacture a required %s from null", async (field) => {
    mock.mockResolvedValue([{ ...row, [field]: null }]);
    await expect(getFeeRevenueData()).rejects.toThrow("Invalid numeric financial record");
  });
});


describe("fee revenue fee-population contract", () => {
  it.each([
    ["getFeeRevenueData", () => getFeeRevenueData()],
    ["getTierFeeRevenueSummary", () => getTierFeeRevenueSummary()],
    ["getCharterFeeRevenueSummary", () => getCharterFeeRevenueSummary()],
  ])("%s uses sourced consumer/both values, retains zero, and de-duplicates tiers by category", async (_name, read) => {
    await read();
    expect(mock.unsafe).toHaveBeenCalled();
    const raw = mock.mock.calls.map((call) => Array.isArray(call[0]) ? call[0].join(" ") : String(call[0])).join("\n");
    expect(raw).toContain("ef.amount >= 0");
    expect(raw).not.toContain("ef.amount > 0");
    expect(raw).toContain("THEN MAX(ef.amount)");
    expect(raw).toContain("PERCENTILE_CONT(0.5)");
    expect(raw).toContain("HAVING COUNT(*) >= 3");
    const predicates = mock.unsafe.mock.calls.map((call) => String(call[0])).join("\n");
    expect(predicates).toContain("fee_audience IN ('consumer', 'both', 'unknown')");
    expect(predicates).toContain("source_document_id IS NOT NULL");
  });
});

describe("fee revenue reads split NCUA year-to-date income into quarters (#1245)", () => {
  it.each([
    ["getFiledFeeIncomeData", () => getFiledFeeIncomeData()],
    ["getFeeRevenueData", () => getFeeRevenueData()],
    ["getTierFeeRevenueSummary", () => getTierFeeRevenueSummary()],
    ["getCharterFeeRevenueSummary", () => getCharterFeeRevenueSummary()],
  ])("%s reads each quarter's own income, never the raw NCUA YTD", async (_name, read) => {
    await read();
    const fragments = mock.unsafe.mock.calls.map((call) => String(call[0])).join("\n");
    expect(fragments).toContain("inf.service_charge_income - prev.service_charge_income");
    expect(fragments).toContain("EXTRACT(QUARTER FROM inf.report_date::date) = 1");
    const raw = mock.mock.calls.map((call) => Array.isArray(call[0]) ? call[0].join(" ") : String(call[0])).join("\n");
    expect(raw).not.toContain("JOIN institution_financial_records ifin");
  });
});
