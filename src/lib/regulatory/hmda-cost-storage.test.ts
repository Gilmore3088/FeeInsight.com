import { describe, expect, it } from "vitest";
import { HMDA_COST_FIELDS } from "./hmda";
import { packHmdaCosts, unpackHmdaCosts, type HmdaCostDetail } from "./hmda-cost-storage";

const costs = Object.fromEntries(HMDA_COST_FIELDS.map((field, i) => [field, {
  n: i, median: i ? 123.456 : null, p25: i ? 0 : null, p75: i ? 500.5 : null,
  exempt: 0, na: 2, blank: 3, unreadable: 1, negative: 4,
}])) as HmdaCostDetail;

describe("HMDA cost storage", () => {
  it("round trips every statistic, zero, null and fractional amount in both formats", () => {
    expect(unpackHmdaCosts(costs)).toEqual(costs);
    expect(unpackHmdaCosts(JSON.parse(JSON.stringify(packHmdaCosts(costs))))).toEqual(costs);
    expect(JSON.stringify(packHmdaCosts(costs)).length).toBeLessThan(JSON.stringify(costs).length / 2);
  });
  it("rejects unknown versions, missing cells, non-finite numbers and missing counters", () => {
    expect(unpackHmdaCosts([2, ...packHmdaCosts(costs).slice(1)])).toBeNull();
    expect(unpackHmdaCosts([1])).toBeNull();
    expect(unpackHmdaCosts({ ...costs, discount_points: { ...costs.discount_points, blank: null } })).toBeNull();
    expect(unpackHmdaCosts({ ...costs, lender_credits: { ...costs.lender_credits, n: 1.1 } })).toBeNull();
    expect(unpackHmdaCosts({ ...costs, lender_credits: { ...costs.lender_credits, p75: Infinity } })).toBeNull();
  });
});
