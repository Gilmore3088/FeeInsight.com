import { describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({ sql: vi.fn(), getSql: vi.fn() }));

import type { MarketLeader } from "./market-leaders";
import { summarizeTopTen } from "./top-ten-coverage";

function leader(state_code: string, institution_id: number, deposit_rank: number): MarketLeader {
  return {
    state_code, institution_id, deposit_rank, deposits: 1, service_charge_income: null, total_income: null,
    service_charge_rank: 99, total_income_rank: 99,
  };
}

describe("top 10 per state coverage", () => {
  it("counts each state slot, live and with overdraft", () => {
    const leaders = [leader("TX", 1, 1), leader("OK", 1, 4), leader("TX", 2, 2), leader("TX", 3, 3)];
    const live = new Map([
      [1, { types: 12, hasOverdraft: true }],
      [2, { types: 5, hasOverdraft: false }],
    ]);
    const coverage = summarizeTopTen(leaders, live);
    expect(coverage).toMatchObject({ slots: 4, live: 3, liveOverdraft: 2 });
    expect([...coverage.missing.entries()]).toEqual([[3, [{ stateCode: "TX", rank: 3 }]]]);
  });

  it("leaves out ranks past 10 (income-only leaders) and territories", () => {
    const coverage = summarizeTopTen([leader("TX", 1, 11), leader("PR", 2, 1), leader("GU", 3, 2)], new Map());
    expect(coverage.slots).toBe(0);
    expect(coverage.missing.size).toBe(0);
  });

  it("lists every slot a missing institution holds", () => {
    const coverage = summarizeTopTen([leader("NY", 7, 2), leader("UT", 7, 2)], new Map());
    expect(coverage.missing.get(7)).toEqual([
      { stateCode: "NY", rank: 2 },
      { stateCode: "UT", rank: 2 },
    ]);
  });
});
