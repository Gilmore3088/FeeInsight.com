import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateApiKey } from "@/lib/api-auth";
import { checkRateLimitWithTier } from "@/lib/api-rate-limit";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { getInstitutionById, getInstitutionsByFilter } from "@/lib/data-store";
import { searchInstitutions } from "@/lib/data-store/search";
import { getInstitutionBenchmark } from "@/lib/data-store/benchmark-export";
import { getRegulatoryWatch } from "@/lib/data-store/regulatory-watch";
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

vi.mock("@/lib/data-store/benchmark-export", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data-store/benchmark-export")>()),
  getInstitutionBenchmark: vi.fn(),
}));
vi.mock("@/lib/data-store/regulatory-watch", () => ({ getRegulatoryWatch: vi.fn() }));

vi.mock("@/lib/data-store/search", () => ({
  searchInstitutions: vi.fn(() => Promise.resolve({ rows: [], total: 0 })),
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

  it("searches by name when q is given", async () => {
    vi.mocked(searchInstitutions).mockResolvedValue({
      rows: [{ id: 5, institution_name: "Frost Bank", state_code: "TX", city: "San Antonio", charter_type: "bank", asset_size: 50, asset_size_tier: "large", published_fee_count: 31 }],
      total: 1,
    } as never);

    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/institutions?q=frost&state=tx"));
    const body = await response.json();

    expect(searchInstitutions).toHaveBeenCalledWith(expect.objectContaining({ query: "frost", state_code: "TX" }));
    expect(getInstitutionsByFilter).not.toHaveBeenCalled();
    expect(body.data[0]).toMatchObject({ id: 5, name: "Frost Bank", fee_count: 31 });
  });

  it("rejects a one-letter name search", async () => {
    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/institutions?q=f"));

    expect(response.status).toBe(400);
  });

  it("keeps the fee ranking behind a paid key", async () => {
    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/institutions?fee_category=overdraft"));

    expect(response.status).toBe(403);
    expect(searchInstitutions).not.toHaveBeenCalled();
  });

  it("ranks institutions by one fee for an enterprise key", async () => {
    vi.mocked(validateApiKey).mockResolvedValue({ valid: true, organizationId: 7, tier: "enterprise" });
    vi.mocked(searchInstitutions).mockResolvedValue({
      rows: [
        { id: 5, institution_name: "Bank A", state_code: "TX", city: "Austin", charter_type: "bank", asset_size: 50, asset_size_tier: "regional", published_fee_count: 31, focus_fee_amount: 36 },
        { id: 6, institution_name: "Bank B", state_code: "TX", city: "Waco", charter_type: "bank", asset_size: 20, asset_size_tier: "community_mid", published_fee_count: 12, focus_fee_amount: null },
      ],
      total: 2,
    } as never);

    const response = await GET(
      new NextRequest("https://feeinsight.com/api/v1/institutions?fee_category=overdraft&sort=lowest&state=TX"),
    );
    const body = await response.json();

    expect(searchInstitutions).toHaveBeenCalledWith(
      expect.objectContaining({ fee_category: "overdraft", fee_sort: "asc", state_code: "TX" }),
    );
    expect(body.sort).toBe("lowest");
    expect(body.data.map((d: { fee_amount: number | null }) => d.fee_amount)).toEqual([36, null]);
  });

  it("rejects an unknown fee category", async () => {
    vi.mocked(validateApiKey).mockResolvedValue({ valid: true, organizationId: 7, tier: "enterprise" });

    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/institutions?fee_category=not_a_fee"));

    expect(response.status).toBe(400);
  });

  it("filters the list by asset tier and city", async () => {
    await GET(
      new NextRequest("https://feeinsight.com/api/v1/institutions?asset_tier=community_small,community_mid&city=Austin"),
    );

    expect(getInstitutionsByFilter).toHaveBeenCalledWith(
      expect.objectContaining({ asset_tiers: ["community_small", "community_mid"], city: "Austin" }),
    );
  });

  it("rejects an unknown asset tier", async () => {
    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/institutions?asset_tier=huge"));

    expect(response.status).toBe(400);
  });

  describe("analyst views", () => {
    const inst = { id: "12", institution_name: "Example Bank, N.A.", state_code: "TX", city: "Austin", charter_type: "bank" };
    beforeEach(() => {
      vi.mocked(validateApiKey).mockResolvedValue({ valid: true, organizationId: 7, tier: "enterprise" });
      vi.mocked(getInstitutionById).mockResolvedValue(inst as never);
      vi.mocked(getInstitutionBenchmark).mockResolvedValue({
        institution: { id: 12, name: "Example Bank, N.A.", state: "TX", charter_type: "bank", asset_tier: "community_small" },
        groups: { national: "All banks", state: "Banks in TX", asset_peers: "Banks of the same asset size", local_market: null },
        rows: [{
          fee_category: "overdraft", display_name: "Overdraft (OD)", family: "Overdraft & NSF", amount: 35,
          national: { median: 30, p25: 25, p75: 35, institutions: 900 },
          state: { median: 32, p25: 28, p75: 35, institutions: 80 },
          asset_peers: { median: 30, p25: 26, p75: 34, institutions: 300 },
          local_market: { median: 33, institutions: 6 },
          position: "higher", source_url: "https://example.com/fees.pdf",
        }],
      });
    });

    it("downloads fees against peer benchmarks as CSV", async () => {
      const response = await GET(new NextRequest("https://feeinsight.com/api/v1/institutions?id=12&view=benchmark&format=csv"));
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/csv");
      expect(response.headers.get("Content-Disposition")).toBe("attachment; filename=example-bank-n-a-fee-benchmarks.csv");
      const [header, row] = (await response.text()).split("\n");
      expect(header.split(",")[0]).toBe("fee_category");
      expect(row).toBe("overdraft,Overdraft (OD),Overdraft & NSF,35,30,25,35,900,32,80,30,26,34,300,33,6,higher,https://example.com/fees.pdf");
    });

    it("keeps the benchmark behind a paid key", async () => {
      vi.mocked(validateApiKey).mockResolvedValue({ valid: true, organizationId: 3, tier: "free" });
      const response = await GET(new NextRequest("https://feeinsight.com/api/v1/institutions?id=12&view=benchmark&format=csv"));
      expect(response.status).toBe(403);
      expect(getInstitutionBenchmark).not.toHaveBeenCalled();
    });

    it("serves the regulatory watch as JSON", async () => {
      vi.mocked(getRegulatoryWatch).mockResolvedValue({
        market: { places: ["Austin, TX"], peers_checked: 25 },
        peer_actions: [],
        agencies_loaded: ["OCC", "FRB"],
        rule_changes: [],
        rules_tracked: false,
        as_of: "2026-10-07",
      });
      const response = await GET(new NextRequest("https://feeinsight.com/api/v1/institutions?id=12&view=regulatory_watch"));
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ id: 12, market: { peers_checked: 25 }, agencies_loaded: ["OCC", "FRB"] });
    });

    it("rejects a view without an id, and CSV outside the benchmark", async () => {
      const noId = await GET(new NextRequest("https://feeinsight.com/api/v1/institutions?view=benchmark"));
      expect(noId.status).toBe(400);
      const csv = await GET(new NextRequest("https://feeinsight.com/api/v1/institutions?id=12&view=regulatory_watch&format=csv"));
      expect(csv.status).toBe(400);
    });
  });
});
