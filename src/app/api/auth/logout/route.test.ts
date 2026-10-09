import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ logout: vi.fn(), sql: vi.fn() }));

vi.mock("@/lib/data-store/connection", () => ({ sql: mocks.sql }));
vi.mock("@/lib/auth", () => ({ logout: mocks.logout }));
vi.mock("@/lib/api-hardening/audit", () => ({
  recordApiRouteAuditEvent: vi.fn(() => Promise.resolve()),
  getRequestSubjectKey: vi.fn(() => "test"),
}));

import { POST } from "./route";

function post(form?: Record<string, string>) {
  return POST(
    new NextRequest("https://feeinsight.com/api/auth/logout", {
      method: "POST",
      ...(form ? { body: new URLSearchParams(form) } : {}),
    }),
  );
}

describe("POST /api/auth/logout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.logout.mockResolvedValue(undefined);
  });

  it("ends the session and sends the browser on with a GET", async () => {
    const response = await post();
    expect(mocks.logout).toHaveBeenCalledTimes(1);
    // 303, not 307: a 307 would re-post the sign-out form to the landing page.
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("lands on the page the form names", async () => {
    const response = await post({ next: "/admin/login" });
    expect(response.headers.get("location")).toBe("/admin/login");
  });

  it("never sends the reader off the site", async () => {
    const response = await post({ next: "//evil.example/x" });
    expect(response.headers.get("location")).toBe("/");
  });
});
