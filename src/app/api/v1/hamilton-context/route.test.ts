import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
import { authorizeV1, type V1Caller } from "@/lib/api-v1-auth";
import { getV1HamiltonContext, V1ContextError } from "@/lib/api-v1-hamilton-context";
import { GET } from "./route";

vi.mock("@/lib/api-v1-auth", () => ({ authorizeV1: vi.fn() }));
vi.mock("@/lib/api-v1-hamilton-context", async (original) => ({ ...await original<typeof import("@/lib/api-v1-hamilton-context")>(), getV1HamiltonContext: vi.fn() }));
vi.mock("@/lib/api-usage", () => ({ logApiUsage: vi.fn(() => Promise.resolve()) }));
const caller = { auth: { valid: true, subscriberUserId: 12 }, user: null, organizationId: 7, anonymousId: null, keyId: 4, paid: true,
  rateLimit: { allowed: true, remaining: 99, limit: 100, reset: new Date("2026-11-01") } } as V1Caller;
const context = { institution: { id: 20, name: "Research Bank" }, institution_source: "manual", peer_sets: [], active_peer_set_id: null };

beforeEach(() => { vi.clearAllMocks(); vi.mocked(authorizeV1).mockResolvedValue(caller); vi.mocked(getV1HamiltonContext).mockResolvedValue(context); });

it("uses only the verified holder and returns fresh private data without an ETag", async () => {
  const response = await GET(new NextRequest("https://feeinsight.com/api/v1/hamilton-context?user_id=7", { headers: { "if-none-match": "*", "x-user-id": "7" } }));
  expect(getV1HamiltonContext).toHaveBeenCalledWith(12);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.has("etag")).toBe(false);
  expect(await response.json()).toMatchObject(context);
});

it("requires paid authorization through the common front door", async () => {
  vi.mocked(authorizeV1).mockResolvedValue(new Response("denied", { status: 403 }));
  expect((await GET(new NextRequest("https://feeinsight.com/api/v1/hamilton-context"))).status).toBe(403);
  expect(authorizeV1).toHaveBeenCalledWith(expect.anything(), { paidOnly: "Hamilton account context", usageEvent: "api.v1.hamilton_context" });
  expect(getV1HamiltonContext).not.toHaveBeenCalled();
});

it("refuses a partner key even if a browser identity is available", async () => {
  vi.mocked(authorizeV1).mockResolvedValue({ ...caller, auth: { valid: true, organizationId: 7, tier: "enterprise" }, user: { id: 7 } } as V1Caller);
  const response = await GET(new NextRequest("https://feeinsight.com/api/v1/hamilton-context"));
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ code: "account_context_required" });
  expect(getV1HamiltonContext).not.toHaveBeenCalled();
});

it("answers unavailable context with a stable private 503", async () => {
  vi.mocked(getV1HamiltonContext).mockRejectedValue(new V1ContextError(503, "context_unavailable", "Try again"));
  const response = await GET(new NextRequest("https://feeinsight.com/api/v1/hamilton-context"));
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toMatchObject({ code: "context_unavailable" });
});
