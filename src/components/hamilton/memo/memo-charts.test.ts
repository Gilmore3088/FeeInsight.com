import { describe, expect, it } from "vitest";
import { dollarTicks, labelRows } from "./memo";

describe("labelRows", () => {
  it("keeps labels that are far apart on one row and moves close ones down", () => {
    expect(labelRows([10, 50, 90])).toEqual([0, 0, 0]);
    expect(labelRows([60, 63, 66, 90])).toEqual([0, 1, 2, 0]);
  });
});

describe("dollarTicks", () => {
  it("uses round steps with at most nine ticks", () => {
    expect(dollarTicks(36)).toEqual([0, 5, 10, 15, 20, 25, 30, 35]);
    expect(dollarTicks(6)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(dollarTicks(120).length).toBeLessThanOrEqual(9);
  });
});
