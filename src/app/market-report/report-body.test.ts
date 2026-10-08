import { describe, expect, it } from "vitest";
import { buildMarketBranchFootprint } from "@/lib/data-store/branches";
import { footprintLine } from "./report-body";

const footprint = buildMarketBranchFootprint(
  2025,
  [
    { institution_id: 7, branches: 12, deposits: 168_000 },
    { institution_id: 8, branches: "1", deposits: "1000" },
    { institution_id: null, branches: 27, deposits: 1_831_000 },
  ],
  [
    { institution_id: 20, branches: "4" },
    { institution_id: 21, branches: 1 },
    { institution_id: 7, branches: 3 },
  ],
);

describe("footprintLine", () => {
  it("gives a bank its branches and local deposit share", () => {
    expect(footprintLine(footprint, 7)).toBe("12 branches · 8.4% of local deposits");
    expect(footprintLine(footprint, 8)).toBe("1 branch · under 0.1% of local deposits");
  });

  it("gives a credit union its branch count and no share", () => {
    expect(footprintLine(footprint, 20)).toBe("4 branches");
    expect(footprintLine(footprint, 21)).toBe("1 branch");
  });

  it("is null for an institution with no branches on file", () => {
    expect(footprintLine(footprint, 9)).toBeNull();
    expect(footprintLine(null, 7)).toBeNull();
  });
});

describe("buildMarketBranchFootprint", () => {
  it("keeps market totals to bank branches, which carry deposits", () => {
    expect(footprint.totalBranches).toBe(40);
    expect(footprint.totalDeposits).toBe(2_000_000_000);
    expect(footprint.byInstitution[20]).toEqual({ branches: 4, deposits: null });
  });
});

describe("cityLabel and placeLabel", () => {
  it("title-cases all-caps city names and keeps mixed case", async () => {
    const { cityLabel, placeLabel } = await import("./report-body");
    expect(cityLabel("READING")).toBe("Reading");
    expect(cityLabel("WILKES-BARRE")).toBe("Wilkes-Barre");
    expect(cityLabel("KING OF PRUSSIA")).toBe("King of Prussia");
    expect(cityLabel("McAllen")).toBe("McAllen");
    expect(cityLabel("Blue Bell")).toBe("Blue Bell");
    expect(placeLabel("READING, PA")).toBe("Reading, PA");
    expect(placeLabel("Ambler, PA")).toBe("Ambler, PA");
  });
});
