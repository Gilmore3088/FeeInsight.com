import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateApiKey } from "@/lib/api-auth";
import { checkRateLimitWithTier } from "@/lib/api-rate-limit";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { getRecentPriceChanges } from "@/lib/data-store";
import { GET } from "./route";

vi.mock("@/lib/api-auth", () => ({ validateApiKey: vi.fn() }));
vi.mock("@/lib/api-rate-limit", () => ({ checkRateLimitWithTier: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/access", () => ({ canAccessPremium: vi.fn() }));
vi.mock("@/lib/api-usage", () => ({ logApiUsage: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/data-store", () => ({ getRecentPriceChanges: vi.fn(() => Promise.resolve([])) }));

describe("/api/v1/fee-changes", () => {
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

  it("keeps fee changes behind a paid key", async () => {
    vi.mocked(validateApiKey).mockResolvedValue({ valid: true, organizationId: 3, tier: "free" });

    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/fee-changes"));

    expect(response.status).toBe(403);
    expect(getRecentPriceChanges).not.toHaveBeenCalled();
  });

  it("returns detected changes with real numbers", async () => {
    vi.mocked(getRecentPriceChanges).mockResolvedValue([
      {
        id: 1,
        institution_id: "12" as never,
        institution_name: "Example Bank",
        fee_category: "overdraft",
        previous_amount: "30.00" as never,
        new_amount: "35.00" as never,
        change_type: "increased",
        detected_at: "2026-10-01T00:00:00Z",
      },
    ]);

    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/fee-changes?days=30&category=overdraft"));
    const body = await response.json();

    expect(getRecentPriceChanges).toHaveBeenCalledWith(30, "overdraft");
    expect(body.count).toBe(1);
    expect(body.data[0]).toMatchObject({ institution_id: 12, previous_amount: 30, new_amount: 35, change: "increased" });
  });

  it("rejects an unknown category", async () => {
    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/fee-changes?category=nope"));

    expect(response.status).toBe(400);
  });
});
