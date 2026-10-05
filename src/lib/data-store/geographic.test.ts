import { describe, expect, it } from "vitest";
import {
  normalizeCityInstitutionRow,
  normalizeCitySummaryRow,
  rollUpCoverage,
} from "./geographic";

describe("city geographic read-model normalization", () => {
  it("converts Postgres numeric strings before public route formatting", () => {
    expect(
      normalizeCityInstitutionRow({
        id: 42,
        institution_name: "Example Bank",
        charter_type: "bank",
        asset_size: "125000",
        fee_count: "4",
        overdraft: "35.00",
        monthly_maintenance: "5.50",
        nsf: null,
        atm_non_network: "3",
      }),
    ).toEqual({
      id: 42,
      institution_name: "Example Bank",
      charter_type: "bank",
      asset_size: 125000,
      fee_count: 4,
      overdraft: 35,
      monthly_maintenance: 5.5,
      nsf: null,
      atm_non_network: 3,
    });
  });

  it("converts city summary counts so totals add numerically", () => {
    expect(
      normalizeCitySummaryRow({
        city: "Dothan",
        state_code: "AL",
        institution_count: "12",
        with_fees: "3",
      }),
    ).toEqual({
      city: "Dothan",
      state_code: "AL",
      institution_count: 12,
      with_fees: 3,
    });
  });
});

describe("rollUpCoverage", () => {
  it("sums (state, district) groups into states and districts", () => {
    const coverage = rollUpCoverage([
      { state_code: "MO", fed_district: 8, monitored: "100", verified_institutions: "20", verified_fees: "150" },
      { state_code: "MO", fed_district: "10", monitored: "50", verified_institutions: "5", verified_fees: "40" },
      { state_code: "KS", fed_district: 10, monitored: "80", verified_institutions: "30", verified_fees: "200" },
      { state_code: null, fed_district: 8, monitored: "3", verified_institutions: "0", verified_fees: "0" },
      { state_code: "ZZ", fed_district: null, monitored: "9", verified_institutions: "9", verified_fees: "9" },
    ]);
    expect(coverage.states).toEqual([
      { state_code: "KS", monitored: 80, verified_institutions: 30, verified_fees: 200 },
      { state_code: "MO", monitored: 150, verified_institutions: 25, verified_fees: 190 },
    ]);
    expect(coverage.districts).toEqual([
      { district: 8, monitored: 103, verified_institutions: 20, verified_fees: 150 },
      { district: 10, monitored: 130, verified_institutions: 35, verified_fees: 240 },
    ]);
  });
});
