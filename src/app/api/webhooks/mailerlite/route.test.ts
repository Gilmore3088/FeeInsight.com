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

function deliver(body: string, signature: string | null) {
  return POST(new Request("http://localhost/api/webhooks/mailerlite", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(signature ? { Signature: signature } : {}) },
    body,
  }) as never);
}

describe("POST /api/webhooks/mailerlite", () => {
  beforeEach(() => {
    vi.stubEnv("MAILERLITE_WEBHOOK_SECRET", "s3cret");
    sqlMock.mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("marks a MailerLite unsubscribe in leads", async () => {
    const body = JSON.stringify({ type: "subscriber.unsubscribed", data: { email: "VP@bank.example" } });
    const res = await deliver(body, createHmac("sha256", "s3cret").update(body).digest("hex"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, updated: 1 });
    expect(sqlMock.mock.calls[0].slice(1)).toEqual([["vp@bank.example"]]);
  });

  it("rejects an unsigned or wrongly signed delivery", async () => {
    const body = JSON.stringify({ type: "subscriber.unsubscribed", data: { email: "vp@bank.example" } });
    expect((await deliver(body, null)).status).toBe(401);
    expect((await deliver(body, "00")).status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });
});
