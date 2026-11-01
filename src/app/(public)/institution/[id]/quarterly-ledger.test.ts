import { describe, expect, it } from "vitest";
import type { InstitutionFinancialHistoryRow } from "@/lib/data-store/financial";
import type { CallItemHistoryRow } from "@/lib/data-store/institution-quarterly";
import { fieldNotes } from "./ledger-fields";
import {
  buildLedger,
  change,
  differencedIncomeDisagrees,
  connectedPanelSeries,
  latestOf,
  previousQuarterEnd,
  rangeQuarters,
  toStandaloneQuarters,
} from "./quarterly-ledger";

describe("connectedPanelSeries", () => {
  it("returns the newest quarters carrying service charges, oldest first, with their filing", () => {
    const ledger = {
      quarters: [
        { reportDate: "2025-09-30", quarter: "Q3 2025", values: { serviceCharges: { value: 1, source: "fdic" as const } } },
        { reportDate: "2025-12-31", quarter: "Q4 2025", values: { assets: { value: 9, source: "fdic" as const } } },
        { reportDate: "2026-03-31", quarter: "Q1 2026", values: { serviceCharges: { value: 2, source: "ffiec" as const } } },
        { reportDate: "2026-06-30", quarter: "Q2 2026", values: { serviceCharges: { value: 3, source: "ffiec" as const } } },
      ],
      filer: "bank" as const,
      ffiecCodes: {},
      retrievedAt: null,
    };
    expect(connectedPanelSeries(ledger, 2)).toEqual([
      { reportDate: "2026-03-31", value: 2, source: "ffiec" },
      { reportDate: "2026-06-30", value: 3, source: "ffiec" },
    ]);
    expect(connectedPanelSeries(ledger, 4).map((q) => q.reportDate)).toEqual(["2025-09-30", "2026-03-31", "2026-06-30"]);
  });
});

function record(partial: Partial<InstitutionFinancialHistoryRow> & { report_date: string; source: string }): InstitutionFinancialHistoryRow {
  return {
    institution_id: 1,
    total_assets: null,
    total_deposits: null,
    total_loans: null,
    service_charge_income: null,
    other_noninterest_income: null,
    net_interest_margin: null,
    efficiency_ratio: null,
    roa: null,
    roe: null,
    tier1_capital_ratio: null,
    branch_count: null,
    employee_count: null,
    member_count: null,
    total_revenue: null,
    fee_income_ratio: null,
    overdraft_revenue: null,
    net_income: null,
    fetched_at: null,
    ...partial,
  } as InstitutionFinancialHistoryRow;
}

function item(report_date: string, item_key: string, item_code: string, value: number, period_basis = "ytd"): CallItemHistoryRow {
  return { report_date, item_key, item_code, item_description: null, value, unit: "thousands", period_basis, fetched_at: "2026-10-01T00:00:00Z" };
}

describe("toStandaloneQuarters", () => {
  it("keeps Q1 and differences later quarters within the year", () => {
    const out = toStandaloneQuarters(new Map([
      ["2025-03-31", 100],
      ["2025-06-30", 250],
      ["2025-09-30", 420],
      ["2025-12-31", 600],
      ["2026-03-31", 90],
    ]));
    expect([...out.entries()]).toEqual([
      ["2025-03-31", 100],
      ["2025-06-30", 150],
      ["2025-09-30", 170],
      ["2025-12-31", 180],
      ["2026-03-31", 90],
    ]);
  });

  it("leaves a quarter empty when the prior quarter of its year is missing", () => {
    const out = toStandaloneQuarters(new Map([["2025-03-31", 100], ["2025-09-30", 420]]));
    expect(out.get("2025-09-30")).toBeNull();
  });

  it("never differences across a year end", () => {
    expect(previousQuarterEnd("2026-03-31")).toBe("2025-12-31");
    expect(previousQuarterEnd("2026-12-31")).toBe("2026-09-30");
    const out = toStandaloneQuarters(new Map([["2025-12-31", 600], ["2026-03-31", 90]]));
    expect(out.get("2026-03-31")).toBe(90);
  });
});

describe("buildLedger", () => {
  it("converts FFIEC year-to-date lines and keeps balances point in time", () => {
    const items = [
      item("2026-03-31", "service_charges_deposits_ytd", "RIAD4080", 5_000),
      item("2026-06-30", "service_charges_deposits_ytd", "RIAD4080", 10_700),
      item("2026-03-31", "net_interest_income_ytd", "RIAD4074", 40_000),
      item("2026-06-30", "net_interest_income_ytd", "RIAD4074", 81_000),
      item("2026-03-31", "noninterest_income_total_ytd", "RIAD4079", 15_000),
      item("2026-06-30", "noninterest_income_total_ytd", "RIAD4079", 30_000),
      item("2026-03-31", "total_assets", "RCFD2170", 4_300_000, "point_in_time"),
      item("2026-06-30", "total_assets", "RCFD2170", 4_400_000, "point_in_time"),
    ];
    const ledger = buildLedger([], items);
    const q2 = ledger.quarters.find((q) => q.reportDate === "2026-06-30")!;
    expect(q2.values.serviceCharges).toEqual({ value: 5_700_000, source: "ffiec" });
    expect(q2.values.revenue?.value).toBe((41_000 + 15_000) * 1_000);
    expect(q2.values.assets?.value).toBe(4_400_000_000);
    expect(q2.values.sharePct?.value).toBeCloseTo((5_700 / 56_000) * 100, 6);
    expect(fieldNotes(ledger, "revenue")[0].fields).toBe("RIAD4074 + RIAD4079");
    expect(fieldNotes(ledger, "sharePct")[0].fields).toBe("RIAD4080 / (RIAD4074 + RIAD4079)");
    expect(fieldNotes(ledger, "serviceCharges")[0].calculation).toMatch(/Standalone quarter/);
    expect(fieldNotes(ledger, "assets")[0].calculation).toMatch(/Point in time/);
  });

  it("takes FDIC quarterly income as reported, and leaves legacy rows' income empty", () => {
    const ledger = buildLedger(
      [
        record({ report_date: "2022-12-31", source: "fdic", total_assets: 4_000_000, service_charge_income: 9_999 }),
        record({ report_date: "2023-03-31", source: "fdic", total_assets: 4_100_000, service_charge_income: 5_100, total_revenue: 50_000, net_income: 12_000, roa: 1.2 }),
      ],
      [],
    );
    expect(ledger.quarters[0].values.serviceCharges).toBeUndefined();
    expect(ledger.quarters[0].values.assets?.value).toBe(4_000_000_000);
    expect(ledger.quarters[1].values.serviceCharges).toEqual({ value: 5_100_000, source: "fdic" });
    expect(ledger.quarters[1].values.netIncome?.value).toBe(12_000_000);
    expect(ledger.filer).toBe("bank");
    expect(fieldNotes(ledger, "serviceCharges")[0].fields).toBe("ISERCHGQ");
  });

  it("makes NCUA year-to-date income standalone", () => {
    const ledger = buildLedger(
      [
        record({ report_date: "2026-03-31", source: "ncua", service_charge_income: 300, total_revenue: 3_000, net_income: 100 }),
        record({ report_date: "2026-06-30", source: "ncua", service_charge_income: 700, total_revenue: 6_400, net_income: 150 }),
      ],
      [],
    );
    const q2 = latestOf(ledger, "serviceCharges")!;
    expect(q2.value).toEqual({ value: 400_000, source: "ncua" });
    expect(latestOf(ledger, "netIncome")!.value.value).toBe(50_000);
    expect(latestOf(ledger, "sharePct")!.value.value).toBeCloseTo((400 / 3_400) * 100, 6);
    expect(ledger.filer).toBe("credit_union");
  });

  it("prefers the FFIEC line and falls back to the FDIC row per quarter", () => {
    const ledger = buildLedger(
      [
        record({ report_date: "2026-03-31", source: "fdic", service_charge_income: 5_000, total_revenue: 55_000, net_income: 1 }),
        record({ report_date: "2026-06-30", source: "fdic", service_charge_income: 5_700, total_revenue: 56_000, net_income: 1 }),
      ],
      [item("2026-03-31", "service_charges_deposits_ytd", "RIAD4080", 5_000)],
    );
    expect(ledger.quarters.map((q) => q.values.serviceCharges?.source)).toEqual(["ffiec", "fdic"]);
    // The share divides within one filing only: Q1 has no FFIEC revenue, so it takes neither.
    expect(ledger.quarters[0].values.sharePct).toBeUndefined();
    expect(fieldNotes(ledger, "serviceCharges").map((n) => n.source)).toEqual(["ffiec", "fdic"]);
  });
});

describe("bank income where differencing the filed year to date goes wrong (#2025)", () => {
  // Stored filings, read 2026-10-25: U.S. Bank (cert 6548) absorbed MUFG Union Bank (cert 22826) on
  // 2023-05-26. RIAD4080 year to date: Q1 240,341, Q2 534,603 ($K). BankFind ISERCHGQ: Q1 240,341,
  // Q2 266,655. Union Bank's own Q1 was 27,607, exactly the gap. Revenue lines are illustrative.
  const usBank = () =>
    buildLedger(
      [
        record({ report_date: "2023-03-31", source: "fdic", service_charge_income: 240_341, total_revenue: 6_900_000, net_income: 1 }),
        record({ report_date: "2023-06-30", source: "fdic", service_charge_income: 266_655, total_revenue: 7_185_290, net_income: 1 }),
      ],
      [
        item("2023-03-31", "service_charges_deposits_ytd", "RIAD4080", 240_341),
        item("2023-06-30", "service_charges_deposits_ytd", "RIAD4080", 534_603),
        item("2023-03-31", "net_interest_income_ytd", "RIAD4074", 4_400_000),
        item("2023-06-30", "net_interest_income_ytd", "RIAD4074", 9_100_000),
        item("2023-03-31", "noninterest_income_total_ytd", "RIAD4079", 2_500_000),
        item("2023-06-30", "noninterest_income_total_ytd", "RIAD4079", 5_100_000),
      ],
    );

  it("takes BankFind's merger-adjusted quarter in the quarter a bank absorbs another", () => {
    const ledger = usBank();
    const [q1, q2] = ledger.quarters;
    expect(q1.values.serviceCharges).toEqual({ value: 240_341_000, source: "ffiec" });
    expect(q2.values.serviceCharges).toEqual({ value: 266_655_000, source: "fdic" });
    // Both income lines move together, so the share still divides within one filing.
    expect(q2.values.revenue).toEqual({ value: 7_185_290_000, source: "fdic" });
    expect(q2.values.sharePct?.source).toBe("fdic");
    expect(fieldNotes(ledger, "serviceCharges").map((n) => n.source)).toEqual(["ffiec", "fdic"]);
  });

  it("takes BankFind's quarter when the filed year to date restarts mid-year", () => {
    // Institution 365 (cert 34618), 2024: RIAD4080 year to date Q2 2,036, Q3 728; BankFind Q3 728.
    const ledger = buildLedger(
      [record({ report_date: "2024-09-30", source: "fdic", service_charge_income: 728, net_income: 1 })],
      [
        item("2024-06-30", "service_charges_deposits_ytd", "RIAD4080", 2_036),
        item("2024-09-30", "service_charges_deposits_ytd", "RIAD4080", 728),
      ],
    );
    const q3 = ledger.quarters.find((q) => q.reportDate === "2024-09-30")!;
    expect(q3.values.serviceCharges).toEqual({ value: 728_000, source: "fdic" });
  });

  it("keeps the FFIEC line when the two copies agree within $1K or 0.05%", () => {
    const fdic = (serviceCharges: number | null) => ({ source: "fdic" as const, serviceCharges, revenue: null });
    const ffiec = (serviceCharges: number) => ({ serviceCharges, revenue: null });
    expect(differencedIncomeDisagrees(ffiec(300_000), fdic(269_000))).toBe(true);
    expect(differencedIncomeDisagrees(ffiec(300_000), fdic(299_000))).toBe(false);
    expect(differencedIncomeDisagrees(ffiec(1_000_000_000), fdic(1_000_400_000))).toBe(false);
    expect(differencedIncomeDisagrees(ffiec(300_000), { source: "ncua", serviceCharges: 1, revenue: null })).toBe(false);
    expect(differencedIncomeDisagrees(ffiec(300_000), fdic(null))).toBe(false);
  });
});

describe("change and ranges", () => {
  it("states dollars and percent, and no percent from a non-positive base", () => {
    expect(change(110, 100)).toEqual({ dollars: 10, pct: expect.closeTo(10, 6) });
    expect(change(5, -5)?.pct).toBeNull();
    expect(change(null, 5)).toBeNull();
  });

  it("shows the newest N quarters that carry the measure", () => {
    const ledger = buildLedger(
      ["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31"].map((d, i) =>
        record({ report_date: d, source: "fdic", total_assets: 1_000 + i }),
      ),
      [],
    );
    expect(rangeQuarters(ledger.quarters, "assets", "4").map((q) => q.reportDate)).toEqual([
      "2025-06-30",
      "2025-09-30",
      "2025-12-31",
      "2026-03-31",
    ]);
    expect(rangeQuarters(ledger.quarters, "assets", "all")).toHaveLength(5);
  });
});
