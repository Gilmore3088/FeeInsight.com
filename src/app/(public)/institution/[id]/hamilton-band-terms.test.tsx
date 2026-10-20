import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HamiltonBand, type HamiltonInsight } from "./hamilton-band";
import { feeIncomeTerms, type NormalizedFinancial } from "./financial-units";

const quarter = (reportDate: string, source: string, serviceChargeIncome: number): NormalizedFinancial => ({
  reportDate,
  source,
  totalAssets: null,
  totalDeposits: null,
  serviceChargeIncome,
  feeIncomeRatioPct: null,
  roaPct: null,
  branchCount: null,
});

const insight = (source: string, kind: string): HamiltonInsight => ({
  quarters: [quarter("2026-06-30", source, 2_000_000), quarter("2026-03-31", source, 1_000_000)],
  ownSharePct: 8.2,
  peerSharePct: 6.1,
  peerCount: 40,
  filerCount: 45,
  sizeRange: "$1B to $10B",
  kind,
});

const band = (source: string, kind: string) =>
  render(<HamiltonBand institutionName="Example" insight={insight(source, kind)} plansHref="/pro" reportOfferHref="/report" />).container
    .textContent ?? "";

describe("feeIncomeTerms", () => {
  it("names a credit union's figure by its NCUA 5300 line, not the bank's", () => {
    expect(feeIncomeTerms("ncua")).toMatchObject({ subject: "Fee income", was: "was", title: "Fee income" });
    expect(feeIncomeTerms("ncua").definition).toContain("Account 131");
    expect(feeIncomeTerms("fdic")).toMatchObject({ subject: "Service charges", was: "were", title: "Deposit service charges" });
  });
});

describe("HamiltonBand call-report wording", () => {
  it("says fee income for a credit union and never service charges", () => {
    const text = band("ncua", "credit union");
    expect(text).toContain("Fee income was 8.2% of Example");
    expect(text).toContain("Fee income (NCUA 5300 Account 131) divided by revenue");
    expect(text).toContain("Fee income by quarter");
    expect(text).not.toMatch(/service.charge/i);
  });

  it("keeps the bank wording for a bank", () => {
    const text = band("fdic", "bank");
    expect(text).toContain("Service charges were 8.2% of Example");
    expect(text).toContain("Service charges on deposit accounts divided by revenue");
    expect(text).toContain("Service-charge income by quarter");
  });
});
