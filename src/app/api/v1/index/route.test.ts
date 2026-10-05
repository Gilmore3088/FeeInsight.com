import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateApiKey } from "@/lib/api-auth";
import { checkRateLimitWithTier } from "@/lib/api-rate-limit";
import { getCurrentUser } from "@/lib/auth";
import { canExportData } from "@/lib/access";
import { getNationalIndex } from "@/lib/data-store";
import { GET } from "./route";

vi.mock("@/lib/api-auth", () => ({
  validateApiKey: vi.fn(),
  apiKeyCanExport: (auth: { valid: boolean; tier: string }) =>
    auth.valid && (auth.tier === "pro" || auth.tier === "enterprise"),
}));

vi.mock("@/lib/api-rate-limit", () => ({
  checkRateLimitWithTier: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@/lib/access", () => ({
  canExportData: vi.fn(),
}));

vi.mock("@/lib/api-usage", () => ({
  logApiUsage: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/data-store", () => ({
  getNationalIndex: vi.fn(() => Promise.resolve([])),
  getPeerIndex: vi.fn(() => Promise.resolve([])),
}));

describe("/api/v1/index", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateApiKey).mockResolvedValue({
      valid: false,
      organizationId: null,
      tier: "free",
    });
    vi.mocked(checkRateLimitWithTier).mockResolvedValue({
      allowed: true,
      remaining: 99,
      limit: 100,
      reset: new Date("2026-09-01T00:00:00.000Z"),
    });
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    vi.mocked(canExportData).mockReturnValue(false);
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

    await expect(response.json()).resolves.toEqual({ error: "Invalid API key" });
    expect(response.status).toBe(401);
    expect(checkRateLimitWithTier).not.toHaveBeenCalled();
  });

  it("requires a signed-in Seat License for CSV export", async () => {
    const response = await GET(
      new NextRequest("https://feeinsight.com/api/v1/index?format=csv"),
    );

    await expect(response.json()).resolves.toEqual({
      error: "CSV export requires a Seat License",
      upgrade_url: "/subscribe",
    });
    expect(response.status).toBe(403);
    expect(getNationalIndex).not.toHaveBeenCalled();
  });

  it("lets an enterprise API key download CSV without a login", async () => {
    vi.mocked(validateApiKey).mockResolvedValue({
      valid: true,
      organizationId: 7,
      tier: "enterprise",
    });
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    vi.mocked(canExportData).mockReturnValue(false);

    const response = await GET(
      new NextRequest("https://feeinsight.com/api/v1/index?format=csv"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
  });
});
