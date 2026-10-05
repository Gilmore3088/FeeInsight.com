import { describe, expect, it } from "vitest";
import {
  buildInstitutionPeerFilterCandidates,
  describePeerFilters,
  hasUsablePeerIndex,
  parseSavedPeerSetFilters,
} from "./peer-index";

describe("Hamilton peer index helpers", () => {
  it("parses saved peer-set filters from stored comma strings", () => {
    expect(
      parseSavedPeerSetFilters({
        tiers: "1b_10b, 10b_50b",
        districts: "6, bad, 13, 7",
        charter_type: "credit_union",
      }),
    ).toEqual({
      charter_type: "credit_union",
      asset_tiers: ["1b_10b", "10b_50b"],
      fed_districts: [6, 7],
    });
  });

  it("builds progressively broader default peer filters for a selected institution", () => {
    const candidates = buildInstitutionPeerFilterCandidates({
      institution_name: "Example CU",
      state_code: "FL",
      charter_type: "credit_union",
      asset_size_tier: "1b_10b",
      fed_district: 6,
    });

    expect(candidates[0]).toEqual({
      state_code: "FL",
      charter_type: "credit_union",
      asset_tiers: ["1b_10b"],
      fed_districts: [6],
    });
    expect(candidates).toContainEqual({
      charter_type: "credit_union",
      asset_tiers: ["1b_10b"],
    });
    expect(candidates).toContainEqual({ charter_type: "credit_union" });
    expect(candidates).toContainEqual({ state_code: "FL" });
  });

  it("describes peer filters for user-facing report and simulation context", () => {
    expect(
      describePeerFilters({
        state_code: "FL",
        charter_type: "credit_union",
        asset_tiers: ["1b_10b"],
        fed_districts: [6],
      }),
    ).toBe("FL · credit union · 1b 10b · Fed district 6 peers");
    expect(describePeerFilters({ state_code: "TX", charter_type: "bank", asset_tiers: ["community_mid"] })).toBe(
      "TX · bank · $300M to $1B peers",
    );
    expect(describePeerFilters(null)).toBe("Verified national index");
  });

  it("requires enough categories with medians and peer institutions", () => {
    expect(
      hasUsablePeerIndex(
        [
          { median_amount: 10, institution_count: 5 },
          { median_amount: 20, institution_count: 8 },
          { median_amount: null, institution_count: 20 },
          { median_amount: 30, institution_count: 4 },
        ],
        2,
      ),
    ).toBe(true);

    expect(
      hasUsablePeerIndex(
        [
          { median_amount: 10, institution_count: 4 },
          { median_amount: null, institution_count: 10 },
        ],
        1,
      ),
    ).toBe(false);
  });
});
