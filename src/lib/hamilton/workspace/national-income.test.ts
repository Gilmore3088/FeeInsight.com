import { buildCallCohortHistory } from "@/lib/data-catalog/call-cohort-history";
import { describe, expect, it } from "vitest";
import { financialMeasureDefinition } from "@/lib/data-store/financial-peer-contract";
import { buildExhibit } from "./answer";
import { nationalIncomeFamily } from "./national-income";
import { overdraftResearch } from "./test-fixtures";
import type { MarketIncome } from "./types";

function row(source: "fdic" | "ncua", quarter: string): MarketIncome {
  return { financialSource: source, measureDefinition: { ...financialMeasureDefinition(source), unit: "USD" }, quarter,
    total: 300000000, banks: source === "fdic" ? 300000000 : 0, creditUnions: source === "ncua" ? 300000000 : 0,
    institutions: 25, yoyPct: null, sourceRef: { label: `${source} filings` } };
}

describe("national income fallback", () => {
  it.each([["fdic", "banks", "Deposit service charge income"], ["ncua", "credit unions", "Broad credit-union fee income"]] as const)("names the actual %s measure and charter in Hamilton's fallback", (source, kind, label) => {
    const history = buildCallCohortHistory({ requestedIds: null, periods: [] });
    const research = overdraftResearch({ institutionFinancials: null, nationalIncomeCohortHistory: history, nationalIncomeSeries: [row(source, "2026-Q2"), row(source, "2026-Q1")] });
    const exhibit = buildExhibit(research, "trend");
    expect(exhibit).toMatchObject({ kind: "trend", title: `${label}, U.S. ${kind} on file`, series: [{ label: `All ${kind} on file` }] });
    expect(exhibit).toMatchObject({ cohortHistory: history, note: expect.stringContaining("not constant-cohort or merger-adjusted growth") });
    expect(exhibit?.title).not.toContain("banks and credit unions");
  });

  it("preserves cohort evidence on the direct institution and peer trend path", () => {
    const research = overdraftResearch();
    const history = buildCallCohortHistory({ requestedIds: null, periods: [] });
    research.institutionFinancials!.peerMedian = { label: "Regional CUs", cohortHistory: history,
      quarters: [{ quarterEnd: "2026-06-30", amount: 10, institutions: 5 }, { quarterEnd: "2026-03-31", amount: 9, institutions: 6 }], sourceRef: { label: "NCUA" } };
    expect(buildExhibit(research, "trend")).toMatchObject({ kind: "trend", cohortHistory: history, note: expect.stringContaining("dated filing cross-sections") });
  });

  it("refuses mixed, missing, wrong-unit and mismatched measure metadata", () => {
    const cu = row("ncua", "2026-Q2");
    expect(nationalIncomeFamily([cu, row("fdic", "2026-Q2")])).toBeNull();
    expect(nationalIncomeFamily([{ ...cu, measureDefinition: undefined }])).toBeNull();
    expect(nationalIncomeFamily([{ ...cu, measureDefinition: { ...cu.measureDefinition, unit: "thousands of dollars" } }])).toBeNull();
    expect(nationalIncomeFamily([{ ...cu, measureDefinition: { ...cu.measureDefinition, measure: "deposit_service_charge_income" } }])).toBeNull();
  });
});
