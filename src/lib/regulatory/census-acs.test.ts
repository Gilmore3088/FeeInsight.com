import { describe, expect, it, vi } from "vitest";

import { acsUrl, fetchAcs, parseAcsTable } from "./census-acs";

const HEADER = ["NAME", "B19013_001E", "B17001_002E", "B01003_001E"];

describe("ACS parser", () => {
  it("builds geo ids per level and stores suppressed estimates as unknown", () => {
    const counties = parseAcsTable(
      [
        [...HEADER, "state", "county"],
        ["Autauga County, Alabama", "69841", "6295", "59285", "01", "001"],
        ["Tiny County, Somewhere", "-666666666", "12", "40", "02", "999"],
      ],
      "county",
      2024,
    );
    expect(counties[0]).toEqual({
      geo_id: "county:01001",
      geo_type: "county",
      geo_name: "Autauga County, Alabama",
      state_fips: "01",
      county_fips: "001",
      median_household_income: 69841,
      poverty_count: 6295,
      total_population: 59285,
      year: 2024,
    });
    expect(counties[1].median_household_income).toBeNull();

    const zcta = parseAcsTable([[...HEADER, "zip code tabulation area"], ["ZCTA5 02139", "102000", "5000", "39000", "02139"]], "zcta", 2024);
    expect(zcta[0]).toMatchObject({ geo_id: "zcta:02139", state_fips: null });

    const tract = parseAcsTable([[...HEADER, "state", "county", "tract"], ["Tract 201", "50000", "100", "4000", "01", "001", "020100"]], "tract", 2024);
    expect(tract[0].geo_id).toBe("tract:01001020100");
  });

  it("asks for tracts one state at a time", () => {
    const url = new URL(acsUrl(2024, "tract", "06", ""));
    expect(url.searchParams.get("for")).toBe("tract:*");
    expect(url.searchParams.get("in")).toBe("state:06 county:*");
    expect(url.searchParams.get("key")).toBeNull();
  });

  it("returns null for a vintage Census has not published", async () => {
    const fetchImpl = vi.fn(async () => new Response("error: unknown dataset", { status: 404 }));
    expect(await fetchAcs(2099, "state", { fetchImpl: fetchImpl as unknown as typeof fetch, retries: 0 })).toBeNull();
  });
});
