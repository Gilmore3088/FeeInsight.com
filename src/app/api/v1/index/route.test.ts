import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateApiKey } from "@/lib/api-auth";
import { checkRateLimitWithTier } from "@/lib/api-rate-limit";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium, canExportData } from "@/lib/access";
import { getNationalIndex, getPeerIndex } from "@/lib/data-store";
import { getSpotlightCategories } from "@/lib/fee-taxonomy";
import { GET } from "./route";

vi.mock("@/lib/api-auth", () => ({
  validateApiKey: vi.fn(),
}));

vi.mock("@/lib/api-rate-limit", () => ({
  checkRateLimitWithTier: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@/lib/access", () => ({
  canExportData: vi.fn(),
  canAccessPremium: vi.fn(),
}));

vi.mock("@/lib/api-usage", () => ({
  logApiUsage: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/data-store", () => ({
  getNationalIndex: vi.fn(() => Promise.resolve([])),
  getPeerIndex: vi.fn(() => Promise.resolve([])),
}));

function indexEntry(category: string) {
  return {
    fee_category: category,
    median_amount: 10,
    p25_amount: 5,
    p75_amount: 15,
    min_amount: 1,
    max_amount: 30,
    institution_count: 40,
    bank_count: 25,
    cu_count: 15,
    maturity_tier: "strong",
  };
}

const enterpriseKey = { valid: true, organizationId: 7, tier: "enterprise" };
const freeKey = { valid: true, organizationId: 3, tier: "free" };

describe("/api/v1/index", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateApiKey).mockResolvedValue(freeKey);
    vi.mocked(checkRateLimitWithTier).mockResolvedValue({
      allowed: true,
      remaining: 99,
      limit: 100,
      reset: new Date("2026-09-01T00:00:00.000Z"),
    });
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    vi.mocked(canExportData).mockReturnValue(false);
    vi.mocked(canAccessPremium).mockReturnValue(false);
  });

  it("rejects invalid API keys before rate limiting or data reads", async () => {
    vi.mocked(validateApiKey).mockResolvedValue({
      valid: false,
      organizationId: null,
      tier: "free",
      error: "Invalid API key",
    });

    const response = await GET(
      new NextRequest("https://feeinsight.com/api/v1/index", {
        headers: { authorization: "Bearer bfi_invalid" },
      }),
    );

    await expect(response.json()).resolves.toEqual({ error: "Invalid API key", code: "invalid_api_key" });
    expect(response.status).toBe(401);
    expect(checkRateLimitWithTier).not.toHaveBeenCalled();
  });

  it("turns away callers with no key and no signed-in session", async () => {
    vi.mocked(validateApiKey).mockResolvedValue({ valid: false, organizationId: null, tier: "free" });

    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/index"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "api_key_required" });
    expect(checkRateLimitWithTier).not.toHaveBeenCalled();
    expect(getNationalIndex).not.toHaveBeenCalled();
  });

  it("still serves the site's own signed-in download buttons without a key", async () => {
    vi.mocked(validateApiKey).mockResolvedValue({ valid: false, organizationId: null, tier: "free" });
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 1 } as never);
    vi.mocked(canExportData).mockReturnValue(true);

    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/index?format=csv"));

    expect(response.status).toBe(200);
  });

  it("requires a paid key or Seat License for CSV export", async () => {
    const response = await GET(
      new NextRequest("https://feeinsight.com/api/v1/index?format=csv"),
    );

    await expect(response.json()).resolves.toEqual({
      error: "CSV export requires a Pro or Enterprise API key",
      code: "plan_required",
      upgrade_url: "/subscribe",
    });
    expect(response.status).toBe(403);
    expect(getNationalIndex).not.toHaveBeenCalled();
  });

  it("lets an enterprise API key download CSV without a login", async () => {
    vi.mocked(validateApiKey).mockResolvedValue(enterpriseKey);

    const response = await GET(
      new NextRequest("https://feeinsight.com/api/v1/index?format=csv"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
  });

  it("rejects a malformed state instead of silently returning every state", async () => {
    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/index?state=Texas"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "invalid_parameter" });
    expect(getPeerIndex).not.toHaveBeenCalled();
    expect(getNationalIndex).not.toHaveBeenCalled();
  });

  it("gives a free-tier key the spotlight categories only", async () => {
    const [spotlight] = getSpotlightCategories();
    vi.mocked(getNationalIndex).mockResolvedValue([
      indexEntry(spotlight),
      indexEntry("not_a_spotlight_category"),
    ] as never);

    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/index"));
    const body = await response.json();

    expect(body.data.map((d: { category: string }) => d.category)).toEqual([spotlight]);
  });

  it("gives an enterprise key every category and no Infinity in its headers", async () => {
    vi.mocked(validateApiKey).mockResolvedValue(enterpriseKey);
    vi.mocked(checkRateLimitWithTier).mockResolvedValue({
      allowed: true,
      remaining: Infinity,
      limit: Infinity,
      reset: new Date("2026-11-01T00:00:00.000Z"),
    });
    vi.mocked(getNationalIndex).mockResolvedValue([
      indexEntry(getSpotlightCategories()[0]),
      indexEntry("not_a_spotlight_category"),
    ] as never);

    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/index"));
    const body = await response.json();

    expect(body.total).toBe(2);
    expect(response.headers.get("x-ratelimit-limit")).toBeNull();
    expect(response.headers.get("x-ratelimit-reset")).toBe("2026-11-01T00:00:00.000Z");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("answers 503, not 429, when usage tracking is down", async () => {
    vi.mocked(checkRateLimitWithTier).mockResolvedValue({
      allowed: false,
      remaining: 0,
      limit: 100,
      reset: new Date("2026-11-01T00:00:00.000Z"),
      unavailable: true,
    });

    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/index"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "rate_limit_unavailable" });
  });
});
