import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateApiKey } from "@/lib/api-auth";
import { checkRateLimitWithTier } from "@/lib/api-rate-limit";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { getDistrictIncomeTrend, getRevenueTrend } from "@/lib/data-store/call-reports";
import { GET } from "./route";

vi.mock("@/lib/api-auth", () => ({ validateApiKey: vi.fn() }));
vi.mock("@/lib/api-rate-limit", () => ({ checkRateLimitWithTier: vi.fn() }));
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

  it("returns the national trend with rounded year-over-year change", async () => {
    vi.mocked(getRevenueTrend).mockResolvedValue({
      quarters: [
        {
          quarter: "2026-Q1",
          total_service_charges: 1000,
          total_institutions: 9000,
          bank_service_charges: 800,
          cu_service_charges: 200,
          yoy_change_pct: 3.14159,
        },
      ],
      latest: null,
    });

    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/revenue?quarters=20"));
    const body = await response.json();

    expect(getRevenueTrend).toHaveBeenCalledWith(20);
    expect(body.data[0]).toMatchObject({ quarter: "2026-Q1", credit_union_service_charges: 200, yoy_change_pct: 3.1 });
    expect(body.units).toContain("thousands");
  });

  it("returns districts when asked", async () => {
    vi.mocked(getDistrictIncomeTrend).mockResolvedValue([
      { quarter: "2026-Q1", fed_district: 11, total_service_charges: 50, institutions: 400 },
    ]);

    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/revenue?view=districts"));
    const body = await response.json();

    expect(body.data[0]).toMatchObject({ fed_district: 11, service_charges: 50 });
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
