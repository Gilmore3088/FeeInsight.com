import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMailerLitePayload, syncLeadToMailerLite } from "./mailerlite";

describe("MailerLite sync", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is disabled unless the flag and API key are both set", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("MAILERLITE_API_KEY", "key");
    vi.stubEnv("MAILERLITE_SYNC_ENABLED", "");
    expect((await syncLeadToMailerLite({ email: "a@b.co", subscribed: true })).status).toBe("disabled");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("upserts an active subscriber into the configured group", async () => {
    vi.stubEnv("MAILERLITE_SYNC_ENABLED", "true");
    vi.stubEnv("MAILERLITE_API_KEY", "key");
    vi.stubEnv("MAILERLITE_GROUP_ID", "123");
    vi.stubEnv("MAILERLITE_SOURCE_FIELD", "lead_source");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { id: "sub_1" } }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await syncLeadToMailerLite({ email: "a@b.co", subscribed: true, source: "capture_state" });
    expect(result).toEqual({ status: "synced", subscriberId: "sub_1" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://connect.mailerlite.com/api/subscribers");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer key");
    expect(JSON.parse(init.body as string)).toEqual({
      email: "a@b.co",
      status: "active",
      groups: ["123"],
      fields: { lead_source: "capture_state" },
    });
  });

  it("marks unsubscribes without re-adding the group", () => {
    vi.stubEnv("MAILERLITE_GROUP_ID", "123");
    expect(buildMailerLitePayload({ email: "a@b.co", subscribed: false })).toEqual({
      email: "a@b.co",
      status: "unsubscribed",
    });
  });

  it("reports provider errors instead of throwing", async () => {
    vi.stubEnv("MAILERLITE_SYNC_ENABLED", "true");
    vi.stubEnv("MAILERLITE_API_KEY", "key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "bad" }), { status: 422 })));
    expect(await syncLeadToMailerLite({ email: "a@b.co", subscribed: true })).toEqual({
      status: "failed",
      error: "MailerLite sync failed: bad",
    });
  });
});
