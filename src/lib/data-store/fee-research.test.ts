import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => {
  const mockSql = vi.fn() as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
  mockSql.unsafe = vi.fn();
  return { getSql: () => mockSql, sql: mockSql };
});

import { sql } from "./connection";
import { getCategoryPeerAmounts } from "./fee-research";

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
