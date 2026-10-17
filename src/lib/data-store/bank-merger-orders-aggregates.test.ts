import { describe, expect, it } from "vitest";

import { areaParams, competitiveOf } from "./bank-merger-orders-aggregates";

describe("merger decision reads", () => {
  it("turns an area into query parameters and refuses an empty one", () => {
    expect(areaParams({ stateCode: "oh" })).toEqual({ state: "OH", counties: null, msa: null });
    expect(areaParams({ countyFips: ["39095", 39173, "x"] })).toEqual({ state: null, counties: [39095, 39173], msa: null });
    expect(areaParams({ msaCode: 45780 })).toEqual({ state: null, counties: null, msa: 45780 });
    expect(areaParams({})).toBeNull();
    expect(areaParams({ stateCode: "Ohio" })).toBeNull();
  });

  it("passes stored competitive figures through and drops malformed entries", () => {
    expect(
      competitiveOf([
        { sentence: "the HHI would increase by 152 points to 1,874", market: "Toledo", hhi_change: 152, hhi_post: 1874, deposit_shares: [18.4] },
        { market: "no sentence" },
        "junk",
      ]),
    ).toEqual([{ sentence: "the HHI would increase by 152 points to 1,874", market: "Toledo", hhi_change: 152, hhi_post: 1874, deposit_shares: [18.4] }]);
    expect(competitiveOf(null)).toEqual([]);
  });
});
