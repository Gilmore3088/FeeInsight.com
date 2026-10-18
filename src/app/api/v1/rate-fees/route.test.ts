import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateApiKey } from "@/lib/api-auth";
import { checkRateLimitWithTier } from "@/lib/api-rate-limit";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { listRateFees } from "@/lib/data-store/rate-fees";
import { GET } from "./route";

vi.mock("@/lib/api-auth", () => ({ validateApiKey: vi.fn() }));
vi.mock("@/lib/api-rate-limit", () => ({
  checkRateLimitWithTier: vi.fn(),
  checkBurstLimitWithTier: vi.fn(() => Promise.resolve({ allowed: true, remaining: 59, limit: 60, reset: new Date("2026-10-17T12:01:00.000Z") })),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/access", () => ({ canAccessPremium: vi.fn() }));
vi.mock("@/lib/api-usage", () => ({ logApiUsage: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/data-store/rate-fees", () => ({ listRateFees: vi.fn(() => Promise.resolve({ total: 0, rows: [] })) }));

const ROW = {
  id: 9,
  institution_id: 12,
  institution_name: "Example Bank",
  state: "TX",
  charter_type: "bank",
  fee_name: "Foreign Transaction Fee",
  fee_category: "card_foreign_txn",
  frequency: "per item",
  conditions: null,
  source_url: "https://example.com/fees.pdf",
  amount_kind: "percent",
  rate_percent: 3,
  rate_min_amount: 1,
  rate_max_amount: null,
  rate_basis: "transaction",
  rate_label: "3% of the transaction ($1 minimum)",
  published_at: "2026-10-02T14:05:00.000Z",
};

describe("/api/v1/rate-fees", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateApiKey).mockResolvedValue({ valid: true, organizationId: 7, tier: "pro" });
    vi.mocked(checkRateLimitWithTier).mockResolvedValue({ allowed: true, remaining: 9000, limit: 10000, reset: new Date("2026-11-01T00:00:00.000Z") });
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    vi.mocked(canAccessPremium).mockReturnValue(false);
  });

  it("keeps rate fees behind a paid key", async () => {
    vi.mocked(validateApiKey).mockResolvedValue({ valid: true, organizationId: 3, tier: "free" });
    const response = await GET(new NextRequest("https://feeinsight.com/api/v1/rate-fees?state=TX"));
    expect(response.status).toBe(403);
    expect(listRateFees).not.toHaveBeenCalled();
  });

  it("lists rate fees with filters and pages, never as dollar figures", async () => {
    vi.mocked(listRateFees).mockResolvedValue({ total: 150, rows: [ROW] } as never);
    const response = await GET(new NextRequest(
      "https://feeinsight.com/api/v1/rate-fees?state=tx&category=card_foreign_txn&charter=bank&updated_since=2026-10-01&page=2&limit=100",
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(listRateFees).toHaveBeenCalledWith(
      {
        institution_id: null,
        state_code: "TX",
        fee_category: "card_foreign_txn",
        charter_type: "bank",
        updated_since: new Date("2026-10-01T00:00:00.000Z"),
      },
      { limit: 100, offset: 100 },
    );
    expect(body).toMatchObject({ total: 150, page: 2, pages: 2, has_more: false, updated_since: "2026-10-01T00:00:00.000Z" });
    expect(body.data[0]).toEqual({
      id: 9,
      institution_id: 12,
      institution_name: "Example Bank",
      state: "TX",
      charter_type: "bank",
      fee_name: "Foreign Transaction Fee",
      name_is_category_fallback: false,
      category: "card_foreign_txn",
      display_name: "International ATM & Card",
      rate_percent: 3,
      rate_min_amount: 1,
      rate_max_amount: null,
      rate_basis: "transaction",
      rate_terms: "3% of the transaction ($1 minimum)",
      frequency: "per item",
      conditions: null,
      source_url: "https://example.com/fees.pdf",
      published_at: "2026-10-02T14:05:00.000Z",
    });
    expect(body.data[0]).not.toHaveProperty("amount");
    expect(body).not.toHaveProperty("median");
  });

  it("filters to one institution and accepts a rate-only category", async () => {
    await GET(new NextRequest("https://feeinsight.com/api/v1/rate-fees?institution_id=12&category=atm_international"));
    expect(listRateFees).toHaveBeenCalledWith(
      expect.objectContaining({ institution_id: 12, fee_category: "atm_international", updated_since: null }),
      { limit: 100, offset: 0 },
    );
  });

  it.each([
    ["a bad date", "updated_since=yesterday"],
    ["an impossible date", "updated_since=2026-02-30"],
    ["an unknown category", "category=made_up"],
    ["a bad state", "state=Texas"],
    ["a bad charter", "charter=thrift"],
    ["a page size over 500", "limit=501"],
  ])("rejects %s with invalid_parameter", async (_label, query) => {
    const response = await GET(new NextRequest(`https://feeinsight.com/api/v1/rate-fees?${query}`));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "invalid_parameter" });
    expect(listRateFees).not.toHaveBeenCalled();
  });
});
