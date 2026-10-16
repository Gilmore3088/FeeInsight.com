import { describe, it, expect } from "vitest";
import { atmCost, overdraftDayCost, scenarioCost } from "./scenarios";

const policy = { perItem: 35, maxPerDay: 3, extended: 10, transfer: 12 };

describe("cost scenarios under one illustrative policy", () => {
  it("multiplies the per-item fee and applies the daily limit", () => {
    expect(scenarioCost(policy, { title: "One", items: 1 })).toMatchObject({ total: 35, limited: false });
    expect(scenarioCost(policy, { title: "Six", items: 6 })).toMatchObject({ total: 105, limited: true });
  });

  it("adds the extended charge and prices a transfer on its own", () => {
    expect(scenarioCost(policy, { title: "Negative", items: 1, extended: true }).total).toBe(45);
    expect(scenarioCost(policy, { title: "Transfer", items: 1, transfer: true }).total).toBe(12);
  });

  it("charges every item when there is no daily limit", () => {
    expect(scenarioCost({ ...policy, maxPerDay: null }, { title: "Six", items: 6 }).total).toBe(210);
  });
});

describe("reader calculators", () => {
  it("caps a day's overdraft fees at the account's limit", () => {
    expect(overdraftDayCost(35, 5, 3)).toEqual({ charged: 3, total: 105 });
    expect(overdraftDayCost(35, 5, null)).toEqual({ charged: 5, total: 175 });
  });

  it("nets a monthly ATM rebate and never goes below zero", () => {
    expect(atmCost(4, 3, 2, 0)).toEqual({ monthly: 20, yearly: 240 });
    expect(atmCost(4, 3, 2, 10)).toEqual({ monthly: 10, yearly: 120 });
    expect(atmCost(2, 3, 2, 15)).toEqual({ monthly: 0, yearly: 0 });
  });
});
