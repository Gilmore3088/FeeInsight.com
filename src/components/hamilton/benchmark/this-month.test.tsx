import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BriefingLocalMarket, RevenueLine } from "@/lib/hamilton/workspace/types";
import { competitorColumns, LocalCompetitors } from "./LocalCompetitors";
import { overdraftIncomeNote } from "./ThisMonthOverview";

const market: BriefingLocalMarket = {
  info: { basis: "branch_counties", places: ["Melbourne, FL"], sodYear: 2026, institutions: 9, source: { label: "SOD", asOf: "2026" } },
  rows: [
    { institutionId: 1, name: "Subject CU", own: true, marketDeposits: null, values: { stop_payment: 15, overdraft: 30, late_payment: 15, dormant_account: 5 } },
    { institutionId: 2, name: "Bank Two", own: false, marketDeposits: 2.1e9, values: { stop_payment: 30, overdraft: 35, late_payment: 39 } },
    { institutionId: 3, name: "Bank Three", own: false, marketDeposits: 7e8, values: { stop_payment: 33, overdraft: 36 } },
  ],
};

describe("LocalCompetitors", () => {
  it("shows the bank's fees most competitors publish, leaving out mixed-basis fees and thin ones", () => {
    expect(competitorColumns(market, ["late_payment"])).toEqual(["overdraft", "stop_payment"]);
    expect(competitorColumns(market)).toEqual(["overdraft", "stop_payment"]);
  });

  it("renders the bank first with local deposits and dashes for unpublished fees", () => {
    const html = renderToStaticMarkup(<LocalCompetitors market={market} notCompared={["late_payment"]} />);
    expect(html).toContain("Your named competitors");
    expect(html).toContain("FDIC Summary of Deposits 2026");
    expect(html).toContain("$2.1B");
    expect(html).toContain("$700M");
    expect(html.indexOf("Subject CU")).toBeLessThan(html.indexOf("Bank Two"));
    expect(html).not.toMatch(/raise|recommend/i);
  });

  it("renders nothing when no fee is published by enough competitors", () => {
    const thin = { ...market, rows: market.rows.slice(0, 2) };
    expect(renderToStaticMarkup(<LocalCompetitors market={thin} />)).toBe("");
  });
});

describe("overdraftIncomeNote", () => {
  const cu: RevenueLine = {
    annualIncome: 19_464_000,
    label: "Overdraft fee income (NCUA 5300, IS0048)",
    quarterEnd: "2024-12-31",
    source: { label: "x", asOf: "2024-12-31" },
  };

  it("labels the filing period and form, with no per-dollar sensitivity", () => {
    expect(overdraftIncomeNote(cu)).toBe(
      "Overdraft fee income was $19.5M in the four quarters to December 31, 2024, the latest filed (NCUA 5300, IS0048).",
    );
  });

  it("gives only the filed line when a bank's line combines overdraft and NSF", () => {
    const bank = { ...cu, label: "Consumer overdraft and NSF fee income (call report Schedule RI-E, RIAD H032)", combinedWith: "NSF" };
    expect(overdraftIncomeNote(bank)).toBe(
      "Consumer overdraft and NSF fee income was $19.5M in the four quarters to December 31, 2024, the latest filed (call report Schedule RI-E, RIAD H032).",
    );
  });
});
