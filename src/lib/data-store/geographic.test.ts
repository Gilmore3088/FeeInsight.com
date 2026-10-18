import { describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => {
  const sql = vi.fn(async () => []) as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
  sql.unsafe = vi.fn((text: string) => ({ unsafeText: text }));
  return { sql, getSql: () => sql };
});

import {
  getResearchCoverage,
  normalizeCityInstitutionRow,
  normalizeCitySummaryRow,
  rollUpCoverage,
} from "./geographic";
import { activeInstitutionFilter, getStateHub } from "./district-hub";
import { sql } from "./connection";

type Mock = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
const db = sql as unknown as Mock;

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
      { state_code: "MO", fed_district: 8, monitored: "100", verified_institutions: "20", counted_institutions: "18", verified_fees: "150" },
      { state_code: "MO", fed_district: "10", monitored: "50", verified_institutions: "5", counted_institutions: "5", verified_fees: "40" },
      { state_code: "KS", fed_district: 10, monitored: "80", verified_institutions: "30", counted_institutions: null, verified_fees: "200" },
      { state_code: null, fed_district: 8, monitored: "3", verified_institutions: "0", verified_fees: "0" },
      { state_code: "ZZ", fed_district: null, monitored: "9", verified_institutions: "9", verified_fees: "9" },
    ]);
    expect(coverage.states).toEqual([
      { state_code: "KS", monitored: 80, verified_institutions: 30, counted_institutions: 0, verified_fees: 200 },
      { state_code: "MO", monitored: 150, verified_institutions: 25, counted_institutions: 23, verified_fees: 190 },
    ]);
    expect(coverage.districts).toEqual([
      { district: 8, monitored: 103, verified_institutions: 20, counted_institutions: 18, verified_fees: 150 },
      { district: 10, monitored: 130, verified_institutions: 35, counted_institutions: 5, verified_fees: 240 },
    ]);
  });
});

describe("getResearchCoverage counts one population with the state hub (#1955)", () => {
  it("counts only active institutions, by the hub's own filter", async () => {
    db.mockClear();
    db.unsafe.mockClear();
    await getResearchCoverage();
    const [strings, ...values] = db.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    const text = strings.join("?");
    expect(text).toMatch(/WHERE \?\s+GROUP BY ct\.state_code/);
    expect(values).toContainEqual({ unsafeText: activeInstitutionFilter("ct") });
  });

  it("the hub's institution count reads the same filter", async () => {
    db.unsafe.mockReset();
    db.unsafe.mockImplementation(async () => []);
    await getStateHub("FL", new Date("2026-10-16T00:00:00Z"));
    const institutions = db.unsafe.mock.calls.find(([text]) => String(text).includes("AS with_fees"));
    expect(String(institutions?.[0])).toContain(activeInstitutionFilter("ct"));
  });
});
