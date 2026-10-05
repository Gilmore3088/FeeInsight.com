import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateApiKey } from "@/lib/api-auth";
import { checkRateLimitWithTier } from "@/lib/api-rate-limit";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { getInstitutionById, getInstitutionsByFilter } from "@/lib/data-store";
import { GET } from "./route";

vi.mock("@/lib/api-auth", () => ({ validateApiKey: vi.fn() }));
vi.mock("@/lib/api-rate-limit", () => ({ checkRateLimitWithTier: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/access", () => ({ canAccessPremium: vi.fn() }));
vi.mock("@/lib/api-usage", () => ({ logApiUsage: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/data-store", () => ({
  getInstitutionById: vi.fn(),
  getFeesByInstitution: vi.fn(() => Promise.resolve([])),
  getInstitutionsByFilter: vi.fn(() => Promise.resolve({ rows: [], total: 0 })),
  getFinancialsByInstitution: vi.fn(() => Promise.resolve([])),
  getComplaintsByInstitution: vi.fn(() => Promise.resolve([])),
}));

describe("/api/v1/institutions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateApiKey).mockResolvedValue({ valid: true, organizationId: 3, tier: "free" });
    vi.mocked(checkRateLimitWithTier).mockResolvedValue({
      allowed: true,
      remaining: 99,
      limit: 100,
      reset: new Date("2026-11-01T00:00:00.000Z"),
    });
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    vi.mocked(canAccessPremium).mockReturnValue(false);
  });

  it("turns away callers with no key", async () => {
    vi.mocked(validateApiKey).mockResolvedValue({ valid: false, organizationId: null, tier: "free" });

    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/institutions?state=TX"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "api_key_required" });
    expect(getInstitutionsByFilter).not.toHaveBeenCalled();
  });

  it("keeps institution detail behind a paid key, as documented", async () => {
    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/institutions?id=12"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "plan_required" });
    expect(getInstitutionById).not.toHaveBeenCalled();
  });

  it("serves institution detail to an enterprise key", async () => {
    vi.mocked(validateApiKey).mockResolvedValue({ valid: true, organizationId: 7, tier: "enterprise" });
    vi.mocked(getInstitutionById).mockResolvedValue({
      id: "12",
      institution_name: "Example Bank",
      state_code: "TX",
      city: "Austin",
      charter_type: "bank",
      asset_size: "1000000",
      asset_size_tier: "community_small",
      fed_district: 11,
    } as never);

    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/institutions?id=12"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ id: 12, name: "Example Bank", asset_size: 1000000, fees: [], call_reports: [] });
  });

  it("rejects a zero page size instead of dividing by zero", async () => {
    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/institutions?limit=0"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "invalid_parameter" });
    expect(getInstitutionsByFilter).not.toHaveBeenCalled();
  });

  it("reports has_more on the list", async () => {
    vi.mocked(getInstitutionsByFilter).mockResolvedValue({ rows: [], total: 120 } as never);

    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/institutions?limit=50&page=2"));

    await expect(response.json()).resolves.toMatchObject({ pages: 3, page: 2, has_more: true });
  });
});
