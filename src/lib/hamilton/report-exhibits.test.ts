import { describe, expect, it } from "vitest";
import { annualServiceCharges, buildFeeImpacts, buildLocalComparisons } from "./report-exhibits";
import { checkNarrativeFigures } from "./figure-check";
import type { SelectedInstitutionFeeDelta } from "./report-evidence";
import type { LocalMarket } from "@/lib/data-store/local-market";

function delta(fee_category: string, institution_amount: number, peer_median: number): SelectedInstitutionFeeDelta {
  return {
    fee_name: fee_category,
    fee_category,
    institution_amount,
    peer_median,
    peer_p25: null,
    peer_p75: null,
    delta_amount: institution_amount - peer_median,
    delta_percent: ((institution_amount - peer_median) / peer_median) * 100,
    position: institution_amount > peer_median ? "above_peer_median" : "below_peer_median",
    evidence_tier: "verified",
    excluded_from_verified_benchmark: false,
    institution_count: 40,
    maturity: "strong",
    confidence: null,
    source_url: null,
  };
}

function market(fees: Array<Record<string, number>>): LocalMarket {
  return {
    basis: "branch_counties",
    label: "Flora, IL area",
    county_fips: [17025],
    sod_year: 2026,
    competitors: fees.map((f, i) => ({
      institution_id: i + 1,
      institution_name: `Bank ${i + 1}`,
      charter_type: "bank",
      market_deposits: null,
      fees: f,
      document_url: null,
      document_date: null,
    })),
  };
}

describe("buildLocalComparisons", () => {
  it("gives a local median only with at least three competitors publishing the fee", () => {
    const rows = buildLocalComparisons(
      [delta("nsf", 25, 30), delta("overdraft", 30, 32)],
      market([{ nsf: 30, overdraft: 35 }, { nsf: 32 }, { nsf: 28, overdraft: 33 }]),
    );
    const nsf = rows.find((row) => row.fee_category === "nsf");
    const overdraft = rows.find((row) => row.fee_category === "overdraft");
    expect(nsf).toMatchObject({ local_median: 30, local_competitor_count: 3, position_vs_local: "below" });
    expect(overdraft).toMatchObject({ local_median: null, local_competitor_count: 2, position_vs_local: null });
  });
});

describe("buildFeeImpacts", () => {
  it("sizes each gap per 1,000 charges against the local median when there is one, and states it as a share of income", () => {
    const deltas = [delta("nsf", 25, 30), delta("overdraft", 30, 32)];
    const local = buildLocalComparisons(deltas, market([{ nsf: 30 }, { nsf: 32 }, { nsf: 28 }]));
    const impacts = buildFeeImpacts(deltas, local, { year: 2025, amount: 1_000_000, source: "fdic" });
    expect(impacts).toEqual([
      expect.objectContaining({ fee_category: "nsf", reference: "local median", gap_amount: 5, income_per_1000_amount: 5000, share_of_service_charges_pct: 0.5 }),
      expect.objectContaining({ fee_category: "overdraft", reference: "peer median", gap_amount: 2, income_per_1000_amount: 2000, share_of_service_charges_pct: 0.2 }),
    ]);
    // The figures Hamilton may quote trace back to the payload.
    expect(checkNarrativeFigures("Moving NSF to $30 is worth $5,000 per 1,000 charges, 0.5% of income.", { impacts }).unmatched).toEqual([]);
  });
});

describe("annualServiceCharges", () => {
  it("sums the four FDIC quarters of the latest complete year, in dollars", () => {
    const quarters = ["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31"].map((report_date) => ({
      report_date, source: "fdic", service_charge_income: 250,
    }));
    const partial = { report_date: "2026-03-31", source: "fdic", service_charge_income: 300 };
    expect(annualServiceCharges([partial, ...quarters])).toEqual({ year: 2025, amount: 1_000_000, source: "fdic" });
  });

  it("uses the December year-to-date value for NCUA and descales FFIEC", () => {
    expect(
      annualServiceCharges([
        { report_date: "2025-06-30", source: "ncua", service_charge_income: 282_949 },
        { report_date: "2025-12-31", source: "ncua", service_charge_income: 574_830 },
      ]),
    ).toEqual({ year: 2025, amount: 574_830_000, source: "ncua" });
    expect(
      annualServiceCharges([{ report_date: "2025-12-31", source: "ffiec", service_charge_income: 821_921_000_000 }]),
    ).toEqual({ year: 2025, amount: 821_921_000, source: "ffiec" });
  });

  it("returns null without a complete year", () => {
    expect(annualServiceCharges([{ report_date: "2026-06-30", source: "fdic", service_charge_income: 10 }])).toBeNull();
  });
});
