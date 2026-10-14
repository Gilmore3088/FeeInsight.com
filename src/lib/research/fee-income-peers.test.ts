import { describe, expect, it } from "vitest";
import type { FeeRevenueCorrelation } from "@/lib/data-store/fee-revenue";
import { feeIncomeAgainstPeers } from "./fee-income-peers";

// Invented rows for tests only; no figure here is live data.
function row(id: number, ratio: number | null, extra: Partial<FeeRevenueCorrelation> = {}): FeeRevenueCorrelation {
  return {
    institution_id: id,
    institution_name: `Synthetic ${id}`,
    charter_type: "bank",
    state_code: "MN",
    asset_size_tier: "community_small",
    fed_district: 9,
    report_date: "2026-06-30",
    financial_source: "fdic",
    total_assets: 1_000_000 * id,
    service_charge_income: 100 * id,
    fee_income_ratio: ratio,
    avg_fee: 20,
    fee_count: 5,
    median_overdraft: null,
    ...extra,
  };
}

describe("feeIncomeAgainstPeers", () => {
  const rows = [row(1, 3), row(2, 1), row(3, 2), row(4, 4), row(5, 5), row(6, 6), row(7, 7)];

  it("compares the institution with the median of its peers, itself left out", () => {
    const result = feeIncomeAgainstPeers(rows, 1, {});
    expect(result).toMatchObject({ view: "peers", quarter: "2026-06-30", peer_count: 6, peer_median_income_per_10k_assets: 4.5, peers_below_subject: 2 });
    expect("peers" in result && result.peers.map((p) => p.institution_id)).not.toContain(1);
  });

  it("uses exactly the hand-picked peers of a saved set", () => {
    const result = feeIncomeAgainstPeers(rows, 1, { institutionIds: [2, 3], states: ["TX"] });
    expect(result).toMatchObject({ peer_count: 2, peer_median_income_per_10k_assets: null });
    expect("message" in result && result.message).toContain("below 5 there is no median");
  });

  it("never mixes another quarter or the other regulator's year-to-date income", () => {
    const mixed = [...rows, row(8, 50, { report_date: "2026-03-31" }), row(9, 50, { financial_source: "ncua" })];
    expect(feeIncomeAgainstPeers(mixed, 1, {})).toMatchObject({ peer_count: 6, peer_median_income_per_10k_assets: 4.5 });
  });

  it("filters by state, charter, asset tier and district", () => {
    const varied = [...rows, row(10, 9, { state_code: "WI" }), row(11, 9, { charter_type: "credit_union" }), row(12, 9, { asset_size_tier: "large" }), row(13, 9, { fed_district: 7 })];
    expect(feeIncomeAgainstPeers(varied, 1, { states: ["MN"], charterType: "bank", assetTiers: ["community_small"], fedDistricts: [9] })).toMatchObject({ peer_count: 6 });
    expect(feeIncomeAgainstPeers(varied, 1, {})).toMatchObject({ peer_count: 10 });
  });

  it("says so when the institution has no fee income on file", () => {
    expect(feeIncomeAgainstPeers(rows, 99, {})).toMatchObject({ view: "peers", error: expect.stringContaining("cannot be compared") });
  });
});
