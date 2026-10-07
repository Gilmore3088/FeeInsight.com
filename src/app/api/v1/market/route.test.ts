import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateApiKey } from "@/lib/api-auth";
import { checkRateLimitWithTier } from "@/lib/api-rate-limit";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { getLocalMarketMembers } from "@/lib/data-store/custom-report-market";
import { GET } from "./route";

vi.mock("@/lib/api-auth", () => ({ validateApiKey: vi.fn() }));
vi.mock("@/lib/api-rate-limit", () => ({ checkRateLimitWithTier: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/access", () => ({ canAccessPremium: vi.fn() }));
vi.mock("@/lib/api-usage", () => ({ logApiUsage: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/data-store/custom-report-market", () => ({ getLocalMarketMembers: vi.fn() }));

describe("/api/v1/market", () => {
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

  it("keeps the market behind a paid key", async () => {
    vi.mocked(validateApiKey).mockResolvedValue({ valid: true, organizationId: 3, tier: "free" });

    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/market?institution_id=69"));

    expect(response.status).toBe(403);
  });

  it("returns competitors with deposit share, null for credit unions", async () => {
    vi.mocked(getLocalMarketMembers).mockResolvedValue({
      basis: "branch_counties",
      places: ["Austin, TX"],
      sod_year: 2026,
      members: [
        { institution_id: 69, institution_name: "A", city: "Austin", state_code: "TX", charter_type: "bank", market_deposits: 750, is_subject: true },
        { institution_id: 1, institution_name: "B", city: "Austin", state_code: "TX", charter_type: "bank", market_deposits: 250, is_subject: false },
        { institution_id: 9, institution_name: "C", city: "Austin", state_code: "TX", charter_type: "credit_union", market_deposits: null, is_subject: false },
      ],
    });

    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/market?institution_id=69"));
    const body = await response.json();

    expect(body.competitor_count).toBe(2);
    expect(body.data.map((d: { deposit_share_pct: number | null }) => d.deposit_share_pct)).toEqual([75, 25, null]);
  });

  it("says when no market is on file", async () => {
    vi.mocked(getLocalMarketMembers).mockResolvedValue(null);

    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/market?institution_id=5"));

    expect(response.status).toBe(404);
  });

  it("requires institution_id", async () => {
    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/market"));

    expect(response.status).toBe(400);
  });
});
