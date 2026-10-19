import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ trend: vi.fn(), medians: vi.fn() }));
vi.mock("@/lib/data-store/call-reports", () => ({ getRevenueTrend: mocks.trend, getPeerServiceChargeMedians: mocks.medians }));
import { buildCallCohortHistory } from "@/lib/data-catalog/call-cohort-history";
import { overdraftResearch } from "./test-fixtures";
import { loadNationalIncomeSeries, withPeerMedian } from "./research";

beforeEach(() => {
  mocks.trend.mockReset();
  mocks.medians.mockReset();
  mocks.trend.mockResolvedValue({ quarters: [{ quarter: "2026-Q2", total_service_charges: 100,
    bank_service_charges: 0, cu_service_charges: 100, total_institutions: 25, yoy_change_pct: 2 }] });
});
describe("Hamilton workspace income family", () => {
  it.each([["bank", "fdic", "deposit_service_charge_income"], ["credit_union", "ncua", "broad_credit_union_fee_income"]])("scopes %s income to %s and preserves period and counts", async (charter, source, measure) => {
    const { quarters: rows } = await loadNationalIncomeSeries(charter);
    expect(mocks.trend).toHaveBeenCalledWith(12, source);
    expect(rows[0]).toMatchObject({ total: 100000, institutions: 25, financialSource: source,
      measureDefinition: { source, measure, unit: "USD", period_basis: "standalone_quarter" } });
    expect(rows[0].yoyPct).toBeNull();
    expect(rows[0].sourceRef.label).not.toContain("FDIC call reports and NCUA");
  });
  it("preserves the one shared history manifest beside the national series", async () => {
    const cohortHistory = buildCallCohortHistory({ requestedIds: null, periods: [{ period: "2026-06-30", sources: ["ncua"], unit: "thousands of dollars", period_basis: "standalone_quarter", institution_count: 1, reporting_institution_ids: [23] }] });
    mocks.trend.mockResolvedValue({ quarters: [], cohort_history: cohortHistory });
    const result = await loadNationalIncomeSeries("credit_union");
    expect(result.cohortHistory).toBe(cohortHistory);
    expect(result.cohortHistory?.growth_status).toBe("not_established");
  });
  it("keeps a thin latest period in the manifest without moving an older median to that date", async () => {
    const cohortHistory = buildCallCohortHistory({ requestedIds: null, subjectId: 1, periods: [
      { period: "2026-06-30", sources: ["ncua"], unit: "thousands of dollars", period_basis: "standalone_quarter", institution_count: 4, reporting_institution_ids: [1, 2, 3, 4] },
      { period: "2026-03-31", sources: ["ncua"], unit: "thousands of dollars", period_basis: "standalone_quarter", institution_count: 5, reporting_institution_ids: [1, 2, 3, 4, 5] },
    ] });
    mocks.medians.mockResolvedValue({ quarters: [{ quarter_end: "2026-06-30", median_thousands: null, institutions: 4 },
      { quarter_end: "2026-03-31", median_thousands: 9, institutions: 5 }], cohort_history: cohortHistory });
    const result = await withPeerMedian({ institutionId: 1, charterType: "credit_union", assetTier: "regional",
      layers: [{ scope: "charter_size", label: "Regional credit unions", values: new Map() }] }, overdraftResearch().institutionFinancials);
    expect(mocks.medians).toHaveBeenCalledWith("credit_union", "regional", 8, 1);
    expect(result?.peerMedian).toMatchObject({ cohortHistory, sourceRef: { asOf: "2026-03-31" },
      quarters: [{ quarterEnd: "2026-03-31", amount: 9000, institutions: 5 }] });
    expect(result?.peerMedian?.cohortHistory?.periods[0]).toMatchObject({ period: "2026-06-30", reported_count: 4 });
  });
  it("fails closed for an unknown charter", async () => {
    expect(await loadNationalIncomeSeries("other")).toEqual({ quarters: [] });
    expect(mocks.trend).not.toHaveBeenCalled();
  });
});
