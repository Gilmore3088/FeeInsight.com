import { describe, expect, it } from "vitest";
import { ordinal } from "./at-a-glance";

describe("the At a glance rank label", () => {
  it("reads as a percentile, not a count of competitors", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 50, 100].map(ordinal)).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "50th", "100th",
    ]);
  });
});
