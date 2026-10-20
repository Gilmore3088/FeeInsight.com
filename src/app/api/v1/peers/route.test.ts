import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateApiKey } from "@/lib/api-auth";
import { checkRateLimitWithTier } from "@/lib/api-rate-limit";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { getPeerComparison } from "@/lib/data-store/peer-comparison";
import { PeerSetError } from "@/lib/data-store/peer-sets";
import { GET } from "./route";
import { getV1HamiltonInstitution, getV1SavedPeerSet, V1ContextError } from "@/lib/api-v1-hamilton-context";
vi.mock("@/lib/api-v1-hamilton-context", async (original) => ({ ...await original<typeof import("@/lib/api-v1-hamilton-context")>(), getV1HamiltonInstitution: vi.fn(), getV1SavedPeerSet: vi.fn() }));

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
    label: "Banks with $300M to $1B in assets in the Dallas Fed district",
    definition: { charter_type: "bank", asset_tiers: ["community_mid"], fed_districts: [11] },
    market: null,
    peer_ids: null,
    peers_with_fees: 6,
  },
  min_peers: 5,
  categories: [{
    category: "overdraft", display_name: "Overdraft (OD)", family: "Overdraft & NSF", amount: 30,
    amount_low: 30, amount_high: 30, fees: [{ name: "Overdraft fee", amount: 30 }],
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
    expect(getPeerComparison).toHaveBeenCalledWith(12, null, null);
    expect(body.categories[0]).toMatchObject({ category: "overdraft", peer_median: 30, percentile: 42 });
    expect(body.note).toContain("percentile is the share of peers whose amount is lower");
    expect(body.attribution).toBeDefined();
  });

  it("passes chosen peers through, deduplicated", async () => {
    await GET(new NextRequest("https://feeinsight.com/api/v1/peers?institution_id=12&peer_ids=4,5,4,9"));
    expect(getPeerComparison).toHaveBeenCalledWith(12, [4, 5, 9], null);
  });

  it("passes peer-group parameters through, with same kept for the institution's own value", async () => {
    await GET(new NextRequest("https://feeinsight.com/api/v1/peers?institution_id=12&charter=same&market=same&asset_min=500000000&asset_max=2000000000&state=tx,ok&regulator=OCC,fed&nearest=20"));
    expect(getPeerComparison).toHaveBeenCalledWith(12, null, {
      charter_type: "same", market: "same", asset_min: 500_000_000, asset_max: 2_000_000_000,
      states: ["TX", "OK"], regulators: ["occ", "fed"], nearest: 20,
    });
  });

  it("answers a definition the institution cannot meet with invalid_parameter", async () => {
    vi.mocked(getPeerComparison).mockRejectedValue(new PeerSetError("This institution has no holding company on record"));
    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/peers?institution_id=12&holding_company=same"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "invalid_parameter", error: expect.stringContaining("holding company") });
  });

  it.each([
    ["no institution", ""],
    ["peer_ids with a peer-group parameter", "institution_id=12&peer_ids=4&charter=bank"],
    ["a bad charter", "institution_id=12&charter=thrift"],
    ["a bad regulator", "institution_id=12&regulator=sec"],
    ["dollars that are not whole", "institution_id=12&asset_min=5e8"],
    ["a minimum above the maximum", "institution_id=12&asset_min=20&asset_max=10"],
    ["too many nearest", "institution_id=12&nearest=500"],
    ["a bad market", "institution_id=12&market=dallas"],
    ["a bad state", "institution_id=12&state=Texas"],
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

describe("Hamilton saved peer context over the API", () => {
  const saved = { id: 50, name: "Board peers", institution_id: null, is_default: true, created_by: "12", created_at: "2026-10-19", tiers: null, districts: null, charter_type: null, states: null, institution_ids: [4, 5, 9] };
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateApiKey).mockResolvedValue({ valid: true, organizationId: 7, tier: "pro", subscriberUserId: 12 });
    vi.mocked(checkRateLimitWithTier).mockResolvedValue({ allowed: true, remaining: 9, limit: 10, reset: new Date("2026-11-01") });
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    vi.mocked(getPeerComparison).mockResolvedValue(COMPARISON);
    vi.mocked(getV1HamiltonInstitution).mockResolvedValue({ institution: { id: 12, name: "Example Bank" }, source: "manual" });
    vi.mocked(getV1SavedPeerSet).mockResolvedValue(saved);
  });
  it("uses the holder's saved institution and exact active group with no arguments", async () => {
    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/peers", { headers: { "if-none-match": "*" } }));
    expect(response.status).toBe(200);
    expect(getV1HamiltonInstitution).toHaveBeenCalledWith(12);
    expect(getV1SavedPeerSet).toHaveBeenCalledWith(12, 12);
    expect(getPeerComparison).toHaveBeenCalledWith(12, [4, 5, 9], null);
    expect(await response.json()).toMatchObject({ peer_group: { label: "Board peers" }, context: { institution_source: "saved", peer_source: "saved", saved_peer_set_id: 50 } });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.has("etag")).toBe(false);
  });
  it("rejects self-only explicit peers after resolving the saved institution", async () => {
    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/peers?peer_ids=12"));
    expect(response.status).toBe(400); expect(getPeerComparison).not.toHaveBeenCalled();
  });
  it("keeps all 50 saved chosen peers", async () => {
    const ids = Array.from({ length: 50 }, (_, i) => i + 100);
    vi.mocked(getV1SavedPeerSet).mockResolvedValue({ ...saved, institution_ids: ids });
    await GET(new NextRequest("https://feeinsight.com/api/v1/peers?institution_id=12&saved_peer_set_id=50"));
    expect(getV1SavedPeerSet).toHaveBeenCalledWith(12, 12, 50);
    expect(getPeerComparison).toHaveBeenCalledWith(12, ids, null);
  });
  it("uses saved filter groups without expanding their membership", async () => {
    vi.mocked(getV1SavedPeerSet).mockResolvedValue({ ...saved, institution_ids: null, charter_type: "bank", states: ["TX"], tiers: "community_mid" });
    await GET(new NextRequest("https://feeinsight.com/api/v1/peers?institution_id=12"));
    expect(getPeerComparison).toHaveBeenCalledWith(12, null, { charter_type: "bank", states: ["TX"], asset_tiers: ["community_mid"] });
  });
  it("explicit institution and peer choices override saved defaults", async () => {
    await GET(new NextRequest("https://feeinsight.com/api/v1/peers?institution_id=20&peer_ids=4,5"));
    expect(getV1HamiltonInstitution).not.toHaveBeenCalled(); expect(getV1SavedPeerSet).not.toHaveBeenCalled();
    expect(getPeerComparison).toHaveBeenCalledWith(20, [4, 5], null);
  });
  it("can opt out of automatic context", async () => {
    await GET(new NextRequest("https://feeinsight.com/api/v1/peers?institution_id=20&use_saved_context=false"));
    expect(getV1HamiltonInstitution).not.toHaveBeenCalled(); expect(getV1SavedPeerSet).not.toHaveBeenCalled();
    expect(getPeerComparison).toHaveBeenCalledWith(20, null, null);
  });
  it("still authorizes an explicit saved selection when automatic context is off", async () => {
    await GET(new NextRequest("https://feeinsight.com/api/v1/peers?institution_id=20&use_saved_context=false&saved_peer_set_id=50"));
    expect(getV1SavedPeerSet).toHaveBeenCalledWith(12, 20, 50);
  });
  it.each(["saved_peer_set_id=50&peer_ids=4", "saved_peer_set_id=50&charter=bank", "use_saved_context=maybe"])("rejects conflicting/invalid selectors: %s", async (query) => {
    const response = await GET(new NextRequest(`https://feeinsight.com/api/v1/peers?institution_id=12&${query}`));
    expect(response.status).toBe(400); expect(getPeerComparison).not.toHaveBeenCalled();
  });
  it("does not let a partner key select a private saved group", async () => {
    vi.mocked(validateApiKey).mockResolvedValue({ valid: true, organizationId: 7, tier: "enterprise" });
    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/peers?institution_id=12&saved_peer_set_id=50"));
    expect(response.status).toBe(403); expect(await response.json()).toMatchObject({ code: "account_context_required" });
    expect(getV1SavedPeerSet).not.toHaveBeenCalled();
  });
  it("does not widen the group if settings fail to load", async () => {
    vi.mocked(getV1SavedPeerSet).mockRejectedValue(new V1ContextError(503, "context_unavailable", "Try again"));
    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/peers?institution_id=12"));
    expect(response.status).toBe(503); expect(getPeerComparison).not.toHaveBeenCalled();
  });
  it("gives an inaccessible saved group a uniform not_found response", async () => {
    vi.mocked(getV1SavedPeerSet).mockRejectedValue(new V1ContextError(404, "not_found", "Saved peer set not found or unavailable to this account."));
    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/peers?institution_id=12&saved_peer_set_id=999"));
    expect(response.status).toBe(404); expect(getPeerComparison).not.toHaveBeenCalled();
  });
});
