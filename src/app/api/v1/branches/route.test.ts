import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateApiKey } from "@/lib/api-auth";
import { checkRateLimitWithTier } from "@/lib/api-rate-limit";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { getBranchesForInstitution, getBranchesInArea } from "@/lib/data-store/branches";
import { GET } from "./route";

vi.mock("@/lib/api-auth", () => ({ validateApiKey: vi.fn() }));
vi.mock("@/lib/api-rate-limit", () => ({ checkRateLimitWithTier: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/access", () => ({ canAccessPremium: vi.fn() }));
vi.mock("@/lib/api-usage", () => ({ logApiUsage: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/data-store/branches", () => ({
  getBranchesForInstitution: vi.fn(() => Promise.resolve({ sod_year: 2026, total: 0, rows: [] })),
  getBranchesInArea: vi.fn(() => Promise.resolve({ sod_year: 2026, total: 0, rows: [] })),
}));

describe("/api/v1/branches", () => {
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

  it("keeps branches behind a paid key", async () => {
    vi.mocked(validateApiKey).mockResolvedValue({ valid: true, organizationId: 3, tier: "free" });

    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/branches?state=TX"));

    expect(response.status).toBe(403);
    expect(getBranchesInArea).not.toHaveBeenCalled();
  });

  it("lists one institution's branches, paged", async () => {
    vi.mocked(getBranchesForInstitution).mockResolvedValue({
      sod_year: 2026,
      total: 150,
      rows: [{ institution_id: 69, institution_name: "Texas Capital Bank", latitude: 30.26, longitude: -97.74 } as never],
    });

    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/branches?institution_id=69&limit=100&page=1"));
    const body = await response.json();

    expect(getBranchesForInstitution).toHaveBeenCalledWith(69, { limit: 100, offset: 0 });
    expect(body).toMatchObject({ sod_year: 2026, total: 150, pages: 2, has_more: true });
    expect(body.data[0].latitude).toBe(30.26);
  });

  it("finds branches in a city", async () => {
    await GET(new NextRequest("https://feeinsight.com/api/v1/branches?state=tx&city=Austin"));

    expect(getBranchesInArea).toHaveBeenCalledWith({ state: "TX", city: "Austin", zip: null }, { limit: 100, offset: 0 });
  });

  it("needs an institution or a state", async () => {
    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/branches?city=Austin"));

    expect(response.status).toBe(400);
  });

  it("rejects a bad ZIP code", async () => {
    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/branches?state=TX&zip=787"));

    expect(response.status).toBe(400);
  });
});
