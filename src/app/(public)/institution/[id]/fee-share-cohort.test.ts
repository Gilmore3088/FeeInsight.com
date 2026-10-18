import { describe, expect, it } from "vitest";
import type { FeeShareCohort } from "@/lib/data-store/institution-quarterly";
import { buildCohortDistribution, cohortStripData, COHORT_BINS, listablePeers, ordinal, percentileCont, percentileRank, searchCohort } from "./fee-share-cohort";
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

describe("cohort strip payload", () => {
  // A credit-union-sized cohort: 3,000 filers, Frost Bank among them.
  const big: FeeShareCohort = {
    report_date: "2026-06-30",
    source: "ncua",
    charter_type: "credit_union",
    asset_size_tier: "community_small",
    filers: 3001,
    members: [
      { id: 1, name: "Subject Credit Union", city: "Tallahassee", state: "FL", total_assets: 200_000, service_charge_income: 900, total_revenue: 12_000, fee_income_ratio: 0.075 },
      { id: 777, name: "Frost Bank", city: "San Antonio", state: "TX", total_assets: 210_000, service_charge_income: 901, total_revenue: 12_000, fee_income_ratio: 0.0751 },
      ...Array.from({ length: 2999 }, (_, i) => ({
        id: i + 1000, name: `Community Credit Union Number ${i + 1000}`, city: "Springfield", state: "IL", total_assets: 100_000 + i * 50, service_charge_income: 400 + (i % 900), total_revenue: 10_000, fee_income_ratio: 0.01 + (i % 300) / 2000,
      })),
    ],
  };
  const dist = buildCohortDistribution(big, 1)!;

  it("ships bins, the quartiles and the 15 nearest by share, never the cohort", () => {
    const strip = cohortStripData(dist);
    expect(strip.counts).toHaveLength(COHORT_BINS);
    // Every listable peer is in a bin (Frost Bank left out); the quartiles still count it.
    expect(strip.counts.reduce((a, b) => a + b, 0)).toBe(2999);
    expect(dist.peers).toHaveLength(3000);
    expect(strip.listed).toBe(2999);
    expect(strip.nearest).toHaveLength(15);
    const gaps = strip.nearest.map((p) => Math.abs(p.sharePct - 7.5));
    expect(Math.max(...gaps)).toBeLessThan(0.5);
    expect(strip.median).toBe(dist.median);
  });

  it("keeps the serialized strip props under 12 KB for a 3,000-member cohort, with no trace of Frost Bank", () => {
    const props = { institutionId: 1, subjectName: "Subject Credit Union", data: cohortStripData(dist), quarter: "Q2 2026", sourceName: "NCUA", measureName: "Fee income", yearToDate: true };
    const json = JSON.stringify(props);
    expect(Buffer.byteLength(json, "utf8")).toBeLessThan(12 * 1024);
    // The old payload, every peer as a point, was hundreds of KB.
    expect(Buffer.byteLength(JSON.stringify(dist.peers), "utf8")).toBeGreaterThan(300_000);
    expect(json).not.toMatch(/frost/i);
    expect(json).not.toContain('"id":777');
  });

  it("answers a search from the listable members only", () => {
    expect(searchCohort(dist, "frost", 50)).toEqual({ total: 0, members: [] });
    const hit = searchCohort(dist, "number 1001", 50);
    expect(hit.members.map((p) => p.id)).toContain(1001);
    expect(searchCohort(dist, "", 5000).total).toBe(2999);
  });
});
