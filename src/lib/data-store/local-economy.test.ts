import { describe, expect, it } from "vitest";
import { buildLocalEconomy, countyName, fips5, foldCityCounties } from "./local-economy";

describe("local economy", () => {
  it("gives each city the county with most of its bank branches, spellings folded", () => {
    const map = foldCityCounties([
      { city: "ST. PETERSBURG", county_fips: 12103, branches: 40 },
      { city: "SAINT PETERSBURG", county_fips: 12103, branches: 3 },
      { city: "ST PETERSBURG", county_fips: 12057, branches: 30 },
      { city: "TAMPA", county_fips: "12057", branches: 90 },
      { city: "NOWHERE", county_fips: null, branches: 2 },
    ]);
    expect(map).toEqual({ "ST PETERSBURG": "12103", TAMPA: "12057" });
  });

  it("pads FIPS and drops blanks", () => {
    expect(fips5(1001)).toBe("01001");
    expect(fips5(null)).toBeNull();
    expect(fips5(0)).toBeNull();
    expect(countyName("Hillsborough County, Florida")).toBe("Hillsborough County");
  });

  it("keeps the newest ACS vintage and QCEW year, and never turns a missing estimate into 0", () => {
    const economy = buildLocalEconomy(
      "FL",
      "Florida",
      { TAMPA: "12057", MIAMI: "12086" },
      [
        { geo_id: "county:12057", geo_name: "Hillsborough County, Florida", year: 2023, total_population: 1_400_000, median_household_income: 70_000, poverty_count: 180_000 },
        { geo_id: "county:12057", geo_name: "Hillsborough County, Florida", year: 2024, total_population: 1_500_000, median_household_income: 74_000, poverty_count: 180_000 },
        { geo_id: "state:12", geo_name: "Florida", year: 2024, total_population: 22_000_000, median_household_income: 71_000, poverty_count: 2_750_000 },
      ],
      [
        { geo_type: "county", geo_code: "12057", period: "2024", value: 66_000 },
        { geo_type: "county", geo_code: "12057", period: "2025", value: 68_500 },
        { geo_type: "state", geo_code: "FL", period: "2025", value: 64_000 },
        // Miami-Dade has QCEW pay but no ACS row: no county name, so it is left out.
        { geo_type: "county", geo_code: "12086", period: "2025", value: 70_000 },
      ],
    );
    expect(economy.counties["12057"]).toEqual({
      name: "Hillsborough County",
      population: 1_500_000,
      median_household_income: 74_000,
      poverty_rate: 0.12,
      acs_year: 2024,
      avg_annual_pay: 68_500,
      pay_year: "2025",
    });
    expect(economy.counties["12086"]).toBeUndefined();
    expect(economy.state?.name).toBe("Florida");
    expect(economy.state?.avg_annual_pay).toBe(64_000);
  });

  it("stores an ACS row Census left blank as unknown, not 0", () => {
    const economy = buildLocalEconomy(
      "FL",
      "Florida",
      { TAMPA: "12057" },
      [{ geo_id: "county:12057", geo_name: "Hillsborough County, Florida", year: 2024, total_population: null, median_household_income: null, poverty_count: 10 }],
      [],
    );
    expect(economy.counties["12057"]).toMatchObject({ population: null, median_household_income: null, poverty_rate: null, avg_annual_pay: null });
    expect(economy.state).toBeNull();
  });
});
