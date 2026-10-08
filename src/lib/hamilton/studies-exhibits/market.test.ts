import { describe, expect, it } from "vitest";
import { assembleMarketStudy, type MarketStudyRows } from "@/lib/data-store/market-study";
import { buildMarketStudy, feePosition, marketFigures } from "./market";

// Adams County, PA (42001) with deposits in thousands, as the SOD table stores them.
const rows: MarketStudyRows = {
  countyFips: "42001",
  subject: { id: 270, name: "Orrstown Bank", state_code: "PA" },
  totals: [
    { year: 2021, deposits: 1_874_007 },
    { year: 2022, deposits: 1_879_785 },
    { year: 2026, deposits: 1_766_369 },
  ],
  branches: [
    { institution_id: 393, cert: 1, name: "ACNB Bank", branch_name: "Main", city: "Gettysburg", latitude: 39.83, longitude: -77.23, deposits: 1_070_298 },
    { institution_id: 8, cert: 2, name: "PNC Bank, National Association", branch_name: "West Street", city: "Gettysburg", latitude: 39.827, longitude: -77.236, deposits: 522_431 },
    { institution_id: 21, cert: 3, name: "Manufacturers and Traders Trust Company", branch_name: "High Street", city: "Gettysburg", latitude: 39.828, longitude: -77.235, deposits: 102_601 },
    { institution_id: 9, cert: 4, name: "Truist Bank", branch_name: "East Berlin", city: "East Berlin", latitude: 39.938, longitude: -76.978, deposits: 71_039 },
  ],
  earlier: [
    { key: 393, deposits: 1_146_437 },
    { key: 8, deposits: 501_493 },
    { key: 21, deposits: 99_599 },
    { key: 9, deposits: 126_478 },
  ],
  subjectBranches: [
    { cert: 9, branch_name: "North Hanover", city: "Hanover", county_fips: 42133, latitude: 39.8236, longitude: -76.9958, deposits: 124_748 },
    { cert: 9, branch_name: "Mercersburg", city: "Mercersburg", county_fips: 42055, latitude: 39.8279, longitude: -77.904, deposits: 120_401 },
  ],
  fees: [
    { institution_id: 270, fee_category: "overdraft", amount: 38 },
    { institution_id: 8, fee_category: "overdraft", amount: 18 },
    { institution_id: 9, fee_category: "overdraft", amount: 36 },
    { institution_id: 21, fee_category: "overdraft", amount: 15 },
    { institution_id: 270, fee_category: "cashiers_check", amount: 10 },
    { institution_id: 8, fee_category: "cashiers_check", amount: 10 },
    { institution_id: 9, fee_category: "cashiers_check", amount: 10 },
    { institution_id: 270, fee_category: "nsf", amount: 38 },
    { institution_id: 8, fee_category: "nsf", amount: 30 },
  ],
  demographics: [
    { geo_id: "state:42", geo_name: "Pennsylvania", median_household_income: 73170, total_population: 12989208, poverty_count: 1482439, year: 2022 },
    { geo_id: "county:42001", geo_name: "Adams County, Pennsylvania", median_household_income: 78975, total_population: 104604, poverty_count: 7909, year: 2022 },
    { geo_id: "county:42133", geo_name: "York County, Pennsylvania", median_household_income: 79183, total_population: 457051, poverty_count: 38540, year: 2022 },
  ],
};

const data = assembleMarketStudy(rows)!;

describe("assembleMarketStudy", () => {
  it("converts deposits to dollars and groups branches into members by deposits", () => {
    expect(data.sod_year).toBe(2026);
    expect(data.earlier_year).toBe(2021);
    expect(data.members.map((m) => m.name)).toEqual([
      "ACNB Bank",
      "PNC Bank, National Association",
      "Manufacturers and Traders Trust Company",
      "Truist Bank",
    ]);
    expect(data.members[0].deposits).toBe(1_070_298_000);
    expect(data.members[0].deposits_earlier).toBe(1_146_437_000);
    expect(data.subject_branches[0].county_fips).toBe("42133");
  });

  it("splits the subject's fees from the competitors' and orders households target, subject, state", () => {
    const od = data.fees.find((f) => f.category === "overdraft")!;
    expect(od.subject).toBe(38);
    expect(od.competitors.map((c) => c.amount).sort()).toEqual([15, 18, 36]);
    expect(data.households.map((h) => [h.role, h.name])).toEqual([
      ["target", "Adams"],
      ["subject", "York"],
      ["state", "Pennsylvania"],
    ]);
  });
});

describe("buildMarketStudy", () => {
  const study = buildMarketStudy(data);

  it("computes the headline figures from the data", () => {
    const fig = marketFigures(data);
    expect(fig.hhi).toBe(4596);
    expect(fig.concentration).toBe("highly concentrated");
    expect(fig.peak.year).toBe(2022);
    expect(fig.nearest?.city).toBe("Hanover");
    expect(fig.nearest!.miles).toBeGreaterThan(5);
    expect(study.title).toBe("Adams County, PA");
    expect(study.heroes.map((h) => h.figure)).toEqual(["$1.77B", "4,596", "$78,975", `${fig.nearest!.miles.toFixed(1)} mi`]);
    expect(study.heroes[0].note).toBe("−6% from the 2022 peak");
  });

  it("writes titles that state what the data shows", () => {
    expect(study.html).toMatch(/Adams County borders Orrstown Bank's branches in (York and Franklin|Franklin and York)/);
    expect(study.html).toContain("ACNB Bank holds 61% of the county's deposits, about the same share as in 2021");
    expect(study.html).toContain("Orrstown Bank's overdraft fee would be the highest in the county");
    expect(study.html).toContain("Adams County households earn 8% more than the Pennsylvania median");
    // ACNB has no fees on file: the source line says so instead of hiding it.
    expect(study.html).toContain("No fee schedule is on file yet for ACNB Bank");
  });

  it("only compares fees at least two competitors publish", () => {
    const nsf = data.fees.find((f) => f.category === "nsf")!;
    expect(nsf.competitors).toHaveLength(1);
    expect(study.html).not.toContain("NSF");
    expect(feePosition(data.fees.find((f) => f.category === "cashiers_check")!)).toBe("same");
  });

  it("draws each chart for desktop and phone, with no em-dashes or 'cheaper'", () => {
    expect(study.html.match(/class="sc-narrow"/g)?.length).toBeGreaterThanOrEqual(4);
    expect(study.html).not.toContain("—");
    expect(study.html).not.toMatch(/cheaper|pricier/i);
  });

  it("says when the subject has no fees on file", () => {
    const none = buildMarketStudy(assembleMarketStudy({ ...rows, fees: rows.fees.filter((f) => f.institution_id !== 270) })!);
    expect(none.html).toContain("Orrstown Bank has no published fees on file yet to compare");
  });
});
