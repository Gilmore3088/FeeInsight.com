import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  renewSessionCookie: vi.fn(),
  recordApiRouteAuditEvent: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/auth", () => ({
  SESSION_COOKIE: "fsh_session",
  getCurrentUser: mocks.getCurrentUser,
  renewSessionCookie: mocks.renewSessionCookie,
}));
vi.mock("@/lib/api-hardening/audit", () => ({
  recordApiRouteAuditEvent: mocks.recordApiRouteAuditEvent,
  getRequestSubjectKey: vi.fn(() => "test"),
}));
vi.mock("@/lib/api-hardening/rate-limit", () => ({ isRateLimited: vi.fn(async () => false) }));
vi.mock("@/lib/session-chrome", () => ({ sessionChromeFor: () => ({ signedIn: true, initial: "J" }) }));

import { GET } from "./route";

describe("/api/session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: 1 });
    mocks.renewSessionCookie.mockResolvedValue(undefined);
  });

  it("answers a visitor with no session cookie without a lookup or an audit row", async () => {
    const response = await GET(new NextRequest("http://localhost/api/session", { headers: { cookie: "theme=dark" } }));
    expect(await response.json()).toEqual({ signedIn: false });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
    expect(mocks.recordApiRouteAuditEvent).not.toHaveBeenCalled();
  });

  it("looks up and audits a request that carries the session cookie", async () => {
    const response = await GET(new NextRequest("http://localhost/api/session", { headers: { cookie: "theme=dark; fsh_session=abc.def" } }));
    expect(await response.json()).toEqual({ signedIn: true, initial: "J" });
    expect(mocks.getCurrentUser).toHaveBeenCalledTimes(1);
    expect(mocks.recordApiRouteAuditEvent).toHaveBeenCalledTimes(1);
  });
});
