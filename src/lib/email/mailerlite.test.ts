import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildMailerLitePayload,
  mailerLiteGroupForSource,
  planLifecycleGroups,
  syncLeadToMailerLite,
  syncProCustomerToMailerLite,
} from "./mailerlite";
import { PRO_MONTHLY_OFFER } from "./monthly-offer";

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

  it("upserts an active subscriber with its fields, then joins its lifecycle group", async () => {
    vi.stubEnv("MAILERLITE_SYNC_ENABLED", "true");
    vi.stubEnv("MAILERLITE_API_KEY", "key");
    vi.stubEnv("MAILERLITE_GROUP_ID", "123");
    vi.stubEnv("MAILERLITE_SOURCE_FIELD", "lead_source");
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ data: { id: "sub_1", groups: [] } }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await syncLeadToMailerLite({
      email: "a@b.co",
      subscribed: true,
      source: "newsletter",
      fields: { follow_name: "Texas", report_url: null },
    });
    expect(result).toEqual({ status: "synced", subscriberId: "sub_1" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://connect.mailerlite.com/api/subscribers");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer key");
    expect(JSON.parse(init.body as string)).toEqual({
      email: "a@b.co",
      status: "active",
      fields: { lead_source: "newsletter", follow_name: "Texas" },
    });
    const joined = fetchMock.mock.calls.filter(([u, i]) => String(u).includes("/subscribers/sub_1/groups/") && (i as RequestInit)?.method === "POST");
    expect(joined.map(([u]) => String(u).split("/").pop())).toEqual(["123"]);
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
    expect(JSON.parse(String(upsert?.[1]?.body)).groups).toEqual(["77"]);
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
    expect(JSON.parse(String((upsert as unknown as [string, RequestInit])[1].body)).groups).toEqual(["10"]);
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
    expect(mailerLiteGroupForSource("newsletter,capture_national_index")).toBe("news");
    // The homepage form delivers the sample report, so it starts the report sequence.
    expect(mailerLiteGroupForSource("newsletter,capture_homepage")).toBe("report");
    expect(mailerLiteGroupForSource("capture_state")).toBe("watch");
    expect(mailerLiteGroupForSource("newsletter,capture_institution,report_national")).toBe("report");
    // A paid report quote is handled by hand, and an account or contact form starts nothing.
    expect(mailerLiteGroupForSource("report")).toBe("");
    expect(mailerLiteGroupForSource("website")).toBe("");
    expect(mailerLiteGroupForSource("capture_report_sample")).toBe("report");
    expect(mailerLiteGroupForSource("report_district")).toBe("report");
    expect(mailerLiteGroupForSource("report_national")).toBe("report");
    expect(mailerLiteGroupForSource(null)).toBe("");
  });

  it("starts no sequence when the routed group is not configured", () => {
    vi.stubEnv("MAILERLITE_GROUP_ID", "news");
    vi.stubEnv("MAILERLITE_REPORT_GROUP_ID", "");
    vi.stubEnv("MAILERLITE_WATCHER_GROUP_ID", "");
    expect(mailerLiteGroupForSource("report_district")).toBe("");
    expect(mailerLiteGroupForSource("capture_state")).toBe("");
  });

  it("never starts a sequence alongside one of equal or higher intent, and leaves lower ones", () => {
    vi.stubEnv("MAILERLITE_PRO_GROUP_ID", "pro");
    vi.stubEnv("MAILERLITE_REPORT_GROUP_ID", "report");
    vi.stubEnv("MAILERLITE_WATCHER_GROUP_ID", "watch");
    vi.stubEnv("MAILERLITE_GROUP_ID", "news");
    expect(planLifecycleGroups("report", new Set(["news", "9"]))).toEqual({ join: "report", leave: ["news"] });
    expect(planLifecycleGroups("news", new Set(["report"]))).toEqual({ join: null, leave: [] });
    expect(planLifecycleGroups("watch", new Set(["watch"]))).toEqual({ join: null, leave: [] });
    expect(planLifecycleGroups("report", new Set(["pro"]))).toEqual({ join: null, leave: [] });
    expect(planLifecycleGroups("pro", new Set(["report", "watch"]))).toEqual({ join: "pro", leave: ["report", "watch"] });
    expect(planLifecycleGroups("", new Set(["news"]))).toEqual({ join: null, leave: [] });
  });

  it("moves a new Pro customer into onboarding and out of every free sequence, without touching status", async () => {
    vi.stubEnv("MAILERLITE_SYNC_ENABLED", "true");
    vi.stubEnv("MAILERLITE_API_KEY", "key");
    vi.stubEnv("MAILERLITE_PRO_GROUP_ID", "pro");
    vi.stubEnv("MAILERLITE_GROUP_ID", "news");
    const fetchMock = vi.fn().mockImplementation(async (url: string) =>
      url.includes("/groups/")
        ? new Response(null, { status: 204 })
        : new Response(JSON.stringify({ data: { id: "sub_1", groups: [{ id: "news" }, { id: "9" }] } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await syncProCustomerToMailerLite("a@b.co")).toEqual({ status: "synced", subscriberId: "sub_1" });
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({ email: "a@b.co", fields: PRO_MONTHLY_OFFER });
    const moves = fetchMock.mock.calls.slice(1).map(([url, init]) => `${(init as RequestInit).method} ${String(url).split("/").pop()}`);
    expect(moves).toEqual(["DELETE news", "POST pro"]);
  });

  it("skips the Pro sync when the Pro group isn't configured", async () => {
    vi.stubEnv("MAILERLITE_SYNC_ENABLED", "true");
    vi.stubEnv("MAILERLITE_API_KEY", "key");
    vi.stubEnv("MAILERLITE_PRO_GROUP_ID", "");
    expect((await syncProCustomerToMailerLite("a@b.co")).status).toBe("disabled");
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
