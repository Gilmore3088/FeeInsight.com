import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/marketing-touches", () => ({
  insertMarketingTouch: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/api-hardening/audit", () => ({
  recordApiRouteAuditEvent: vi.fn(() => Promise.resolve()),
  getRequestSubjectKey: vi.fn(() => "test"),
}));

vi.mock("@/lib/api-hardening/rate-limit", () => ({
  isRateLimited: vi.fn(() => Promise.resolve(false)),
}));

import { insertMarketingTouch } from "@/lib/data-store/marketing-touches";
import { isRateLimited } from "@/lib/api-hardening/rate-limit";
import { POST } from "./route";

const insertMock = insertMarketingTouch as unknown as ReturnType<typeof vi.fn>;
const rateLimitMock = isRateLimited as unknown as ReturnType<typeof vi.fn>;

function post(body: string) {
  return POST(
    new NextRequest("http://localhost/api/track/touch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }),
  );
}

describe("POST /api/track/touch", () => {
  beforeEach(() => {
    insertMock.mockClear();
    rateLimitMock.mockResolvedValue(false);
  });

  it("stores a checked touch and answers 204", async () => {
    const res = await post(
      JSON.stringify({
        utm_source: "linkedin",
        utm_medium: "social",
        utm_campaign: "market-spread",
        landing_path: "/for-institutions?x=1",
        referrer_host: "www.linkedin.com",
        ip: "203.0.113.9",
      }),
    );
    expect(res.status).toBe(204);
    expect(insertMock).toHaveBeenCalledWith({
      utm_source: "linkedin",
      utm_medium: "social",
      utm_campaign: "market-spread",
      utm_content: null,
      utm_term: null,
      landing_path: "/for-institutions",
      referrer_host: "www.linkedin.com",
    });
  });

  it("rejects a body with no tracked source", async () => {
    const res = await post(JSON.stringify({ landing_path: "/" }));
    expect(res.status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("rejects bad JSON, empty and oversized bodies", async () => {
    expect((await post("{nope")).status).toBe(400);
    expect((await post("")).status).toBe(400);
    expect((await post(JSON.stringify({ utm_source: "linkedin", pad: "x".repeat(3000) }))).status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("answers 429 when the visitor is over the limit", async () => {
    rateLimitMock.mockResolvedValue(true);
    const res = await post(JSON.stringify({ utm_source: "linkedin" }));
    expect(res.status).toBe(429);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("answers 500 when the store fails", async () => {
    insertMock.mockRejectedValueOnce(new Error("down"));
    const res = await post(JSON.stringify({ utm_source: "linkedin" }));
    expect(res.status).toBe(500);
  });
});
