import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => {
  const mockSql = Object.assign(vi.fn(), { unsafe: vi.fn((text: string) => text) });
  return { getSql: () => mockSql, sql: mockSql };
});

import { sql } from "./connection";
import { getCharterFeeRevenueSummary, getFeeRevenueData, getTierFeeRevenueSummary } from "./fee-revenue";
import { unfilteredFinancialReads } from "./financial-sources.test-helper";

const mock = sql as unknown as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };

beforeEach(() => {
  mock.mockReset();
  mock.mockResolvedValue([]);
  mock.unsafe.mockClear();
});

describe("fee revenue reads use fdic and ncua rows only", () => {
  it.each([
    ["getFeeRevenueData", () => getFeeRevenueData()],
    ["getTierFeeRevenueSummary", () => getTierFeeRevenueSummary()],
    ["getCharterFeeRevenueSummary", () => getCharterFeeRevenueSummary()],
  ])("%s filters the join and the latest-quarter subquery", async (_name, read) => {
    await read();
    expect(unfilteredFinancialReads(mock)).toEqual([]);
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
    expect(predicates).toContain("fee_audience IN ('consumer', 'both')");
    expect(predicates).toContain("source_document_id IS NOT NULL");
  });
});
