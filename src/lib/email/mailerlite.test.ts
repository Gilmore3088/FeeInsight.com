import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMailerLitePayload, mailerLiteGroupForSource, syncLeadToMailerLite } from "./mailerlite";

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

  it("adds a reader who picked a state to that state's group, creating it the first time", async () => {
    vi.stubEnv("MAILERLITE_SYNC_ENABLED", "true");
    vi.stubEnv("MAILERLITE_API_KEY", "key");
    vi.stubEnv("MAILERLITE_GROUP_ID", "123");
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/groups?")) return new Response(JSON.stringify({ data: [{ id: "9", name: "Fee Insight · State · CA" }], meta: { last_page: 1 } }));
      if (url.endsWith("/groups") && init?.method === "POST") return new Response(JSON.stringify({ data: { id: "77" } }), { status: 201 });
      return new Response(JSON.stringify({ data: { id: "sub_1" } }), { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await syncLeadToMailerLite({ email: "a@b.co", subscribed: true, source: "newsletter", state: "TX" });
    const created = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/groups") && init?.method === "POST");
    expect(JSON.parse(String(created?.[1]?.body))).toEqual({ name: "Fee Insight · State · TX" });
    const upsert = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/subscribers"));
    expect(JSON.parse(String(upsert?.[1]?.body)).groups).toEqual(["123", "77"]);
  });

  it("resubscribes only on a fresh confirm, and reports a status MailerLite didn't store", async () => {
    vi.stubEnv("MAILERLITE_SYNC_ENABLED", "true");
    vi.stubEnv("MAILERLITE_API_KEY", "key");
    vi.stubEnv("MAILERLITE_GROUP_ID", "123");
    expect(buildMailerLitePayload({ email: "a@b.co", subscribed: true, reconfirmed: true }).resubscribe).toBe(true);
    expect(buildMailerLitePayload({ email: "a@b.co", subscribed: true }).resubscribe).toBeUndefined();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { id: "sub_1", status: "unsubscribed" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await syncLeadToMailerLite({ email: "a@b.co", subscribed: true });
    expect(result.status).toBe("failed");
  });

  it("moves a reader to the state they picked last, leaving other state groups", async () => {
    vi.stubEnv("MAILERLITE_SYNC_ENABLED", "true");
    vi.stubEnv("MAILERLITE_API_KEY", "key");
    vi.stubEnv("MAILERLITE_GROUP_ID", "123");
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/groups?")) {
        return new Response(JSON.stringify({
          data: [
            { id: "9", name: "Fee Insight · State · AL", active_count: 1 },
            { id: "10", name: "Fee Insight · State · FL", active_count: 1 },
            { id: "11", name: "Fee Insight · State · TX", active_count: 0 },
            { id: "12", name: "Fee Insight · State · GA", active_count: 0 },
            { id: "50", name: "Fee Insight · Monthly · National", active_count: 3 },
          ],
          meta: { last_page: 1 },
        }));
      }
      if (url.includes("/subscribers/sub_1/groups/")) return new Response(null, { status: 204 });
      // A re-confirmed reader's old state group counts them as unsubscribed (active_count 0).
      return new Response(JSON.stringify({ data: { id: "sub_1", status: "active", groups: [{ id: "123" }, { id: "9" }, { id: "10" }, { id: "12" }, { id: "50" }] } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await syncLeadToMailerLite({ email: "a@b.co", subscribed: true, state: "FL" });
    expect(result).toEqual({ status: "synced", subscriberId: "sub_1" });
    const upsert = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/subscribers"));
    expect(JSON.parse(String((upsert as unknown as [string, RequestInit])[1].body)).groups).toEqual(["123", "10"]);
    const removed = fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.includes("/subscribers/sub_1/groups/"));
    // Leaving the national group too: a state reader gets the state edition instead.
    expect(removed.sort()).toEqual([
      "https://connect.mailerlite.com/api/subscribers/sub_1/groups/12",
      "https://connect.mailerlite.com/api/subscribers/sub_1/groups/50",
      "https://connect.mailerlite.com/api/subscribers/sub_1/groups/9",
    ]);
  });

  it("puts a reader with no state in the national group, and leaves a state reader out", async () => {
    vi.stubEnv("MAILERLITE_SYNC_ENABLED", "true");
    vi.stubEnv("MAILERLITE_API_KEY", "key");
    vi.stubEnv("MAILERLITE_GROUP_ID", "123");
    let groups: Array<{ id: string; name: string }> = [{ id: "123", name: "Newsletter" }];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/groups?")) return new Response(JSON.stringify({ data: [{ id: "50", name: "Fee Insight · Monthly · National" }, { id: "9", name: "Fee Insight · State · AL" }], meta: { last_page: 1 } }));
      if (url.includes("/subscribers/sub_1/groups/")) return new Response(JSON.stringify({ data: {} }), { status: init?.method === "DELETE" ? 204 : 200 });
      return new Response(JSON.stringify({ data: { id: "sub_1", status: "active", groups } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const membership = () => fetchMock.mock.calls
      .filter(([url]) => String(url).includes("/subscribers/sub_1/groups/"))
      .map(([url, init]) => `${init?.method} ${String(url).split("/").pop()}`);

    await syncLeadToMailerLite({ email: "a@b.co", subscribed: true });
    expect(membership()).toEqual(["POST 50"]);

    fetchMock.mockClear();
    groups = [{ id: "123", name: "Newsletter" }, { id: "9", name: "Fee Insight · State · AL" }];
    await syncLeadToMailerLite({ email: "a@b.co", subscribed: true });
    expect(membership()).toEqual([]);

    fetchMock.mockClear();
    groups = [{ id: "123", name: "Newsletter" }, { id: "50", name: "Fee Insight · Monthly · National" }];
    await syncLeadToMailerLite({ email: "a@b.co", subscribed: true });
    expect(membership()).toEqual([]);
  });

  it("marks unsubscribes without re-adding the group", () => {
    vi.stubEnv("MAILERLITE_GROUP_ID", "123");
    expect(buildMailerLitePayload({ email: "a@b.co", subscribed: false })).toEqual({
      email: "a@b.co",
      status: "unsubscribed",
    });
  });

  it("routes each lead to one group by its highest-intent source", () => {
    vi.stubEnv("MAILERLITE_GROUP_ID", "news");
    vi.stubEnv("MAILERLITE_REPORT_GROUP_ID", "report");
    vi.stubEnv("MAILERLITE_WATCHER_GROUP_ID", "watch");
    expect(mailerLiteGroupForSource("newsletter,capture_homepage")).toBe("news");
    expect(mailerLiteGroupForSource("capture_state")).toBe("watch");
    expect(mailerLiteGroupForSource("newsletter,capture_institution,report")).toBe("report");
    expect(mailerLiteGroupForSource("capture_report_sample")).toBe("report");
    expect(mailerLiteGroupForSource("report_district")).toBe("report");
    expect(mailerLiteGroupForSource("report_national")).toBe("report");
    expect(mailerLiteGroupForSource(null)).toBe("news");
  });

  it("falls back to the default group when a routed group is not configured", () => {
    vi.stubEnv("MAILERLITE_GROUP_ID", "news");
    vi.stubEnv("MAILERLITE_REPORT_GROUP_ID", "");
    vi.stubEnv("MAILERLITE_WATCHER_GROUP_ID", "");
    expect(mailerLiteGroupForSource("report")).toBe("news");
    expect(mailerLiteGroupForSource("capture_state")).toBe("news");
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
