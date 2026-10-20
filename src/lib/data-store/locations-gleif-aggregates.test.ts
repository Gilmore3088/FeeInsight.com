import { describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({ sql: vi.fn() }));

import { buildFamilyTree, clampMiles, summarizeBranchAtms, type FamilyMemberRow } from "./locations-gleif-aggregates";

const member = (lei: string, parent: string | null, name: string): FamilyMemberRow => ({
  lei,
  legal_name: name,
  jurisdiction: "US",
  legal_country: "US",
  entity_status: "ACTIVE",
  registration_status: "ISSUED",
  direct_parent_lei: parent,
  rssd_id: null,
  institution_id: null,
  institution_name: null,
  link_method: null,
  has_record: true,
});

describe("clampMiles", () => {
  it("caps the radius at 50 miles and refuses non-positive values", () => {
    expect(clampMiles(5)).toBe(5);
    expect(clampMiles(500)).toBe(50);
    expect(clampMiles(0)).toBeNull();
    expect(clampMiles(Number.NaN)).toBeNull();
  });
});

describe("summarizeBranchAtms", () => {
  const row = (competitor_atms: number) => ({ source: "fdic_sod" as const, branch_name: null, address: null, city: null, state: "TX", competitor_atms, competitor_atms_linked: 0, competitor_brands: 0, nearest_competitor_atm_miles: null, own_atms: 0 });

  it("gives the median competitor ATMs per branch with its count", () => {
    const s = summarizeBranchAtms(2, [row(0), row(3), row(5), row(10)], 1);
    expect(s).toMatchObject({ miles: 2, median_competitor_atms: 4, median_count: 4, branches_with_no_competitor_atm: 1, branches_without_coordinates: 1 });
  });

  it("gives no median without branches", () => {
    expect(summarizeBranchAtms(2, [], 3)).toMatchObject({ median_competitor_atms: null, median_count: 0 });
  });
});

describe("buildFamilyTree", () => {
  it("nests members under their direct parents and hangs orphans off the root", () => {
    const tree = buildFamilyTree("HOLD", [
      member("HOLD", null, "Holdco"),
      member("MID", "HOLD", "Intermediate"),
      member("BANK", "MID", "Bank"),
      member("ORPHAN", "NOT-IN-FAMILY", "Orphan"),
    ]);
    expect(tree?.lei).toBe("HOLD");
    expect(tree?.children.map((c) => c.lei)).toEqual(["MID", "ORPHAN"]);
    expect(tree?.children[0].children.map((c) => c.lei)).toEqual(["BANK"]);
  });

  it("returns null when the root is not among the members", () => {
    expect(buildFamilyTree("X", [member("A", null, "A")])).toBeNull();
  });
});
