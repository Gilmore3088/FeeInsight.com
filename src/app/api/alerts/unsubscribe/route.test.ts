import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));
vi.mock("@/lib/api-hardening/audit", () => ({
  recordApiRouteAuditEvent: vi.fn(() => Promise.resolve()),
  getRequestSubjectKey: vi.fn(() => "test"),
}));

import { sql } from "@/lib/data-store/connection";
import { signFeeAlertUnsubscribeToken, signSubscriptionToken } from "@/lib/email/subscription-token";
import { POST } from "./route";

const sqlMock = sql as unknown as ReturnType<typeof vi.fn>;
const SECRET = "test-secret";

function postJson(body: Record<string, unknown>) {
  return POST(
    new NextRequest("http://localhost/api/alerts/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/alerts/unsubscribe", () => {
  beforeEach(() => {
    vi.stubEnv("LEAD_EMAIL_TOKEN_SECRET", SECRET);
    sqlMock.mockReset();
    sqlMock.mockResolvedValue([{ id: 1 }, { id: 2 }]);
  });

  it("turns off every alert for the signed account", async () => {
    const token = signFeeAlertUnsubscribeToken(7, "Reader@Example.com", SECRET);
    const response = await postJson({ action: "fee_alerts_unsubscribe", uid: 7, email: "reader@example.com", token });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, deactivated: 2 });
    const text = (sqlMock.mock.calls[0][0] as TemplateStringsArray).join("?");
    expect(text).toContain("SET is_active = FALSE");
  });

  it("accepts an RFC 8058 one-click POST with parameters in the query", async () => {
    const token = signFeeAlertUnsubscribeToken(7, "reader@example.com", SECRET);
    const query = new URLSearchParams({ action: "fee_alerts_unsubscribe", uid: "7", email: "reader@example.com", token });
    const response = await POST(
      new NextRequest(`http://localhost/api/alerts/unsubscribe?${query}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
      }),
    );
    expect(response.status).toBe(200);
  });

  it("rejects a token for a different account or a lead token", async () => {
    const other = signFeeAlertUnsubscribeToken(8, "reader@example.com", SECRET);
    expect((await postJson({ uid: 7, email: "reader@example.com", token: other })).status).toBe(400);
    const lead = signSubscriptionToken("unsubscribe", "reader@example.com", SECRET);
    expect((await postJson({ uid: 7, email: "reader@example.com", token: lead })).status).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("is not reachable through the leads action", async () => {
    const token = signFeeAlertUnsubscribeToken(7, "reader@example.com", SECRET);
    expect((await postJson({ action: "unsubscribe", uid: 7, email: "reader@example.com", token })).status).toBe(400);
  });

  it("stops watchlist alerts with the same fee-alert link", async () => {
    const token = signFeeAlertUnsubscribeToken(7, "reader@example.com", SECRET);
    await postJson({ action: "fee_alerts_unsubscribe", uid: 7, email: "reader@example.com", token });
    const text = (sqlMock.mock.calls[1][0] as TemplateStringsArray).join("?");
    expect(text).toContain("SET watchlist_alerts_off_at");
  });

  it("stops the Monday digest with its own signed link only", async () => {
    const token = signFeeAlertUnsubscribeToken(7, "reader@example.com", SECRET, "pro_digest_unsubscribe");
    const response = await postJson({ action: "pro_digest_unsubscribe", uid: 7, email: "reader@example.com", token });
    expect(response.status).toBe(200);
    const text = (sqlMock.mock.calls[0][0] as TemplateStringsArray).join("?");
    expect(text).toContain("SET pro_digest_off_at");

    sqlMock.mockClear();
    const feeToken = signFeeAlertUnsubscribeToken(7, "reader@example.com", SECRET);
    const crossed = await postJson({ action: "pro_digest_unsubscribe", uid: 7, email: "reader@example.com", token: feeToken });
    expect(crossed.status).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });
});
