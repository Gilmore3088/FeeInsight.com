import { describe, expect, it } from "vitest";
import { compareValues } from "./sortable-table";

describe("compareValues", () => {
  it("orders Postgres timestamps by time, not by their weekday-first string", () => {
    // Friday 9 October vs Wednesday 8 April: as strings "Fri ..." sorts before "Wed ...".
    const october = new Date("2026-10-09T12:00:00Z");
    const april = new Date("2026-04-08T12:00:00Z");
    expect(compareValues(october, april)).toBeGreaterThan(0);
    expect(compareValues(april, october)).toBeLessThan(0);
  });

  it("keeps numbers numeric and missing values last", () => {
    expect(compareValues(2, 10)).toBeLessThan(0);
    expect(compareValues(null, 1)).toBe(1);
    expect(compareValues(1, undefined)).toBe(-1);
  });
});
