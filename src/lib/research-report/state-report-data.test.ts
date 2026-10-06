import { describe, expect, it } from "vitest";
import {
  FIXTURE_NATIONAL_INDEX,
  FIXTURE_STATE_INDEXES,
  FIXTURE_STATE_REPORT,
} from "@/lib/report-templates/templates/__fixtures__/state-report.fixture";
import { buildStateReportData } from "./state-report-data";
import { POSITION_AXIS_MAX_PCT, positionAxis } from "./state-findings";

describe("buildStateReportData", () => {
  it("joins state medians to national and keeps the everyday fees in benchmark order", () => {
    const d = FIXTURE_STATE_REPORT;
    expect(d.everyday.map((c) => c.fee_category).slice(0, 3)).toEqual(["overdraft", "nsf", "monthly_maintenance"]);
    const overdraft = d.comparisons.find((c) => c.fee_category === "overdraft")!;
    expect(overdraft.median_amount).toBe(32);
    expect(overdraft.national_median).toBe(30);
    expect(overdraft.delta_pct).toBeCloseTo((2 / 30) * 100);
  });

  it("carries the coverage counts from the readers unchanged", () => {
    expect(FIXTURE_STATE_REPORT.monitored).toEqual({ institutions: 400, banks: 250, credit_unions: 150 });
    expect(FIXTURE_STATE_REPORT.verified).toEqual({ institutions: 150, banks: 90, credit_unions: 60, fees: 1800 });
  });

  it("pairs charters only where both have a median, and computes findings", () => {
    expect(FIXTURE_STATE_REPORT.charterPairs.length).toBeGreaterThan(0);
    expect(FIXTURE_STATE_REPORT.findings.map((f) => f.key)).toContain("overdraft");
  });

  it("shows featured fees by default and every category for Pro", () => {
    const base = {
      stateCode: "ZZ",
      stateName: "Fixture State",
      district: null,
      asOf: null,
      stats: { institution_count: 1, bank_count: 1, cu_count: 0 },
      indexes: FIXTURE_STATE_INDEXES,
      national: FIXTURE_NATIONAL_INDEX,
    };
    const featured = buildStateReportData(base);
    const all = buildStateReportData({ ...base, includeAllCategories: true });
    expect(all.comparisons.length).toBe(FIXTURE_STATE_INDEXES.all.length);
    expect(featured.comparisons.length + featured.hiddenCategoryCount).toBe(all.comparisons.length);
    expect(all.hiddenCategoryCount).toBe(0);
  });
});

describe("positionAxis", () => {
  it("fits the widest gap in steps of 10%, between 10% and the maximum", () => {
    expect(positionAxis([])).toBe(10);
    expect(positionAxis([3, -7])).toBe(10);
    expect(positionAxis([12, -25])).toBe(30);
    expect(positionAxis([400])).toBe(POSITION_AXIS_MAX_PCT);
  });
});
