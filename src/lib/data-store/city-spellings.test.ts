import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Every reader that matches or lists cities folds their spellings (#2092): the city page's
 * headquarters list, its fee averages, the city lists, the sitemap, the city search, the branch
 * check and the report markets all read "Saint Petersburg" and "St. Petersburg" as one city.
 */
const state = vi.hoisted(() => ({ calls: [] as { text: string; values: unknown[] }[], replies: [] as unknown[][] }));

vi.mock("./connection", () => {
  const sql = Object.assign(
    vi.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => {
      state.calls.push({ text: parts.join("?"), values });
      return state.replies.shift() ?? [];
    }),
    { unsafe: vi.fn((text: string) => text) },
  );
  return { sql, getSql: () => sql };
});

import { foldCitySummaries, getCitiesInState, getCityAutocomplete, getCityFeeAverages, getCityInstitutions, getTopCitiesByState } from "./geographic";
import { cityHasBranches } from "./city-market";
import { hqCityName, hqPlacesInBranchCounties } from "./city-spellings";

beforeEach(() => {
  state.calls.length = 0;
  state.replies.length = 0;
});

const ST_PETE_HQ = [{ city: "SAINT PETERSBURG" }, { city: "ST. PETERSBURG" }, { city: "TAMPA" }];

describe("city page headquarters reads", () => {
  it("lists institutions under every headquarters spelling of the city", async () => {
    state.replies.push(ST_PETE_HQ);
    await getCityInstitutions("St. Petersburg", "fl");
    const list = state.calls[1];
    expect(list.text).toContain("UPPER(ct.city) = ANY(?::text[])");
    expect(list.values).toContainEqual(["ST. PETERSBURG", "SAINT PETERSBURG"]);
  });

  it("averages fees over the same folded set", async () => {
    state.replies.push(ST_PETE_HQ);
    await getCityFeeAverages("Saint Petersburg", "FL");
    expect(state.calls[1].values).toContainEqual(["SAINT PETERSBURG", "ST. PETERSBURG"]);
  });
});

describe("city lists", () => {
  it("folds spellings into one city, summing counts and naming it by the spelling most use", () => {
    const folded = foldCitySummaries([
      { city: "St. Petersburg", state_code: "FL", institution_count: 5, with_fees: 3 },
      { city: "Saint Petersburg", state_code: "FL", institution_count: 2, with_fees: 2 },
      { city: "Tampa", state_code: "FL", institution_count: 4, with_fees: 4 },
      { city: "Saint Petersburg", state_code: "VA", institution_count: 1, with_fees: 1 },
    ]);
    expect(folded).toEqual([
      { city: "St. Petersburg", state_code: "FL", institution_count: 7, with_fees: 5 },
      { city: "Tampa", state_code: "FL", institution_count: 4, with_fees: 4 },
      { city: "Saint Petersburg", state_code: "VA", institution_count: 1, with_fees: 1 },
    ]);
  });

  it("drops a state's city with no fees only after folding", async () => {
    state.replies.push([
      { city: "St Petersburg", state_code: "FL", institution_count: 1, with_fees: 0 },
      { city: "Saint Petersburg", state_code: "FL", institution_count: 1, with_fees: 1 },
      { city: "Ocala", state_code: "FL", institution_count: 1, with_fees: 0 },
    ]);
    const cities = await getCitiesInState("FL");
    expect(cities).toEqual([{ city: "Saint Petersburg", state_code: "FL", institution_count: 2, with_fees: 1 }]);
  });

  it("ranks the sitemap's top cities after folding, so a split city passes the threshold once", async () => {
    state.replies.push([
      { city: "St. Petersburg", state_code: "FL", institution_count: 2, with_fees: 2 },
      { city: "Saint Petersburg", state_code: "FL", institution_count: 2, with_fees: 2 },
      { city: "Tampa", state_code: "FL", institution_count: 3, with_fees: 3 },
      { city: "Miami", state_code: "FL", institution_count: 1, with_fees: 1 },
      { city: "Austin", state_code: "TX", institution_count: 3, with_fees: 3 },
    ]);
    const top = await getTopCitiesByState(3, 1);
    expect(top.map((c) => `${c.state_code}:${c.city}:${c.with_fees}`)).toEqual(["FL:Saint Petersburg:4", "TX:Austin:3"]);
  });

  it("searches every folded form of the first word and lists a city once", async () => {
    state.replies.push([
      { city: "St. Petersburg", state_code: "FL", count: "3" },
      { city: "Saint Petersburg", state_code: "FL", count: "1" },
    ]);
    const found = await getCityAutocomplete("st pete", 8);
    expect(state.calls[0].values[0]).toEqual(["st pete%", "SAINT pete%", "ST pete%", "ST. pete%"]);
    expect(found).toEqual([{ city: "St. Petersburg", state_code: "FL", count: 4 }]);
  });
});

describe("branch and market reads", () => {
  it("finds a city's branches under another spelling", async () => {
    state.replies.push([{ city: "ST. PETERSBURG" }]);
    expect(await cityHasBranches("Saint Petersburg", "FL")).toBe(true);
    state.replies.push([{ city: "TAMPA" }]);
    expect(await cityHasBranches("Saint Petersburg", "FL")).toBe(false);
  });

  it("counts an institution headquartered in a market city spelled another way", async () => {
    state.replies.push([
      { kind: "branch", state: "FL", city: "ST. PETERSBURG" },
      { kind: "hq", state: "FL", city: "SAINT PETERSBURG" },
      { kind: "hq", state: "FL", city: "ORLANDO" },
    ]);
    expect(await hqPlacesInBranchCounties(2026, ["12103"])).toEqual(["FL|SAINT PETERSBURG"]);
  });
});

describe("hqCityName", () => {
  it("names a city by the headquarters spelling most institutions use", async () => {
    state.replies.push([
      { city: "Saint Louis", institutions: "1" },
      { city: "St. Louis", institutions: "6" },
      { city: "Kansas City", institutions: "9" },
    ]);
    expect(await hqCityName("st louis", "mo")).toBe("St. Louis");
    state.replies.push([{ city: "Kansas City", institutions: "9" }]);
    expect(await hqCityName("st louis", "mo")).toBeNull();
  });
});
