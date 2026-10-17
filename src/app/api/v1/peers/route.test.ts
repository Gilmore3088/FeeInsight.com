import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateApiKey } from "@/lib/api-auth";
import { checkRateLimitWithTier } from "@/lib/api-rate-limit";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { getPeerComparison } from "@/lib/data-store/peer-comparison";
import { GET } from "./route";

vi.mock("@/lib/api-auth", () => ({ validateApiKey: vi.fn() }));
vi.mock("@/lib/api-rate-limit", () => ({
  checkRateLimitWithTier: vi.fn(),
  checkBurstLimitWithTier: vi.fn(() => Promise.resolve({ allowed: true, remaining: 59, limit: 60, reset: new Date("2026-10-17T12:01:00.000Z") })),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/access", () => ({ canAccessPremium: vi.fn() }));
vi.mock("@/lib/api-usage", () => ({ logApiUsage: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/data-store/peer-comparison", () => ({ MAX_CHOSEN_PEERS: 25, getPeerComparison: vi.fn() }));

const COMPARISON = {
  institution: { id: 12, name: "Example Bank", state: "TX", charter_type: "bank", asset_tier: "community_mid", fed_district: 11 },
  peer_group: {
    basis: "default" as const,
    label: "Banks with $300M to $1B in assets in Fed district 11 (Dallas)",
    charter_type: "bank",
    asset_tier: "community_mid",
    fed_district: 11,
    peer_ids: null,
    peers_with_fees: 6,
  },
  min_peers: 5,
  categories: [{
    category: "overdraft", display_name: "Overdraft (OD)", family: "Overdraft & NSF", amount: 30,
    peer_count: 6, peer_median: 30, peer_p25: 27.5, peer_p75: 32.5,
    peers_lower: 2, peers_same: 1, peers_higher: 3, percentile: 42, maturity_tier: "provisional" as const,
  }],
  rate_fees: [],
};

describe("/api/v1/peers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateApiKey).mockResolvedValue({ valid: true, organizationId: 7, tier: "enterprise" });
    vi.mocked(checkRateLimitWithTier).mockResolvedValue({ allowed: true, remaining: Infinity, limit: Infinity, reset: new Date("2026-11-01T00:00:00.000Z") });
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    vi.mocked(canAccessPremium).mockReturnValue(false);
    vi.mocked(getPeerComparison).mockResolvedValue(COMPARISON);
  });

  it("keeps the comparison behind a paid key", async () => {
    vi.mocked(validateApiKey).mockResolvedValue({ valid: true, organizationId: 3, tier: "free" });
    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/peers?institution_id=12"));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "plan_required" });
    expect(getPeerComparison).not.toHaveBeenCalled();
  });

  it("compares against the default peers", async () => {
    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/peers?institution_id=12"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(getPeerComparison).toHaveBeenCalledWith(12, null);
    expect(body.categories[0]).toMatchObject({ category: "overdraft", peer_median: 30, percentile: 42 });
    expect(body.note).toContain("percentile is the share of peers whose amount is lower");
    expect(body.attribution).toBeDefined();
  });

  it("passes chosen peers through, deduplicated", async () => {
    await GET(new NextRequest("https://feeinsight.com/api/v1/peers?institution_id=12&peer_ids=4,5,4,9"));
    expect(getPeerComparison).toHaveBeenCalledWith(12, [4, 5, 9]);
  });

  it.each([
    ["no institution", ""],
    ["a bad institution id", "institution_id=abc"],
    ["a bad peer list", "institution_id=12&peer_ids=4,x"],
    ["a zero peer id", "institution_id=12&peer_ids=0"],
    ["more than 25 peers", `institution_id=12&peer_ids=${Array.from({ length: 26 }, (_, i) => i + 100).join(",")}`],
    ["only itself as a peer", "institution_id=12&peer_ids=12"],
  ])("rejects %s with invalid_parameter", async (_label, query) => {
    const response = await GET(new NextRequest(`https://feeinsight.com/api/v1/peers?${query}`));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "invalid_parameter" });
    expect(getPeerComparison).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown institution", async () => {
    vi.mocked(getPeerComparison).mockResolvedValue(null);
    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/peers?institution_id=999"));
    expect(response.status).toBe(404);
  });
});
