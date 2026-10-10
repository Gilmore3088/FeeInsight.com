import { describe, expect, it } from "vitest";
import { formatCompactDollars } from "@/lib/format";
import { getFrequencyLabel, getHeadlineCoverageLabel, getPublicStatusLabel, getSegmentLabel, toTitleCase } from "./enum-labels";
import { groupFeesByFamily, type DisplayFee } from "./fee-schedule-table";
import {
  assetSizeToDollars,
  formatReportQuarter,
  normalizeFinancial,
  selectFinancialsByQuarter,
} from "./financial-units";
import { buildLocationParts, buildProfileTitle, pickHeadlineFees } from "./profile-data";
import type { ExtractedFee } from "@/lib/data-store/types";

const ncuaRecord = {
  institution_id: 4802,
  report_date: "2026-03-31",
  source: "ncua",
  total_assets: 158_694,
  total_deposits: 139_711,
  total_loans: null,
  service_charge_income: 206,
  other_noninterest_income: null,
  net_interest_margin: null,
  efficiency_ratio: null,
  roa: 0,
  roe: null,
  tier1_capital_ratio: null,
  branch_count: null,
  employee_count: null,
  member_count: null,
  total_revenue: null,
  fee_income_ratio: 0.0823,
  overdraft_revenue: null,
};

describe("financial units", () => {
  it("renders registry assets and NCUA call-report assets with the same magnitude", () => {
    const registry = formatCompactDollars(assetSizeToDollars(158_694));
    const financial = formatCompactDollars(normalizeFinancial(ncuaRecord).totalAssets);
    expect(registry).toBe("$158.7M");
    expect(financial).toBe("$158.7M");
  });

  it("hides zero ROA and converts the fee income fraction to percent", () => {
    expect(normalizeFinancial({ ...ncuaRecord, roa: 0.9 }).roaPct).toBe(0.9);
    expect(normalizeFinancial(ncuaRecord).roaPct).toBeNull();
    expect(normalizeFinancial(ncuaRecord).feeIncomeRatioPct).toBeCloseTo(8.23);
  });

  // First Bank (1391), Q1 2026 as stored: fdic 689,430 / 6 / 0.0006 vs ffiec 689,430,000 / 6,834,000 / 0.6817.
  const firstBankFdicQ1 = {
    ...ncuaRecord,
    institution_id: 1391,
    source: "fdic",
    total_assets: 689_430,
    total_deposits: 591_377,
    service_charge_income: 6,
    fee_income_ratio: 0.0006,
    roa: 1.74,
    branch_count: 9,
  };
  const firstBankFfiecQ1 = {
    ...firstBankFdicQ1,
    source: "ffiec",
    total_assets: 689_430_000,
    total_deposits: 591_377_000,
    service_charge_income: 6_834_000,
    fee_income_ratio: 0.6817,
  };
  const firstBankFdicQ4 = {
    ...firstBankFdicQ1,
    report_date: "2025-12-31",
    total_assets: 677_348,
    service_charge_income: 8,
    fee_income_ratio: 0.0002,
  };
  const firstBankFfiecQ4 = {
    ...firstBankFdicQ4,
    source: "ffiec",
    total_assets: 677_348_000,
    service_charge_income: 8_464_000,
    fee_income_ratio: 0.1892,
  };

  it("scales FDIC thousands to dollars", () => {
    const fdic = normalizeFinancial(firstBankFdicQ1);
    expect(formatCompactDollars(fdic.totalAssets)).toBe("$689.4M");
    expect(formatCompactDollars(fdic.serviceChargeIncome)).toBe("$6K");
    expect(fdic.feeIncomeRatioPct).toBeCloseTo(0.06, 2);
  });

  it("renders one row per quarter from fdic, dropping the ffiec duplicates, newest first", () => {
    const rows = selectFinancialsByQuarter([
      firstBankFfiecQ1,
      firstBankFdicQ1,
      firstBankFdicQ4,
      firstBankFfiecQ4,
    ]);
    expect(rows.map((row) => [row.reportDate, row.source])).toEqual([
      ["2026-03-31", "fdic"],
      ["2025-12-31", "fdic"],
    ]);
    expect(formatCompactDollars(rows[0].totalAssets)).toBe("$689.4M");
    expect(formatCompactDollars(rows[1].serviceChargeIncome)).toBe("$8K");
  });

  it("never renders an ffiec row, even when it is the only row for a quarter", () => {
    expect(selectFinancialsByQuarter([firstBankFfiecQ1])).toEqual([]);
    const rows = selectFinancialsByQuarter([firstBankFfiecQ4, { ...ncuaRecord, report_date: "2025-12-31" }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("ncua");
    expect(formatCompactDollars(rows[0].totalAssets)).toBe("$158.7M");
  });

  it("leaves a single-source credit union untouched", () => {
    const rows = selectFinancialsByQuarter([ncuaRecord]);
    expect(rows).toHaveLength(1);
    expect(formatCompactDollars(rows[0].totalAssets)).toBe("$158.7M");
  });

  it("formats report quarters", () => {
    expect(formatReportQuarter("2026-03-31")).toBe("Q1 2026");
    expect(formatReportQuarter("2025-12-31")).toBe("Q4 2025");
  });
});

describe("enum labels", () => {
  it("maps internal enums to public vocabulary", () => {
    expect(getPublicStatusLabel("provisional")).toBe("Under review");
    expect(getPublicStatusLabel("unavailable")).toBe("No published schedule found");
    expect(getPublicStatusLabel("verified")).toBe("Fees published");
    expect(getHeadlineCoverageLabel(6, 15)).toBe("6 of 15 headline fees published");
    expect(getSegmentLabel("community_small", "credit_union")).toBe("Community credit union, under $300M");
    expect(getSegmentLabel("super_regional", "bank")).toBe("National bank, over $250B");
    expect(getFrequencyLabel("per_occurrence")).toBe("per item");
    expect(getFrequencyLabel("monthly")).toBe("per month");
    expect(getFrequencyLabel("annual")).toBe("per year");
  });

  it("title-cases only ALL-CAPS strings", () => {
    expect(toTitleCase("SAVANNAH")).toBe("Savannah");
    expect(toTitleCase("WINSTON-SALEM")).toBe("Winston-Salem");
    expect(toTitleCase("Fort Worth")).toBe("Fort Worth");
    expect(toTitleCase(null)).toBeNull();
  });
});

describe("headline fees", () => {
  const fee = (overrides: Partial<ExtractedFee>): ExtractedFee =>
    ({
      id: 1,
      institution_id: 4802,
      fee_name: "Fee",
      fee_audience: "consumer",
      fee_category: null,
      amount: 10,
      frequency: null,
      conditions: null,
      review_status: "approved",
      source_url: null,
      ...overrides,
    }) as ExtractedFee;

  it("headlines exact categories only and skips transfer/protection overdraft rows", () => {
    const headline = pickHeadlineFees([
      fee({ id: 1, fee_name: "Overdraft Fee - Per Transfer from Another Deposit Account", fee_category: "overdraft", amount: 5 }),
      fee({ id: 2, fee_name: "Overdraft Protection", fee_category: "overdraft", amount: 3 }),
      fee({ id: 3, fee_name: "Courtesy Overdraft", fee_category: "courtesy_pay", amount: 29 }),
      fee({ id: 4, fee_name: "NSF Fee", fee_category: "nsf", amount: 33 }),
      fee({ id: 5, fee_name: "Monthly Service Fee", fee_category: "monthly_maintenance", amount: 1 }),
    ]);
    expect(headline).toEqual({ overdraft: null, nsf: 33, monthly: 1 });
  });

  it("uses the paid-item overdraft fee when it is categorized", () => {
    const headline = pickHeadlineFees([
      fee({ id: 1, fee_name: "Overdraft Transfer", fee_category: "overdraft", amount: 5 }),
      fee({ id: 2, fee_name: "Overdraft Item Paid", fee_category: "overdraft", amount: 30 }),
    ]);
    expect(headline.overdraft).toBe(30);
  });
});

describe("profile title", () => {
  it("uses the top verified amounts when present", () => {
    const year = new Date().getFullYear();
    expect(buildProfileTitle("Georgia Heritage FCU", { overdraft: 30, nsf: 33, monthly: 4.95 })).toBe(
      `Georgia Heritage FCU Fees: Overdraft $30, NSF $33, Monthly $4.95 (${year})`,
    );
    expect(buildProfileTitle("Test Bank", { overdraft: null, nsf: null, monthly: null })).toBe(
      "Test Bank Fees and Fee Schedule",
    );
  });
});

describe("fee schedule grouping", () => {
  const fee = (overrides: Partial<DisplayFee>): DisplayFee => ({
    id: Math.random().toString(36).slice(2),
    feeName: "Overdraft Fee",
    feeCategory: "overdraft",
    amount: 30,
    frequency: "per_occurrence",
    conditions: null,
    status: "verified",
    sourceUrl: null,
    ...overrides,
  });

  it("groups by family, collapses duplicate name and amount, and orders taxonomy first", () => {
    const groups = groupFeesByFamily([
      fee({ feeName: "Stop Payment", feeCategory: "stop_payment", amount: 33 }),
      fee({}),
      fee({}),
      fee({ feeName: "Overdraft Fee", amount: 35 }),
      fee({ feeName: "Mystery", feeCategory: null, status: "provisional" }),
    ]);
    const families = groups.map((group) => group.family);
    expect(families[0]).toBe("Overdraft & NSF");
    expect(families[families.length - 1]).toBe("Other fees");
    const overdraft = groups.find((group) => group.family === "Overdraft & NSF");
    expect(overdraft?.rows).toHaveLength(2);
    expect(groups.find((group) => group.family === "Other fees")?.provisionalCount).toBe(1);
  });

  it("lists a family's most looked-up fees first, not alphabetically", () => {
    const groups = groupFeesByFamily([
      fee({ feeName: "Account Research", feeCategory: "account_research", amount: 25 }),
      fee({ feeName: "Early Account Closure", feeCategory: "early_closure", amount: 20 }),
      fee({ feeName: "Monthly Service Charge", feeCategory: "monthly_maintenance", amount: 12 }),
    ]);
    expect(groups[0].rows.map((row) => row.feeName)).toEqual([
      "Monthly Service Charge",
      "Early Account Closure",
      "Account Research",
    ]);
  });
});

describe("buildLocationParts", () => {
  it("links the city and state fee pages", () => {
    expect(buildLocationParts({ city: "San Antonio", stateCode: "TX", stateName: "Texas", hasApprovedFees: true })).toEqual([
      { label: "San Antonio", href: "/fees/city/tx/san%20antonio" },
      { label: "Texas", href: "/research/state/TX" },
    ]);
  });

  it("leaves the city unlinked when its page would not list this institution or can't be reached", () => {
    expect(buildLocationParts({ city: "Austin", stateCode: "TX", stateName: "Texas", hasApprovedFees: false })[0].href).toBeNull();
    expect(buildLocationParts({ city: "Winston-Salem", stateCode: "NC", stateName: "North Carolina", hasApprovedFees: true })[0].href).toBeNull();
    expect(buildLocationParts({ city: null, stateCode: null, stateName: null, hasApprovedFees: true })).toEqual([]);
  });
});


it("headlines consumer zero rather than a business or unknown NSF price", () => {
  const row = { id: 1, institution_id: 47, fee_name: "NSF", fee_category: "nsf", amount: 30,
    frequency: null, conditions: null, review_status: "approved" } as ExtractedFee;
  expect(pickHeadlineFees([
    { ...row, fee_audience: "business" },
    { ...row, id: 2, amount: 38, fee_audience: "unknown" },
    { ...row, id: 3, amount: 0, fee_audience: "consumer", fee_treatment: "eliminated" },
  ]).nsf).toBe(0);
  expect(pickHeadlineFees([{ ...row, fee_audience: "unknown" }]).nsf).toBeNull();
});
