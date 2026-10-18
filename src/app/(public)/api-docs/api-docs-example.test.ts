import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FeeCategorySummary } from "@/lib/data-store/fees";
import { DEMO, overdraftExample } from "./api-docs-example";

const page = readFileSync(join(process.cwd(), "src/app/(public)/api-docs/page.tsx"), "utf8");

describe("API docs worked example (#1953)", () => {
  it("names only the demo cast, never another real bank", () => {
    expect(DEMO.name).toBe("Capital City Bank");
    expect(page).not.toMatch(/Gateway Bank|Mendota Heights|2466|Frost/);
  });

  it("fills the overdraft example from the live national row", () => {
    const row = {
      fee_category: "overdraft", institution_count: 1500, total_observations: 2100, min_amount: 0, max_amount: 39,
      avg_amount: 29, median_amount: 30, p25_amount: 25, p75_amount: 34, bank_count: 900, cu_count: 600, zero_count: 10,
      bank_median_amount: 32, cu_median_amount: 28,
    } as FeeCategorySummary;
    expect(overdraftExample(row)).toMatchObject({ median: "30.00", p25: "25.00", institutions: "1500", bankMedian: "32.00", cuCount: "600" });
    expect(page).not.toMatch(/"median": 35\.00|"institution_count": 842/);
  });

  it("writes null, never a made-up figure, when the live read failed", () => {
    expect(overdraftExample(undefined)).toMatchObject({ median: "null", institutions: "null" });
  });
});
