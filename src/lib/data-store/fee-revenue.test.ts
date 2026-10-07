import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => {
  const mockSql = vi.fn();
  return { getSql: () => mockSql, sql: mockSql };
});

import { sql } from "./connection";
import { getCharterFeeRevenueSummary, getFeeRevenueData, getTierFeeRevenueSummary } from "./fee-revenue";
import { unfilteredFinancialReads } from "./financial-sources.test-helper";

const mock = sql as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mock.mockReset();
  mock.mockResolvedValue([]);
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
