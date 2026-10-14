import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn(() => Promise.resolve([{ id: 1 }])) }));
vi.mock("@/lib/api-hardening/audit", () => ({
  recordApiRouteAuditEvent: vi.fn(() => Promise.resolve()),
  getRequestSubjectKey: vi.fn(() => "test"),
}));

import { sql } from "@/lib/data-store/connection";
import { POST } from "./route";

const sqlMock = sql as unknown as ReturnType<typeof vi.fn>;
const KEY = Buffer.from("resend-route-key");
const SECRET = `whsec_${KEY.toString("base64")}`;

function deliver(body: string, signature: string | null, timestamp = String(Math.floor(Date.now() / 1000))) {
  return POST(new Request("http://localhost/api/webhooks/resend", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "svix-id": "msg_1",
      "svix-timestamp": timestamp,
      ...(signature ? { "svix-signature": signature } : {}),
    },
    body,
  }) as never);
}

function sign(body: string, timestamp = String(Math.floor(Date.now() / 1000))) {
  return `v1,${createHmac("sha256", KEY).update(`msg_1.${timestamp}.${body}`).digest("base64")}`;
}

const BODY = JSON.stringify({ type: "email.bounced", created_at: "2026-10-09T12:00:00Z", data: { email_id: "re_42" } });

describe("POST /api/webhooks/resend", () => {
  beforeEach(() => sqlMock.mockClear());
  afterEach(() => vi.unstubAllEnvs());

  it("answers 503 and records nothing without RESEND_WEBHOOK_SECRET", async () => {
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "");
    expect((await deliver(BODY, sign(BODY))).status).toBe(503);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("stamps the event on the logged send", async () => {
    vi.stubEnv("RESEND_WEBHOOK_SECRET", SECRET);
    const res = await deliver(BODY, sign(BODY));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, updated: 1 });
    expect(sqlMock.mock.calls[0].slice(1, 4)).toEqual(["email.bounced", "2026-10-09T12:00:00.000Z", "re_42"]);
  });

  it("rejects an unsigned, wrongly signed or stale delivery", async () => {
    vi.stubEnv("RESEND_WEBHOOK_SECRET", SECRET);
    expect((await deliver(BODY, null)).status).toBe(401);
    expect((await deliver(BODY, "v1,AAAA")).status).toBe(401);
    const stale = String(Math.floor(Date.now() / 1000) - 600);
    expect((await deliver(BODY, sign(BODY, stale), stale)).status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });
});
