import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import { cashRentSeries, ersFileLinks, fetchErsFarmIncome, fetchNassCashRents, nassUrl, parseErsFarmIncome, parseNassCashRents, redactKey } from "./usda-farm";

const ERS_CSV = [
  "artificialKey,VariableDescriptionPart1,VariableDescriptionPart2,VariableDescriptionTotal,Year,State,Amount,ChainType_GDP_Deflator",
  "1,Net farm income,,Net farm income,2024,US,\"139,100,000\",120000000",
  "2,Net farm income,,Net farm income,2024,IA,\"9,876,543\",8000000",
  "3,Net farm income,,Net farm income,2024,Alaska,-1234,-1000",
  "4,Net farm income,,Net farm income,2023,IA,\"10,000,000\",9000000",
  "5,Cash receipts value,all commodities,\"Cash receipts value, all commodities\",2024,IA,\"40,000,000\",",
  "6,Debt,total,\"Debt, total\",2024,IA,(NA),",
  "7,Net farm income per operation,,Net farm income per operation,2024,IA,50000,",
  "8,Net farm income,,Net farm income,2024,Atlantis,5,",
].join("\n");

describe("ERS farm income", () => {
  it("keeps the matched variables for one year, blank as null + note, negatives as filed", () => {
    const r = parseErsFarmIncome(ERS_CSV, 2024, "u");
    const ia = r.rows.find((x) => x.geo_code === "IA" && x.series_key === "usda_farm_net_income")!;
    expect(ia).toMatchObject({ geo_type: "state", period: "2024", value: 9876543, unit: "thousands_dollars" });
    expect(r.rows.find((x) => x.geo_code === "AK")!.value).toBe(-1234);
    expect(r.rows.find((x) => x.geo_type === "nation")!.value).toBe(139100000);
    expect(r.rows.find((x) => x.series_key === "usda_farm_debt")).toMatchObject({ value: null, note: "(NA)" });
    expect(r.rows.find((x) => x.series_key === "usda_farm_cash_receipts")!.value).toBe(40000000);
    expect(r.rows.some((x) => x.period === "2023")).toBe(false);
    expect(r.missingFields).toEqual(["ers:Net cash farm income"]);
    expect(r.info.near_misses).toContain("Net farm income per operation");
    expect(r.skipped).toEqual({ state_not_placed: 1 });
  });

  it("names missing columns", () => {
    const r = parseErsFarmIncome("Year,Amount\n2024,5", 2024, null);
    expect(r.rows).toEqual([]);
    expect(r.missingFields.join(" ")).toMatch(/state/);
  });

  it("finds the file link on the data-files page and reads a zipped CSV", async () => {
    const page = '<a href="/media/1234/farmincome_wealthstatisticsdata_september2026.zip">Farm income and wealth statistics (zip)</a><a href="/x.pdf">doc</a>';
    expect(ersFileLinks(page, "https://www.ers.usda.gov/data-products/x")).toEqual(["https://www.ers.usda.gov/media/1234/farmincome_wealthstatisticsdata_september2026.zip"]);
    const zip = zipSync({ "FarmIncome_WealthStatisticsData_September2026.csv": strToU8(ERS_CSV) });
    const fetchImpl = vi.fn(async (url: string) => (url.endsWith(".zip") ? new Response(zip) : new Response(page))) as unknown as typeof fetch;
    const r = await fetchErsFarmIncome(2024, { fetchImpl, retries: 0 });
    expect(r.rows.length).toBe(5);
  });
});

const NASS_BODY = {
  data: [
    { Value: "245", short_desc: "RENT, CASH, CROPLAND, NON-IRRIGATED - EXPENSE, MEASURED IN $ / ACRE", agg_level_desc: "COUNTY", state_alpha: "IA", state_fips_code: "19", county_code: "001", county_name: "ADAIR", year: 2025, unit_desc: "$ / ACRE", reference_period_desc: "YEAR", "CV (%)": "3.1" },
    { Value: "(D)", short_desc: "RENT, CASH, CROPLAND, IRRIGATED - EXPENSE, MEASURED IN $ / ACRE", agg_level_desc: "COUNTY", state_alpha: "IA", state_fips_code: "19", county_code: "001", county_name: "ADAIR", year: 2025, unit_desc: "$ / ACRE", reference_period_desc: "YEAR" },
    { Value: "200", short_desc: "RENT, CASH, CROPLAND, NON-IRRIGATED - EXPENSE, MEASURED IN $ / ACRE", agg_level_desc: "COUNTY", state_alpha: "IA", state_fips_code: "19", county_code: "998", county_name: "OTHER (COMBINED) COUNTIES", year: 2025, unit_desc: "$ / ACRE", reference_period_desc: "YEAR" },
    { Value: "1,050", short_desc: "RENT, PER HEAD, PASTURELAND - EXPENSE, MEASURED IN $ / HEAD / MONTH", agg_level_desc: "STATE", state_alpha: "IA", state_fips_code: "19", county_code: "", year: 2025, unit_desc: "$", reference_period_desc: "YEAR" },
    { Value: "255", short_desc: "RENT, CASH, CROPLAND, NON-IRRIGATED - EXPENSE, MEASURED IN $ / ACRE", agg_level_desc: "STATE", state_alpha: "IA", state_fips_code: "19", county_code: "", year: 2025, unit_desc: "$ / ACRE", reference_period_desc: "YEAR" },
  ],
};

describe("NASS cash rents", () => {
  it("parses county and state cash rents and keeps withheld values as null + (D)", () => {
    const r = parseNassCashRents(NASS_BODY, 2025, "u");
    expect(r.missingFields).toEqual([]);
    expect(r.rows.find((x) => x.geo_type === "county" && x.series_key === "usda_farm_cash_rent_cropland_non_irrigated")).toMatchObject({ geo_code: "19001", state_code: "IA", value: 245, unit: "dollars_per_acre" });
    expect(r.rows.find((x) => x.series_key === "usda_farm_cash_rent_cropland_irrigated")).toMatchObject({ value: null, note: "(D)" });
    expect(r.rows.find((x) => x.geo_type === "state")!.value).toBe(255);
    expect(r.skipped).toEqual({ combined_or_unknown_county: 1 });
    expect(cashRentSeries("RENT, CASH, PASTURELAND - EXPENSE, MEASURED IN $ / ACRE")).toBe("usda_farm_cash_rent_pastureland");
  });

  it("is empty with the brief's reason when no key is set, and never calls out", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const r = await fetchNassCashRents(2025, undefined, { fetchImpl });
    expect(r).toMatchObject({ skippedNoKey: true, emptyReason: "no NASS_API_KEY set", rows: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats Quick Stats' 400 for no matching records as empty and never stores the key", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes("COUNTY") ? new Response(JSON.stringify(NASS_BODY)) : new Response('{"error":["bad request - invalid query"]}', { status: 400 }),
    ) as unknown as typeof fetch;
    const r = await fetchNassCashRents(2025, "secret", { fetchImpl, retries: 0 });
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.url).not.toContain("secret");
    expect(redactKey(nassUrl("abc", 2025, "STATE"))).toContain("key=REDACTED");
  });
});
