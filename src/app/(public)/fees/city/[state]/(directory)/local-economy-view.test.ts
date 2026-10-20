import { describe, expect, it } from "vitest";
import type { StateLocalEconomy } from "@/lib/data-store/local-economy";
import { acsPeriod, cityEconomyView, count, dollars, percent } from "./local-economy-view";

const economy: StateLocalEconomy = {
  state: { name: "Florida", population: 22_000_000, median_household_income: 71_000, poverty_rate: 0.125, acs_year: 2024, avg_annual_pay: 64_000, pay_year: "2024" },
  counties: {
    "12057": { name: "Hillsborough County", population: 1_500_000, median_household_income: 74_123.4, poverty_rate: 0.1234, acs_year: 2024, avg_annual_pay: 68_500, pay_year: "2025" },
    "12001": { name: "Alachua County", population: null, median_household_income: null, poverty_rate: null, acs_year: 2024, avg_annual_pay: null, pay_year: null },
  },
  city_counties: { TAMPA: "12057", GAINESVILLE: "12001", OCALA: "12083" },
};

describe("city economy view", () => {
  it("formats dollars, counts, rates and the ACS period", () => {
    expect(dollars(74_123.4)).toBe("$74,123");
    expect(count(1_478_759)).toBe("1,478,759");
    expect(percent(0.1234)).toBe("12.3%");
    expect(acsPeriod(2024)).toBe("2020-2024");
  });

  it("shows the county's figures beside the state's, each source and year named", () => {
    const view = cityEconomyView(economy, "TAMPA", "Florida");
    expect(view).toEqual({
      status: "ok",
      county: "Hillsborough County",
      rows: [
        { label: "Median household income", value: "$74,123", compare: "Florida: $71,000" },
        // The state's pay is from another year than the county's, so its year is named.
        { label: "Average annual pay", value: "$68,500", compare: "Florida: $64,000 (2024)" },
        { label: "Below the poverty line", value: "12.3%", compare: "Florida: 12.5%" },
        { label: "Population", value: "1,500,000", compare: "Florida: 22,000,000" },
      ],
      sources: [
        "U.S. Census Bureau, American Community Survey 5-year estimates, 2020-2024",
        "U.S. Bureau of Labor Statistics, Quarterly Census of Employment and Wages, 2025, all covered jobs",
      ],
    });
  });

  it("is honest when there is nothing to show: never a 0", () => {
    expect(cityEconomyView(null, "TAMPA", "Florida")).toEqual({ status: "unavailable" });
    expect(cityEconomyView(economy, "NOWHERE", "Florida")).toEqual({ status: "no_county" });
    expect(cityEconomyView(economy, "OCALA", "Florida")).toEqual({ status: "not_loaded" });
    expect(cityEconomyView(economy, "GAINESVILLE", "Florida")).toEqual({ status: "not_loaded" });
  });

  it("leaves out the state comparison when the state is not loaded", () => {
    const view = cityEconomyView({ ...economy, state: null }, "TAMPA", "Florida");
    expect(view.status === "ok" && view.rows.every((r) => r.compare === null)).toBe(true);
  });
});
