import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));

vi.mock("@/lib/data-store/connection", () => ({ sql: sqlMock }));
vi.mock("@/lib/api-auth", () => ({ validateApiKey: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/access", () => ({ canAccessPremium: vi.fn(() => false) }));
vi.mock("@/lib/api-usage", () => ({ logApiUsage: vi.fn(() => Promise.resolve()) }));

import { validateApiKey } from "@/lib/api-auth";
import { logApiUsage } from "@/lib/api-usage";
import { getCurrentUser } from "@/lib/auth";
import { API_V1_BURST_ROUTE } from "@/lib/api-rate-limit";
import { API_V1_RATE_LIMIT_ROUTE } from "@/lib/api-v1";
import { authorizeV1 } from "./api-v1-auth";

const proKey = { valid: true, organizationId: 7, tier: "pro" };
const request = () => new NextRequest("https://feeinsight.com/api/v1/fees", { headers: { authorization: "Bearer bfi_x" } });
const routesReserved = () => sqlMock.mock.calls.map((call) => call[1]);

describe("authorizeV1", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sqlMock.mockReset();
    vi.mocked(validateApiKey).mockResolvedValue(proKey);
  });

  it("checks the burst limit, then reserves the monthly call", async () => {
    sqlMock.mockResolvedValue([{ request_count: 1 }]);

    const caller = await authorizeV1(request());

    expect(caller).not.toBeInstanceOf(Response);
    expect(routesReserved()).toEqual([API_V1_BURST_ROUTE, API_V1_RATE_LIMIT_ROUTE]);
  });

  it("refuses a burst with 429 burst_limited and Retry-After, and reserves no monthly call", async () => {
    sqlMock.mockResolvedValueOnce([]);

    const response = (await authorizeV1(request())) as Response;
    const body = await response.json();
    const retryAfter = Number(response.headers.get("retry-after"));

    expect(response.status).toBe(429);
    expect(body).toMatchObject({ code: "burst_limited", limit: 60 });
    expect(body.error).toContain("60 calls a minute");
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(routesReserved()).toEqual([API_V1_BURST_ROUTE]);
  });

  it("fails closed with 503 when the burst reservation errors, and reserves no monthly call", async () => {
    sqlMock.mockRejectedValueOnce(new Error("connection refused"));

    const response = (await authorizeV1(request())) as Response;

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "rate_limit_unavailable" });
    expect(routesReserved()).toEqual([API_V1_BURST_ROUTE]);
  });

  it("lets an enterprise key past both counts without a reservation", async () => {
    vi.mocked(validateApiKey).mockResolvedValue({ valid: true, organizationId: 9, tier: "enterprise" });

    const caller = await authorizeV1(request(), { paidOnly: "Branch locations" });

    expect(caller).toMatchObject({ paid: true });
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("returns a turned-away key's own code", async () => {
    vi.mocked(validateApiKey).mockResolvedValue({
      valid: false,
      organizationId: null,
      tier: "free",
      error: "This key's Fee Insight Pro subscription is not active.",
      code: "subscription_inactive",
    });

    const response = (await authorizeV1(request())) as Response;

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "subscription_inactive" });
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("logs a plan_required refusal on a paid-only endpoint", async () => {
    vi.mocked(validateApiKey).mockResolvedValue({ valid: true, organizationId: 3, tier: "free", keyId: 5 });
    sqlMock.mockResolvedValue([{ request_count: 1 }]);

    const response = (await authorizeV1(request(), { paidOnly: "Branch locations", usageEvent: "api.v1.branches" })) as Response;

    expect(response.status).toBe(403);
    expect(logApiUsage).toHaveBeenCalledWith(3, null, "api.v1.branches", { status: 403 }, 5);
  });

  it("carries the accepted key's id so each usage event names its key", async () => {
    vi.mocked(validateApiKey).mockResolvedValue({ ...proKey, keyId: 22 });
    sqlMock.mockResolvedValue([{ request_count: 1 }]);

    const caller = await authorizeV1(request());

    expect(caller).toMatchObject({ organizationId: 7, keyId: 22 });
  });

  it("has no key id for a signed-in session without a key", async () => {
    vi.mocked(validateApiKey).mockResolvedValue({ valid: false, organizationId: null, tier: "free" });
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 1 } as Awaited<ReturnType<typeof getCurrentUser>>);
    sqlMock.mockResolvedValue([{ request_count: 1 }]);

    const caller = await authorizeV1(request());

    expect(caller).toMatchObject({ keyId: null, organizationId: null });
  });
});
