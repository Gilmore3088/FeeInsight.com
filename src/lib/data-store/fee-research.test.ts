import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => {
  const mockSql = vi.fn() as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
  mockSql.unsafe = vi.fn();
  return { getSql: () => mockSql, sql: mockSql };
});

import { sql } from "./connection";
import { getCategoryPeerAmounts, getLocalMarketBanks } from "./fee-research";

const unsafe = () => (sql as unknown as { unsafe: ReturnType<typeof vi.fn> }).unsafe;

beforeEach(() => unsafe().mockReset());

describe("getCategoryPeerAmounts", () => {
  it("filters by layer with numbered placeholders and takes overdraft's highest tier", async () => {
    unsafe().mockResolvedValueOnce([
      { institution_id: 1, fee_category: "overdraft", amount: "25", institution_name: "A", state_code: "TX", charter_type: "bank" },
      { institution_id: 1, fee_category: "overdraft", amount: "35", institution_name: "A", state_code: "TX", charter_type: "bank" },
      { institution_id: 2, fee_category: "overdraft", amount: "0", institution_name: "B", state_code: "TX", charter_type: "bank" },
    ]);
    const out = await getCategoryPeerAmounts("overdraft", { charter: "bank", stateCode: "TX", fedDistrict: 11 });
    const [query, params] = unsafe().mock.calls[0];
    expect(query).toContain("ct.charter_type = $2");
    expect(query).toContain("ct.state_code = $3");
    expect(query).toContain("ct.fed_district = $4");
    expect(params).toEqual(["overdraft", "bank", "TX", 11]);
    expect(out.map((p) => [p.name, p.amount])).toEqual([["B", 0], ["A", 35]]);
  });
});

describe("getLocalMarketBanks", () => {
  it("returns deposit shares, the bank itself, and published fees", async () => {
    unsafe()
      .mockResolvedValueOnce([
        { institution_id: 9, cert: 1, deposits: "600", market_deposits: "1000", year: 2025, county_count: 2, institution_name: "Big", charter_type: "bank" },
        { institution_id: 5, cert: 2, deposits: "300", market_deposits: "1000", year: 2025, county_count: 2, institution_name: "Us", charter_type: "bank" },
        { institution_id: null, cert: 3, deposits: "100", market_deposits: "1000", year: 2025, county_count: 2, institution_name: null, charter_type: null },
      ])
      .mockResolvedValueOnce([{ institution_id: 9, fee_category: "overdraft", amount: "35" }]);
    const market = await getLocalMarketBanks(5, "overdraft");
    expect(market?.year).toBe(2025);
    expect(market?.banks.map((b) => [b.name, b.share, b.feeAmount, b.isSelf])).toEqual([
      ["Big", 0.6, 35, false],
      ["Us", 0.3, null, true],
      ["FDIC certificate 3", 0.1, null, false],
    ]);
  });

  it("returns null without branch data", async () => {
    unsafe().mockResolvedValueOnce([]);
    expect(await getLocalMarketBanks(5, "overdraft")).toBeNull();
  });
});
