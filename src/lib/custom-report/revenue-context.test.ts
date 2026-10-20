import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/call-reports", () => ({ getInstitutionPeerRanking: vi.fn(), getInstitutionRevenueTrend: vi.fn() }));
vi.mock("@/lib/data-store/public-read-cache", () => ({ cachedPublicRead: (_key: string, fn: unknown) => fn }));

import { financialPeerComparison } from "@/lib/data-store/financial-peer-contract";
import { buildRevenueContext, incomeLabel, quarterLabel } from "./revenue-context";

const comparison = (source: "fdic" | "ncua", count = 900) => financialPeerComparison({ source, reportDate: "2026-06-30", tier: "community", minimumAssetsUsd: 100000000, maximumAssetsUsd: 1000000000, subjectIncluded: true, eligibleCount: count, reportedCount: count, ratioReportedCount: count, minimumMedianCount: 5 });
const quarter = (q: string, amount: number) => ({ quarter: q, service_charge_income: amount });

describe("buildRevenueContext", () => {
  it("sums four reported quarters and keeps the size-peer median", () => {
    const context = buildRevenueContext(
      [quarter("2026-Q2", 300), quarter("2026-Q1", 280), quarter("2025-Q4", 310), quarter("2025-Q3", 290)],
      { tier: "community", sc_rank: 40, peer_count: 900, peer_median_sc: 250, comparison: comparison("fdic") },
    );
    expect(context?.trailingThousands).toBe(1180);
    expect(context?.peer).toMatchObject({ tierLabel: "$100M-$1B", charterLabel: "banks", medianThousands: 250, rank: 40, count: 900, comparison: comparison("fdic") });
  });

  it("leaves out the four-quarter total when a quarter is missing, and the peer line without a median", () => {
    const context = buildRevenueContext([quarter("2026-Q2", 300), quarter("2026-Q1", 280)], {
      tier: "community",
      sc_rank: 3,
      peer_count: 4,
      peer_median_sc: null,
      comparison: comparison("fdic", 4),
    });
    expect(context?.trailingThousands).toBeNull();
    expect(context?.peer).toBeNull();
  });

  it("preserves the CU comparison and withholds unlineaged or conflicting peer medians", () => {
    const ranking = { tier: "community", sc_rank: 2, peer_count: 25, peer_median_sc: 125, comparison: comparison("ncua", 25) };
    const cu = buildRevenueContext([quarter("2026-Q2", 300)], ranking);
    expect(cu).toMatchObject({ source: "ncua", measureLabel: "Broad credit-union fee income", peer: { charterLabel: "credit unions", comparison: ranking.comparison } });
    expect(buildRevenueContext([quarter("2026-Q2", 300)], { ...ranking, comparison: undefined }, "ncua")?.peer).toBeNull();
    expect(buildRevenueContext([quarter("2026-Q2", 300)], ranking, "fdic")?.peer).toBeNull();
    expect(buildRevenueContext([quarter("2026-Q1", 300)], ranking, "ncua")?.peer).toBeNull();
  });

  it("is null when nothing is reported, as for a credit union with no NCUA fee income", () => {
    expect(buildRevenueContext([], null)).toBeNull();
    expect(buildRevenueContext([quarter("2026-Q2", 0)], null)).toBeNull();
  });
});

describe("labels", () => {
  it("formats quarters and income in thousands", () => {
    expect(quarterLabel("2026-Q2")).toBe("Q2 2026");
    expect(incomeLabel(1180)).toBe("$1.2 million");
    expect(incomeLabel(840)).toBe("$840,000");
  });
});
