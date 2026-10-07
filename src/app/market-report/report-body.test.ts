import { describe, expect, it } from "vitest";
import { footprintLine } from "./report-body";

const footprint = {
  sod_year: 2025,
  totalBranches: 40,
  totalDeposits: 2_000_000_000,
  byInstitution: { 7: { branches: 12, deposits: 168_000_000 }, 8: { branches: 1, deposits: 1_000_000 } },
};

describe("footprintLine", () => {
  it("gives branches and local deposit share", () => {
    expect(footprintLine(footprint, 7)).toBe("12 branches · 8.4% of local deposits");
    expect(footprintLine(footprint, 8)).toBe("1 branch · under 0.1% of local deposits");
  });

  it("is null for an institution with no branches in the survey, such as a credit union", () => {
    expect(footprintLine(footprint, 9)).toBeNull();
    expect(footprintLine(null, 7)).toBeNull();
  });
});
