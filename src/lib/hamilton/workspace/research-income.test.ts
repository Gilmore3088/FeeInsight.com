import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ trend: vi.fn() }));
vi.mock("@/lib/data-store/call-reports", () => ({ getRevenueTrend: mocks.trend, getPeerServiceChargeMedians: vi.fn() }));
import { loadNationalIncomeSeries } from "./research";

beforeEach(() => {
  mocks.trend.mockReset();
  mocks.trend.mockResolvedValue({ quarters: [{ quarter: "2026-Q2", total_service_charges: 100,
    bank_service_charges: 0, cu_service_charges: 100, total_institutions: 25, yoy_change_pct: 2 }] });
});
describe("Hamilton workspace income family", () => {
  it.each([["bank", "fdic", "deposit_service_charge_income"], ["credit_union", "ncua", "broad_credit_union_fee_income"]])("scopes %s income to %s and preserves period and counts", async (charter, source, measure) => {
    const rows = await loadNationalIncomeSeries(charter);
    expect(mocks.trend).toHaveBeenCalledWith(12, source);
    expect(rows[0]).toMatchObject({ total: 100000, institutions: 25, financialSource: source,
      measureDefinition: { source, measure, unit: "USD", period_basis: "standalone_quarter" } });
    expect(rows[0].sourceRef.label).not.toContain("FDIC call reports and NCUA");
  });
  it("fails closed for an unknown charter", async () => {
    expect(await loadNationalIncomeSeries("other")).toEqual([]);
    expect(mocks.trend).not.toHaveBeenCalled();
  });
});
