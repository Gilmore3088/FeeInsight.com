import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { financialPeerComparison } from "@/lib/data-store/financial-peer-contract";
import { buildRevenueContext } from "@/lib/custom-report/revenue-context";
import { describe, expect, it } from "vitest";
import { buildMarketBranchFootprint } from "@/lib/data-store/branches";
import { footprintLine, notComparableNote, RevenueSection } from "./report-body";

const footprint = buildMarketBranchFootprint(
  2025,
  [
    { institution_id: 7, branches: 12, deposits: 168_000 },
    { institution_id: 8, branches: "1", deposits: "1000" },
    { institution_id: null, branches: 27, deposits: 1_831_000 },
  ],
  [
    { institution_id: 20, branches: "4" },
    { institution_id: 21, branches: 1 },
    { institution_id: 7, branches: 3 },
  ],
);

describe("footprintLine", () => {
  it("gives a bank its branches and local deposit share", () => {
    expect(footprintLine(footprint, 7)).toBe("12 branches · 8.4% of local deposits");
    expect(footprintLine(footprint, 8)).toBe("1 branch · under 0.1% of local deposits");
  });

  it("gives a credit union its branch count and no share", () => {
    expect(footprintLine(footprint, 20)).toBe("4 branches");
    expect(footprintLine(footprint, 21)).toBe("1 branch");
  });

  it("is null for an institution with no branches on file", () => {
    expect(footprintLine(footprint, 9)).toBeNull();
    expect(footprintLine(null, 7)).toBeNull();
  });
});

describe("buildMarketBranchFootprint", () => {
  it("keeps market totals to bank branches, which carry deposits", () => {
    expect(footprint.totalBranches).toBe(40);
    expect(footprint.totalDeposits).toBe(2_000_000_000);
    expect(footprint.byInstitution[20]).toEqual({ branches: 4, deposits: null });
  });
});

describe("cityLabel and placeLabel", () => {
  it("title-cases all-caps city names and keeps mixed case", async () => {
    const { cityLabel, placeLabel } = await import("./report-body");
    expect(cityLabel("READING")).toBe("Reading");
    expect(cityLabel("WILKES-BARRE")).toBe("Wilkes-Barre");
    expect(cityLabel("KING OF PRUSSIA")).toBe("King of Prussia");
    expect(cityLabel("McAllen")).toBe("McAllen");
    expect(cityLabel("Blue Bell")).toBe("Blue Bell");
    expect(placeLabel("READING, PA")).toBe("Reading, PA");
    expect(placeLabel("Ambler, PA")).toBe("Ambler, PA");
  });
});

describe("notComparableNote", () => {
  it("says the fee was not found when enough competitors publish it", () => {
    expect(notComparableNote({ own: null, peers: { n: 12 } as never })).toBe("Not found in your schedule");
  });

  it("keeps the small-group wording for thin lines", () => {
    expect(notComparableNote({ own: null, peers: { n: 2 } as never })).toBe("Too few local competitors");
    expect(notComparableNote({ own: { amount: 10 } as never, peers: { n: 3 } as never })).toBe("Too few local competitors");
  });
});


describe("RevenueSection financial measure labels", () => {
  it("renders only a CU cohort and its broad income definition, never a mixed peer claim", () => {
    const comparison = financialPeerComparison({ source: "ncua", reportDate: "2026-06-30", tier: "regional", minimumAssetsUsd: 1e10, maximumAssetsUsd: 250e9, subjectIncluded: true, eligibleCount: 25, reportedCount: 25, ratioReportedCount: 24, minimumMedianCount: 5 });
    const revenue = buildRevenueContext([{ quarter: "2026-Q2", service_charge_income: 300 }], { tier: "regional", sc_rank: 2, peer_count: 25, peer_median_sc: 75, comparison })!;
    const html = renderToStaticMarkup(createElement(RevenueSection, { name: "Synthetic CU", revenue }));
    expect(html).toContain("Broad credit-union fee income");
    expect(html).toContain("25 credit unions");
    expect(html).toContain("including Synthetic CU");
    expect(html).toContain("not deposit-only or overdraft-only income");
    expect(html).not.toContain("banks and credit unions");
    expect(html).not.toContain("Deposit service charges");
  });
});
