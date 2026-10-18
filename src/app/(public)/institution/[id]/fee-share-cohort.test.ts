import { describe, expect, it } from "vitest";
import type { FeeShareCohort } from "@/lib/data-store/institution-quarterly";
import { buildCohortDistribution, listablePeers, ordinal, percentileCont, percentileRank } from "./fee-share-cohort";
import { buildObservations } from "./overview-observations";
import { buildLedger } from "./quarterly-ledger";
import { feeIncomeTerms } from "./financial-units";

function cohort(ratios: Array<number | null>, subjectRatio: number | null): FeeShareCohort {
  return {
    report_date: "2026-06-30",
    source: "fdic",
    charter_type: "bank",
    asset_size_tier: "community_large",
    filers: ratios.length + 1,
    members: [
      { id: 1, name: "Subject Bank", city: "Tallahassee", state: "FL", total_assets: 4_400_000, service_charge_income: 5_700, total_revenue: 65_000, fee_income_ratio: subjectRatio },
      ...ratios.map((r, i) => ({ id: i + 2, name: `Peer ${i + 2}`, city: null, state: "GA", total_assets: 2_000_000, service_charge_income: 1_000, total_revenue: 40_000, fee_income_ratio: r })),
    ],
  };
}

describe("cohort distribution", () => {
  it("matches Postgres percentile_cont and ranks the subject against peers only", () => {
    expect(percentileCont([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentileCont([1, 2, 3, 4, 5], 0.25)).toBe(2);
    expect(percentileRank([1, 2, 3, 4], 3)).toBe(62.5);
    const ratios = Array.from({ length: 12 }, (_, i) => (i + 1) / 100);
    const d = buildCohortDistribution(cohort([...ratios, 0, null], 0.087), 1)!;
    // Zero and missing shares are missing lines, not peers.
    expect(d.peers).toHaveLength(12);
    expect(d.median).toBeCloseTo(6.5, 6);
    expect(d.subject?.sharePct).toBeCloseTo(8.7, 6);
    expect(d.percentileRank).toBeCloseTo((8 / 12) * 100, 6);
    expect(d.subject?.assets).toBe(4_400_000_000);
  });

  it("says insufficient sample (null) below ten peers", () => {
    expect(buildCohortDistribution(cohort([0.01, 0.02, 0.03], 0.05), 1)).toBeNull();
  });

  it("never lists Frost Bank", () => {
    const peers = [
      { id: 2, name: "Frost Bank", city: null, state: "TX", assets: null, serviceCharges: null, revenue: null, sharePct: 4 },
      { id: 3, name: "Other Bank", city: null, state: "TX", assets: null, serviceCharges: null, revenue: null, sharePct: 5 },
    ];
    expect(listablePeers(peers).map((p) => p.name)).toEqual(["Other Bank"]);
  });

  it("writes ordinals", () => {
    expect([1, 2, 3, 11, 12, 13, 21, 86].map(ordinal)).toEqual(["1st", "2nd", "3rd", "11th", "12th", "13th", "21st", "86th"]);
  });
});

describe("what stands out", () => {
  it("states facts with what they do not establish, and no cause or price advice", () => {
    const ratios = Array.from({ length: 12 }, (_, i) => (i + 1) / 1000);
    const dist = buildCohortDistribution(cohort(ratios, 0.087), 1);
    const ledger = buildLedger([], [
      { report_date: "2025-06-30", item_key: "service_charges_deposits_ytd", item_code: "RIAD4080", item_description: null, value: 12_000, unit: "thousands", period_basis: "ytd", fetched_at: null },
      { report_date: "2025-03-31", item_key: "service_charges_deposits_ytd", item_code: "RIAD4080", item_description: null, value: 6_000, unit: "thousands", period_basis: "ytd", fetched_at: null },
      { report_date: "2026-03-31", item_key: "service_charges_deposits_ytd", item_code: "RIAD4080", item_description: null, value: 5_600, unit: "thousands", period_basis: "ytd", fetched_at: null },
      { report_date: "2026-06-30", item_key: "service_charges_deposits_ytd", item_code: "RIAD4080", item_description: null, value: 11_300, unit: "thousands", period_basis: "ytd", fetched_at: null },
    ]);
    const obs = buildObservations({
      ledger,
      cohort: dist,
      cohortName: "banks with $1B to $10B in assets",
      counts: { above: 16, below: 6, same: 2, compared: 24, level: "state" },
      stateName: "Florida",
      terms: feeIncomeTerms("fdic"),
    });
    expect(obs.map((o) => o.key)).toEqual(["share", "trend", "fees"]);
    expect(obs[0].fact).toContain("8.7% of revenue, above the 0.7% median of 12 banks with $1B to $10B in assets");
    expect(obs[1].fact).toBe("Service-charge income was $5.7M in Q2 2026, 5.0% below the same quarter a year earlier ($6.0M).");
    expect(obs[2].fact).toContain("16 of 24 compared published fees sit above the Florida median");
    for (const o of obs) {
      expect(o.notEstablished.length).toBeGreaterThan(0);
      expect(`${o.fact} ${o.notEstablished}`).not.toMatch(/because|caused|should|raise|lower your|recommend/i);
    }
  });
});
