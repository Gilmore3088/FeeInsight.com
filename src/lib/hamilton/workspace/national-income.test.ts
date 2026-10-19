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
    const research = overdraftResearch({ institutionFinancials: null, nationalIncomeSeries: [row(source, "2026-Q2"), row(source, "2026-Q1")] });
    const exhibit = buildExhibit(research, "trend");
    expect(exhibit).toMatchObject({ kind: "trend", title: `${label}, U.S. ${kind} on file`, series: [{ label: `All ${kind} on file` }] });
    expect(exhibit?.title).not.toContain("banks and credit unions");
  });

  it("refuses mixed, missing, wrong-unit and mismatched measure metadata", () => {
    const cu = row("ncua", "2026-Q2");
    expect(nationalIncomeFamily([cu, row("fdic", "2026-Q2")])).toBeNull();
    expect(nationalIncomeFamily([{ ...cu, measureDefinition: undefined }])).toBeNull();
    expect(nationalIncomeFamily([{ ...cu, measureDefinition: { ...cu.measureDefinition, unit: "thousands of dollars" } }])).toBeNull();
    expect(nationalIncomeFamily([{ ...cu, measureDefinition: { ...cu.measureDefinition, measure: "deposit_service_charge_income" } }])).toBeNull();
  });
});
