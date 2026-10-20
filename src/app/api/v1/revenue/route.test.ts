import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateApiKey } from "@/lib/api-auth";
import { checkRateLimitWithTier } from "@/lib/api-rate-limit";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { getDistrictIncomeTrend, getRevenueTrend } from "@/lib/data-store/call-reports";
import { GET } from "./route";

vi.mock("@/lib/api-auth", () => ({ validateApiKey: vi.fn() }));
vi.mock("@/lib/api-rate-limit", () => ({
  checkRateLimitWithTier: vi.fn(),
  checkBurstLimitWithTier: vi.fn(() => Promise.resolve({ allowed: true, remaining: 59, limit: 60, reset: new Date("2026-10-17T12:01:00.000Z") })),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/access", () => ({ canAccessPremium: vi.fn() }));
vi.mock("@/lib/api-usage", () => ({ logApiUsage: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/data-store/call-reports", () => ({
  getRevenueTrend: vi.fn(),
  getDistrictIncomeTrend: vi.fn(),
}));

describe("/api/v1/revenue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateApiKey).mockResolvedValue({ valid: true, organizationId: 7, tier: "enterprise" });
    vi.mocked(checkRateLimitWithTier).mockResolvedValue({
      allowed: true,
      remaining: Infinity,
      limit: Infinity,
      reset: new Date("2026-11-01T00:00:00.000Z"),
    });
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    vi.mocked(canAccessPremium).mockReturnValue(false);
  });

  it("turns away callers with no key", async () => {
    vi.mocked(validateApiKey).mockResolvedValue({ valid: false, organizationId: null, tier: "free" });

    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/revenue"));

    expect(response.status).toBe(401);
    expect(getRevenueTrend).not.toHaveBeenCalled();
  });

  it("keeps revenue behind a paid key", async () => {
    vi.mocked(validateApiKey).mockResolvedValue({ valid: true, organizationId: 3, tier: "free" });

    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/revenue"));

    expect(response.status).toBe(403);
  });

  function snapshot(quarter: string, serviceCharges: number, institutions: number) {
    return {
      quarter,
      total_service_charges: serviceCharges,
      total_institutions: institutions,
      bank_service_charges: 0,
      cu_service_charges: 0,
      yoy_change_pct: null,
    };
  }

  it("returns each regulator's national income as its own measure, never a pooled total", async () => {
    vi.mocked(getRevenueTrend).mockImplementation(async (_quarters, source) => source === "fdic"
      ? { quarters: [snapshot("2026-Q1", 800, 4000)], latest: null }
      : { quarters: [snapshot("2026-Q1", 200, 5000)], latest: null });

    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/revenue?quarters=20"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getRevenueTrend).toHaveBeenCalledWith(20, "fdic");
    expect(getRevenueTrend).toHaveBeenCalledWith(20, "ncua");
    expect(getRevenueTrend).not.toHaveBeenCalledWith(20);
    expect(body.data).toEqual([
      expect.objectContaining({ source: "fdic", charter_type: "bank", measure: "deposit_service_charge_income",
        quarter: "2026-Q1", quarter_end: "2026-03-31", service_charges: 800, institutions: 4000, yoy_change_pct: null }),
      expect.objectContaining({ source: "ncua", charter_type: "credit_union", measure: "broad_credit_union_fee_income",
        quarter: "2026-Q1", quarter_end: "2026-03-31", service_charges: 200, institutions: 5000, yoy_change_pct: null }),
    ]);
    for (const row of body.data) {
      expect(row).not.toHaveProperty("bank_service_charges");
      expect(row).not.toHaveProperty("credit_union_service_charges");
    }
    expect(body.financial_groups.map((g: { source: string }) => g.source)).toEqual(["fdic", "ncua"]);
    expect(body.financial_groups[1]).toMatchObject({
      source: "ncua", unit: "thousands of dollars", period_basis: "standalone_quarter",
      source_period_basis: "year_to_date", status: "reported", latest_quarter: "2026-Q1", quarters_returned: 1,
    });
    expect(body.units).toContain("thousands");
    expect(body.units).not.toMatch(/summed|combined/i);
  });

  it("dates each regulator by its own newest quarter when one lags", async () => {
    vi.mocked(getRevenueTrend).mockImplementation(async (_quarters, source) => source === "fdic"
      ? { quarters: [snapshot("2026-Q2", 810, 4000), snapshot("2026-Q1", 800, 4000)], latest: null }
      : { quarters: [snapshot("2026-Q1", 200, 5000)], latest: null });

    const body = await (await GET(new NextRequest("https://feeinsight.com/api/v1/revenue"))).json();

    expect(body.financial_groups).toEqual([
      expect.objectContaining({ source: "fdic", latest_quarter: "2026-Q2", latest_quarter_end: "2026-06-30" }),
      expect.objectContaining({ source: "ncua", latest_quarter: "2026-Q1", latest_quarter_end: "2026-03-31" }),
    ]);
  });

  it("marks a regulator with no figures unavailable instead of dropping or zeroing it", async () => {
    vi.mocked(getRevenueTrend).mockImplementation(async (_quarters, source) => source === "fdic"
      ? { quarters: [snapshot("2026-Q1", 800, 4000)], latest: null }
      : { quarters: [], latest: null });

    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/revenue"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.every((row: { source: string }) => row.source === "fdic")).toBe(true);
    expect(body.financial_groups[1]).toMatchObject({ source: "ncua", status: "unavailable", latest_quarter: null, quarters_returned: 0 });
  });

  it("reads one regulator when source is given", async () => {
    vi.mocked(getDistrictIncomeTrend).mockResolvedValue([
      { quarter: "2026-Q1", fed_district: 11, total_service_charges: 50, institutions: 400 },
    ]);

    const body = await (await GET(new NextRequest("https://feeinsight.com/api/v1/revenue?view=districts&source=ncua"))).json();

    expect(getDistrictIncomeTrend).toHaveBeenCalledTimes(1);
    expect(getDistrictIncomeTrend).toHaveBeenCalledWith(8, "ncua");
    expect(body.financial_groups.map((g: { source: string }) => g.source)).toEqual(["ncua"]);
    expect(body.data[0]).toMatchObject({ source: "ncua", fed_district: 11, service_charges: 50, institutions: 400 });
  });

  it("returns districts per regulator when asked", async () => {
    vi.mocked(getDistrictIncomeTrend).mockImplementation(async (_quarters, source) => [
      { quarter: "2026-Q1", fed_district: 11, total_service_charges: source === "fdic" ? 50 : 7, institutions: source === "fdic" ? 400 : 90 },
    ]);

    const body = await (await GET(new NextRequest("https://feeinsight.com/api/v1/revenue?view=districts"))).json();

    expect(getDistrictIncomeTrend).toHaveBeenCalledWith(8, "fdic");
    expect(getDistrictIncomeTrend).toHaveBeenCalledWith(8, "ncua");
    expect(body.data).toEqual([
      expect.objectContaining({ source: "fdic", fed_district: 11, quarter_end: "2026-03-31", service_charges: 50, institutions: 400 }),
      expect.objectContaining({ source: "ncua", fed_district: 11, quarter_end: "2026-03-31", service_charges: 7, institutions: 90 }),
    ]);
  });

  it("rejects an unknown source", async () => {
    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/revenue?source=ffiec"));

    expect(response.status).toBe(400);
    expect(getRevenueTrend).not.toHaveBeenCalled();
  });

  it("says so when the data can't be read, instead of an empty list", async () => {
    vi.mocked(getRevenueTrend).mockResolvedValue({ quarters: [], latest: null });

    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/revenue"));

    expect(response.status).toBe(503);
  });

  it("rejects too many quarters", async () => {
    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/revenue?quarters=500"));

    expect(response.status).toBe(400);
  });
});
