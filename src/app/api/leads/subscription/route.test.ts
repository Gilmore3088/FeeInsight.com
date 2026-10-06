import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));
vi.mock("@/lib/api-hardening/audit", () => ({
  recordApiRouteAuditEvent: vi.fn(() => Promise.resolve()),
  getRequestSubjectKey: vi.fn(() => "test"),
}));
vi.mock("@/lib/email/mailerlite", () => ({ syncLeadToMailerLite: vi.fn() }));

import { sql } from "@/lib/data-store/connection";
import { syncLeadToMailerLite } from "@/lib/email/mailerlite";
import { signSubscriptionToken } from "@/lib/email/subscription-token";
import { POST } from "./route";

const sqlMock = sql as unknown as ReturnType<typeof vi.fn>;
const syncMock = syncLeadToMailerLite as unknown as ReturnType<typeof vi.fn>;
const SECRET = "test-secret";

function postJson(body: Record<string, unknown>) {
  return POST(
    new NextRequest("http://localhost/api/leads/subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function issuedText(callIndex: number) {
  const [strings] = sqlMock.mock.calls[callIndex] as [TemplateStringsArray];
  return strings.join("?").replace(/\s+/g, " ");
}

describe("POST /api/leads/subscription", () => {
  beforeEach(() => {
    vi.stubEnv("LEAD_EMAIL_TOKEN_SECRET", SECRET);
    sqlMock.mockReset();
    syncMock.mockReset();
    syncMock.mockResolvedValue({ status: "disabled", reason: "off" });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("confirms with a valid token and syncs as subscribed", async () => {
    sqlMock.mockResolvedValueOnce([{ source: "capture_state" }]);
    const token = signSubscriptionToken("confirm", "vp@bank.example", SECRET);
    const res = await postJson({ action: "confirm", email: "VP@bank.example", token });
    expect(res.status).toBe(200);
    expect(issuedText(0)).toContain("email_confirmed_at = COALESCE(email_confirmed_at, now())");
    expect(issuedText(0)).toContain("email_unsubscribed_at = NULL");
    expect(sqlMock.mock.calls[0].slice(1)).toEqual([null, null, null, "vp@bank.example"]);
    expect(syncMock).toHaveBeenCalledWith({ email: "vp@bank.example", subscribed: true, source: "capture_state", state: null });
  });

  it("stores a state picked on the confirm page and syncs it, using every row's sources", async () => {
    sqlMock.mockResolvedValueOnce([
      { source: "newsletter", use_case: "state=TX" },
      { source: "report", use_case: "placement=report" },
    ]);
    const token = signSubscriptionToken("confirm", "vp@bank.example", SECRET);
    const res = await postJson({ action: "confirm", email: "vp@bank.example", token, state: "tx" });
    expect(res.status).toBe(200);
    expect(sqlMock.mock.calls[0].slice(1)).toEqual(["state=TX", "state=TX", "state=TX", "vp@bank.example"]);
    expect(issuedText(0)).toContain("contact(_[a-z0-9-]+)?");
    expect(syncMock).toHaveBeenCalledWith({ email: "vp@bank.example", subscribed: true, source: "newsletter,report", state: "TX" });
  });

  it("supports RFC 8058 one-click unsubscribe with query parameters", async () => {
    sqlMock.mockResolvedValueOnce([{ source: "newsletter" }]);
    const token = signSubscriptionToken("unsubscribe", "vp@bank.example", SECRET);
    const url = `http://localhost/api/leads/subscription?action=unsubscribe&email=vp%40bank.example&token=${token}`;
    const res = await POST(
      new NextRequest(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
      }),
    );
    expect(res.status).toBe(200);
    expect(issuedText(0)).toContain("SET email_unsubscribed_at = now()");
    expect(syncMock).toHaveBeenCalledWith(expect.objectContaining({ subscribed: false }));
  });

  it("rejects a token signed for a different action or address", async () => {
    const confirmToken = signSubscriptionToken("confirm", "vp@bank.example", SECRET);
    expect((await postJson({ action: "unsubscribe", email: "vp@bank.example", token: confirmToken })).status).toBe(400);
    expect((await postJson({ action: "confirm", email: "other@bank.example", token: confirmToken })).status).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("rejects everything when no secret is configured", async () => {
    vi.stubEnv("LEAD_EMAIL_TOKEN_SECRET", "");
    vi.stubEnv("BFI_COOKIE_SECRET", "");
    const token = signSubscriptionToken("confirm", "vp@bank.example", "");
    expect((await postJson({ action: "confirm", email: "vp@bank.example", token })).status).toBe(400);
  });

  it("returns 404 when no lead matches", async () => {
    sqlMock.mockResolvedValueOnce([]);
    const token = signSubscriptionToken("confirm", "nobody@bank.example", SECRET);
    expect((await postJson({ action: "confirm", email: "nobody@bank.example", token })).status).toBe(404);
    expect(syncMock).not.toHaveBeenCalled();
  });
});
