import { describe, expect, it } from "vitest";
import { groupFeesByFamily, type DisplayFee } from "./fee-schedule-table";

describe("fee table dedupe keeps account identity", () => {
  const row = (id: string, extra: Partial<DisplayFee> = {}): DisplayFee => ({
    id,
    feeName: "Monthly service fee",
    feeCategory: "monthly_maintenance",
    amount: 10,
    frequency: "monthly",
    conditions: null,
    status: "verified",
    sourceUrl: null,
    ...extra,
  });
  const rows = (fees: DisplayFee[]) => groupFeesByFamily(fees).flatMap((group) => group.rows);

  it("keeps two rows with the same fee name and amount but different waivers", () => {
    expect(
      rows([row("a", { conditions: "Waived with $500 direct deposit" }), row("b", { conditions: "Waived for age 65 or older" })]),
    ).toHaveLength(2);
  });

  it("keeps a consumer and a business row with the same fee name and amount", () => {
    expect(rows([row("a", { feeAudience: "consumer" }), row("b", { feeAudience: "business" })])).toHaveLength(2);
  });

  it("collapses a full duplicate to one row, ignoring case and spacing", () => {
    expect(
      rows([row("a", { conditions: "Waived with $500 balance" }), row("b", { feeName: "monthly  service fee", conditions: "waived with $500 Balance" })]),
    ).toHaveLength(1);
  });
});
