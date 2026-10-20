import { describe, expect, it } from "vitest";
import { chosenInstitutionIds, peerFilterParts } from "./peer-filter-words";
import { describePeerFilters } from "./hamilton/peer-index";

describe("chosen peer institutions are counted one way (#2007)", () => {
  it("drops repeated and invalid ids and sorts the rest", () => {
    expect(chosenInstitutionIds([12, 11, 12, 0, -3, 1.5, Number.NaN])).toEqual([11, 12]);
    expect(chosenInstitutionIds(undefined)).toEqual([]);
  });

  it("gives the stamp's peer label and describePeerFilters the same count", () => {
    const filters = { institutionIds: [12, 11, 12] };
    expect(peerFilterParts(filters)).toEqual([{ key: "peers:institutions:11,12", label: "2 chosen institutions" }]);
    expect(describePeerFilters(filters)).toBe("2 chosen institutions");
  });

  it("falls back to the other filters when no chosen id is valid, in both", () => {
    const filters = { institutionIds: [0], state_code: "TX" };
    expect(peerFilterParts(filters).map((p) => p.label)).toEqual(["TX"]);
    expect(describePeerFilters(filters)).toBe("TX peers");
  });
});
