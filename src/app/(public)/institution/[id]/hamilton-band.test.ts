import { describe, expect, it } from "vitest";
import { quarterlyServiceCharges } from "./hamilton-band";
import type { NormalizedFinancial } from "./financial-units";

const quarter = (reportDate: string, source: string, serviceChargeIncome: number | null): NormalizedFinancial => ({
  reportDate,
  source,
  totalAssets: null,
  totalDeposits: null,
  serviceChargeIncome,
  feeIncomeRatioPct: null,
  roaPct: null,
  branchCount: null,
});

describe("quarterlyServiceCharges", () => {
  it("keeps FDIC quarters as filed, oldest first", () => {
    const rows = [quarter("2026-06-30", "fdic", 5.7e6), quarter("2026-03-31", "fdic", 5.6e6)];
    expect(quarterlyServiceCharges(rows)).toEqual([
      { reportDate: "2026-03-31", value: 5.6e6 },
      { reportDate: "2026-06-30", value: 5.7e6 },
    ]);
  });

  it("turns a credit union's year-to-date income into quarters", () => {
    const rows = [
      quarter("2026-03-31", "ncua", 250_000),
      quarter("2025-12-31", "ncua", 1_000_000),
      quarter("2025-09-30", "ncua", 750_000),
      quarter("2025-06-30", "ncua", 500_000),
    ];
    expect(quarterlyServiceCharges(rows)).toEqual([
      { reportDate: "2025-09-30", value: 250_000 },
      { reportDate: "2025-12-31", value: 250_000 },
      { reportDate: "2026-03-31", value: 250_000 },
    ]);
  });
});
