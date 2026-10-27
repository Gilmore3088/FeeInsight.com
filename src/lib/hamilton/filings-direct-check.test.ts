import { describe, expect, it } from "vitest";
import { toFinancialHistoryRow } from "@/lib/data-store/financial";
import {
  directCheckReport,
  directCheckSql,
  ffiecFileDate,
  formatDirectReport,
  ncuaCycleDate,
  readFfiecQuarter,
  readNcuaQuarter,
  type DirectSubject,
  type Filings,
} from "./filings-direct-check";

// FFIEC CDR bulk schedule files: tab-delimited, codes on row 1, descriptions on row 2, quoted cells.
const tsv = (header: string[], desc: string[], rows: (string | number)[][]) =>
  [header, desc, ...rows].map((r) => r.map((c) => `"${c}"`).join("\t")).join("\r\n");

function ffiecQuarter(mmddyyyy: string, v: Record<string, number | "">) {
  const rc = ["RCON2170", "RCON2200", "RCONB529", "RCONG105"];
  const ri = ["RIAD4340", "RIAD4080", "RIADJJ33", "RIADH032"];
  const rck = ["RCON3368"];
  const rcr = ["RCOA7204", "RCOA7205", "RCOA7206"];
  const file = (codes: string[]) => tsv(["IDRSSD", ...codes], ["", ...codes.map((c) => `DESC ${c}`)], [["0123456", ...codes.map((c) => v[c] ?? "")]]);
  return {
    [`FFIEC CDR Call Schedule RC ${mmddyyyy}.txt`]: file(rc),
    [`FFIEC CDR Call Schedule RI ${mmddyyyy}.txt`]: file(ri),
    [`FFIEC CDR Call Schedule RCK ${mmddyyyy}.txt`]: file(rck),
    [`FFIEC CDR Call Schedule RCRI ${mmddyyyy}(1 of 2).txt`]: file(rcr),
  };
}

const csv = (rows: (string | number)[][]) => rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\r\n");
function ncuaQuarter(cycle: string, v: Record<string, number>) {
  const a = ["ACCT_010", "ACCT_018", "ACCT_083"];
  const b = ["ACCT_025B", "ACCT_997", "ACCT_998", "ACCT_661A", "ACCT_131", "ACCT_IS0048", "ACCT_IS0049"];
  return {
    "FS220.txt": csv([["CU_NUMBER", "CYCLE_DATE", ...a], ["42", cycle, ...a.map((c) => v[c])]]),
    "FS220A.txt": csv([["CU_NUMBER", "CYCLE_DATE", ...b], ["42", cycle, ...b.map((c) => v[c])]]),
  };
}

const ffiec: Filings = new Map([
  ["2025-12-31", readFfiecQuarter(ffiecQuarter("12312025", { RCON2170: 490000, RCON2200: 395000, RCONB529: 298000, RCONG105: 49000, RIAD4340: 4000, RIAD4080: 2000, RIADJJ33: 400, RIADH032: 800, RCON3368: 488000, RCOA7204: 9.4, RCOA7205: 14.1, RCOA7206: 13.0 })).quarter],
  ["2026-03-31", readFfiecQuarter(ffiecQuarter("03312026", { RCON2170: 500000, RCON2200: 400000, RCONB529: 300000, RCONG105: 50000, RIAD4340: 1100, RIAD4080: 520, RIADJJ33: 90, RIADH032: 210, RCON3368: 495000, RCOA7204: 9.5, RCOA7205: 14.2, RCOA7206: 13.1 })).quarter],
  ["2026-06-30", readFfiecQuarter(ffiecQuarter("06302026", { RCON2170: 510000, RCON2200: 405000, RCONB529: 305000, RCONG105: 51000, RIAD4340: 2300, RIAD4080: 1000, RIADJJ33: 200, RIADH032: 430, RCON3368: 505000, RCOA7204: 9.6, RCOA7205: 14.3, RCOA7206: 13.2 })).quarter],
]);

const ncua: Filings = new Map(
  [
    ncuaQuarter("3/31/2026 0:00:00", { ACCT_010: 1_000_000_000, ACCT_018: 850_000_000, ACCT_083: 50_000, ACCT_025B: 700_000_000, ACCT_997: 110_000_000, ACCT_998: 1100, ACCT_661A: 2_000_000, ACCT_131: 3_000_000, ACCT_IS0048: 0, ACCT_IS0049: 0 }),
    ncuaQuarter("6/30/2026 0:00:00", { ACCT_010: 1_020_000_000, ACCT_018: 860_000_000, ACCT_083: 50_500, ACCT_025B: 710_000_000, ACCT_997: 112_000_000, ACCT_998: 1098, ACCT_661A: 4_100_000, ACCT_131: 6_200_000, ACCT_IS0048: 0, ACCT_IS0049: 0 }),
  ].map((files) => {
    const r = readNcuaQuarter(files);
    return [r.reportDate!, r.quarter] as const;
  }),
);

const bankRow = (report_date: string, v: Record<string, number | null>) =>
  toFinancialHistoryRow({ institution_id: 7, report_date, source: "fdic", ...v });
const cuRow = (report_date: string, v: Record<string, number | null>) =>
  toFinancialHistoryRow({ institution_id: 8, report_date, source: "ncua", ...v });

const bank: DirectSubject = {
  institutionId: 7,
  charter: "bank",
  filerId: "123456",
  rows: [
    bankRow("2025-12-31", { total_assets: 490000, total_deposits: 395000, total_loans: 298000, total_equity: 49000, net_income: 1000, service_charge_income: 510, provision_for_losses: 100, overdraft_revenue: 200, roa: 0.82, leverage_ratio: 9.4, total_capital_ratio: 14.1, tier1_capital_ratio: 13.0 }),
    bankRow("2026-03-31", { total_assets: 500000, total_deposits: 400000, total_loans: 300000, total_equity: 50000, net_income: 1100, service_charge_income: 520, provision_for_losses: 90, overdraft_revenue: 210, roa: 0.8889, leverage_ratio: 9.5, total_capital_ratio: 14.2, tier1_capital_ratio: 13.1 }),
    // Planted: service charges shown as 500 where the filing differences to 480.
    bankRow("2026-06-30", { total_assets: 510000, total_deposits: 405000, total_loans: 305000, total_equity: 51000, net_income: 1200, service_charge_income: 500, provision_for_losses: 110, overdraft_revenue: 220, roa: 0.9505, leverage_ratio: 9.6, total_capital_ratio: 14.3, tier1_capital_ratio: 13.2 }),
  ],
};

const creditUnion: DirectSubject = {
  institutionId: 8,
  charter: "credit_union",
  filerId: "00042",
  rows: [
    cuRow("2026-03-31", { total_assets: 1_000_000, total_deposits: 850_000, total_loans: 700_000, total_equity: 110_000, tier1_capital_ratio: 1100, net_income: 2000, service_charge_income: 3000, member_count: 50_000, roa: 0.8, overdraft_revenue: null }),
    cuRow("2026-06-30", { total_assets: 1_020_000, total_deposits: 860_000, total_loans: 710_000, total_equity: 112_000, tier1_capital_ratio: 1098, net_income: 4100, service_charge_income: 6200, member_count: 50_500, roa: 0.8039, overdraft_revenue: null }),
  ],
  nsfRevenue: { "2026-03-31": null, "2026-06-30": null },
};

describe("direct filings check (#1925)", () => {
  const report = directCheckReport([bank, creditUnion], ffiec, ncua);

  it("reads the regulators' file layouts", () => {
    expect(ffiecFileDate("FFIEC CDR Call Schedule RCRI 06302026(1 of 2).txt")).toBe("2026-06-30");
    expect(ncuaCycleDate("6/30/2026 0:00:00")).toBe("2026-06-30");
    expect(ffiec.get("2026-03-31")?.get("123456")?.get("RCOA7206")).toBe(13.1);
    expect(ncua.get("2026-06-30")?.get("42")?.get("ACCT_131")).toBe(6_200_000);
  });

  it("matches every bank figure that agrees with the call report, and lists the one that does not", () => {
    const t = report.bank.tallies;
    expect(report.bank.quarters).toEqual(["2025-12-31", "2026-03-31", "2026-06-30"]);
    for (const m of ["assets", "deposits", "loans", "equity", "tier1Pct", "leveragePct", "totalCapitalPct"] as const) {
      expect(t[m]).toMatchObject({ compared: 3, matched: 3, mismatched: 0 });
    }
    // Q4 2025 cannot be made a quarter without the Q3 file: counted as filedMissing, never a match.
    for (const m of ["netIncome", "provision", "workspaceOverdraft", "roaPct"] as const) {
      expect(t[m]).toMatchObject({ compared: 2, matched: 2, mismatched: 0, filedMissing: 1 });
    }
    expect(t.serviceCharges).toMatchObject({ compared: 2, matched: 1, mismatched: 1, filedMissing: 1 });
    expect(t.workspaceServiceCharges).toMatchObject({ compared: 2, matched: 1, mismatched: 1 });
    expect(report.bank.mismatches.map((m) => [m.reportDate, m.metric, m.shown, m.filed])).toEqual([
      ["2026-06-30", "serviceCharges", 500_000, 480_000],
      ["2026-06-30", "workspaceServiceCharges", 500_000, 480_000],
    ]);
  });

  it("matches credit-union figures and counts NCUA's zero overdraft and NSF lines as not reported", () => {
    const t = report.creditUnion.tallies;
    for (const m of ["assets", "deposits", "loans", "equity", "tier1Pct", "roaPct", "members"] as const) {
      expect(t[m]).toMatchObject({ compared: 2, matched: 2, mismatched: 0 });
    }
    for (const m of ["netIncome", "serviceCharges", "workspaceServiceCharges"] as const) {
      expect(t[m]).toMatchObject({ compared: 2, matched: 2, mismatched: 0 });
    }
    expect(t.workspaceOverdraft).toMatchObject({ compared: 0, notReported: 2 });
    expect(t.workspaceNsf).toMatchObject({ compared: 0, notReported: 2 });
    expect(report.creditUnion.mismatches).toEqual([]);
  });

  it("catches a credit union's shown figure that differs from the 5300", () => {
    const off: DirectSubject = { ...creditUnion, rows: [creditUnion.rows[0], { ...creditUnion.rows[1], total_assets: 1_030_000 }] };
    const r = directCheckReport([off], ffiec, ncua);
    expect(r.creditUnion.mismatches.map((m) => [m.metric, m.shown, m.filed])).toContainEqual(["assets", 1_030_000_000, 1_020_000_000]);
  });

  it("names a subject absent from every loaded file rather than counting it clean", () => {
    const r = directCheckReport([{ ...bank, filerId: "999" }], ffiec, ncua);
    expect(r.bank.notInFile).toEqual([7]);
    expect(r.totals.compared).toBe(0);
  });

  it("adds foreign-office deposits for an FFIEC 031 filer", () => {
    const q = readFfiecQuarter({ "FFIEC CDR Call Schedule RC 03312026.txt": tsv(["IDRSSD", "RCFD2170", "RCON2200", "RCFN2200"], ["", "a", "b", "c"], [["5", 900, 600, 100]]) }).quarter;
    const sub: DirectSubject = { institutionId: 5, charter: "bank", filerId: "5", rows: [bankRow("2026-03-31", { total_assets: 900, total_deposits: 700 })] };
    const r = directCheckReport([sub], new Map([["2026-03-31", q]]), new Map());
    expect(r.bank.tallies.deposits).toMatchObject({ compared: 1, matched: 1 });
    expect(r.bank.tallies.assets).toMatchObject({ compared: 1, matched: 1 });
  });

  it("lists a value filed twice with different figures", () => {
    const files = {
      "FFIEC CDR Call Schedule RC 03312026.txt": tsv(["IDRSSD", "RCON2170"], ["", "a"], [["5", 900]]),
      "FFIEC CDR Call Schedule RCK 03312026.txt": tsv(["IDRSSD", "RCON2170"], ["", "a"], [["5", 901]]),
    };
    expect(readFfiecQuarter(files).conflicts).toHaveLength(1);
  });

  it("prints counts and each mismatch", () => {
    const text = formatDirectReport(report);
    expect(text).toContain("MISMATCH 7 (123456) 2026-06-30 serviceCharges: shown 500,000, filed 480,000 [RIAD4080");
    expect(text).toContain("roaPct (derived)");
    expect(text).toMatch(/Total: \d+ of \d+ compared figures match; 2 mismatched\./);
  });

  it("builds a read-only SELECT with sanitized inputs", () => {
    const q = directCheckSql({ perCharter: 10, seed: "1925'; drop table x;--", from: "bad", extraIds: [5, Number.NaN] });
    expect(q.trim().startsWith("WITH pick AS")).toBe(true);
    expect(q).not.toMatch(/drop table|insert |update |delete /i);
    expect(q).toContain("'1925droptablex--'");
    expect(q).toContain("'2023-01-01'");
    expect(q).toContain("IN (5)");
  });
});
