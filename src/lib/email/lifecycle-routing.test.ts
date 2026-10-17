/**
 * The lifecycle routing cases James asked for before any automation turns on (Oct 17), run
 * against a stateful fake of the MailerLite API: each subscriber's groups and fields persist
 * between calls, so a sequence of events (confirm, then Pro, then a duplicate) is checked end
 * to end. What this can't show is MailerLite's own handling of emails already queued in an
 * automation when a subscriber leaves its group; that needs a live test with the automation on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncLeadToMailerLite, syncProCustomerToMailerLite } from "./mailerlite";
import { lifecycleFields, type LifecycleDeps } from "./lifecycle-fields";
import { MONTHLY_OFFER_FIELDS, PRO_MONTHLY_OFFER } from "./monthly-offer";

const G = { pro: "g_pro", report: "g_report", watcher: "g_watch", news: "g_news", national: "g_national" };
const NAMES: Record<string, string> = {
  [G.pro]: "Fee Insight · Pro customers",
  [G.report]: "Fee Insight · Report requests",
  [G.watcher]: "Fee Insight · Watchers",
  [G.news]: "Fee Insight · Newsletter",
  [G.national]: "Fee Insight · Monthly · National",
};

interface Sub { id: string; status: string; groups: Set<string>; fields: Record<string, string> }

function fakeMailerLite() {
  const subs = new Map<string, Sub>();
  const joins: string[] = [];
  const handler = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const path = new URL(url).pathname.replace(/^\/api\//, "");
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
    if (method === "GET" && path === "groups") {
      return json({ data: Object.entries(NAMES).map(([id, name]) => ({ id, name, active_count: 0 })), meta: { last_page: 1 } });
    }
    if (method === "POST" && path === "subscribers") {
      const body = JSON.parse(String(init.body)) as { email: string; status?: string; groups?: string[]; fields?: Record<string, string> };
      let sub = [...subs.values()].find((s) => s.id === `sub_${body.email}`);
      if (!sub) {
        sub = { id: `sub_${body.email}`, status: body.status ?? "active", groups: new Set(), fields: {} };
        subs.set(body.email, sub);
      } else if (body.status) {
        sub.status = body.status;
      }
      for (const group of body.groups ?? []) sub.groups.add(group);
      Object.assign(sub.fields, body.fields ?? {});
      return json({ data: { id: sub.id, status: sub.status, groups: [...sub.groups].map((id) => ({ id, name: NAMES[id] ?? id })) } });
    }
    const member = /^subscribers\/([^/]+)\/groups\/([^/]+)$/.exec(path);
    if (member) {
      const sub = [...subs.values()].find((s) => s.id === decodeURIComponent(member[1]));
      if (!sub) return json({ message: "not found" }, 404);
      if (method === "POST") {
        if (!sub.groups.has(member[2])) joins.push(`${sub.id} ${member[2]}`);
        sub.groups.add(member[2]);
      }
      if (method === "DELETE") sub.groups.delete(member[2]);
      return new Response(null, { status: 204 });
    }
    return json({ message: `unexpected ${method} ${path}` }, 500);
  };
  const groupsOf = (email: string) => [...(subs.get(email)?.groups ?? [])].sort();
  return { handler, subs, joins, groupsOf };
}

const deps = (finding: LifecycleDeps["loadFinding"]): LifecycleDeps => ({
  loadFinding: finding,
  institutionName: async () => null,
});

describe("lifecycle routing against a stateful MailerLite", () => {
  let ml: ReturnType<typeof fakeMailerLite>;
  beforeEach(() => {
    vi.stubEnv("MAILERLITE_SYNC_ENABLED", "true");
    vi.stubEnv("MAILERLITE_API_KEY", "key");
    vi.stubEnv("MAILERLITE_PRO_GROUP_ID", G.pro);
    vi.stubEnv("MAILERLITE_REPORT_GROUP_ID", G.report);
    vi.stubEnv("MAILERLITE_WATCHER_GROUP_ID", G.watcher);
    vi.stubEnv("MAILERLITE_GROUP_ID", G.news);
    vi.stubEnv("MAILERLITE_MARKETING_GROUP_ID", "");
    ml = fakeMailerLite();
    vi.stubGlobal("fetch", vi.fn(ml.handler));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("moves a free subscriber who requests a report from Welcome to the report sequence, keeping the monthly digest", async () => {
    await syncLeadToMailerLite({ email: "a@b.co", subscribed: true, source: "newsletter", reconfirmed: true });
    expect(ml.groupsOf("a@b.co")).toEqual([G.national, G.news].sort());

    const fields = await lifecycleFields(
      [{ source: "report_district", use_case: "scope=district-8", created_at: "2026-10-17T02:00:00Z" }, { source: "newsletter", created_at: "2026-10-10T00:00:00Z" }],
      deps(async () => ({ headline: "St. Louis overdraft median", figure: "$30", detail: "Median across 210 institutions." }) as never),
    );
    await syncLeadToMailerLite({ email: "a@b.co", subscribed: true, source: "newsletter,report_district", fields });
    expect(ml.groupsOf("a@b.co")).toEqual([G.national, G.report].sort());
    expect(ml.subs.get("a@b.co")!.fields.report_url).toMatch(/\/reports\/benchmark\/district-8$/);
    expect(ml.subs.get("a@b.co")!.fields.report_finding).toBe("St. Louis overdraft median: $30. Median across 210 institutions.");
  });

  it("leaves the finding unset when it can't be read, so email 2 falls back to its default wording", async () => {
    const fields = await lifecycleFields(
      [{ source: "report_national", use_case: "scope=national" }],
      deps(async () => { throw new Error("index unavailable"); }),
    );
    await syncLeadToMailerLite({ email: "c@d.co", subscribed: true, source: "report_national", reconfirmed: true, fields });
    expect(ml.groupsOf("c@d.co")).toContain(G.report);
    expect(ml.subs.get("c@d.co")!.fields).not.toHaveProperty("report_finding");
    expect(ml.subs.get("c@d.co")!.fields.report_url).toMatch(/\/reports\/benchmark\/national$/);
  });

  it("takes a report subscriber who becomes Pro out of the report sequence, into onboarding, still on the monthly digest", async () => {
    await syncLeadToMailerLite({ email: "a@b.co", subscribed: true, source: "report_national", reconfirmed: true });
    expect(ml.groupsOf("a@b.co")).toEqual([G.national, G.report].sort());
    expect((await syncProCustomerToMailerLite("a@b.co")).status).toBe("synced");
    expect(ml.groupsOf("a@b.co")).toEqual([G.national, G.pro].sort());
    // The monthly edition reads these instead of showing the report offer.
    expect(ml.subs.get("a@b.co")!.fields).toMatchObject(PRO_MONTHLY_OFFER);
  });

  it("never puts a Pro customer back into a free sequence on a later confirm or signup", async () => {
    await syncProCustomerToMailerLite("p@q.co");
    for (const source of ["newsletter", "report_district", "capture_state", "capture_homepage"]) {
      await syncLeadToMailerLite({ email: "p@q.co", subscribed: true, source, reconfirmed: true });
    }
    expect(ml.groupsOf("p@q.co")).toEqual([G.national, G.pro].sort());
    expect(ml.subs.get("p@q.co")!.fields[MONTHLY_OFFER_FIELDS.cta]).toBe("Open Hamilton");
  });

  it("ignores a duplicate confirmation and a duplicate Stripe activation", async () => {
    await syncLeadToMailerLite({ email: "a@b.co", subscribed: true, source: "report_national", reconfirmed: true });
    await syncLeadToMailerLite({ email: "a@b.co", subscribed: true, source: "report_national", reconfirmed: true });
    expect(ml.joins.filter((j) => j.endsWith(G.report))).toHaveLength(1);

    await syncProCustomerToMailerLite("a@b.co");
    await syncProCustomerToMailerLite("a@b.co");
    expect(ml.joins.filter((j) => j.endsWith(G.pro))).toHaveLength(1);
    expect(ml.groupsOf("a@b.co")).toEqual([G.national, G.pro].sort());
  });

  it("never resubscribes a Pro customer who unsubscribed", async () => {
    await syncLeadToMailerLite({ email: "u@v.co", subscribed: false, source: "newsletter" });
    await syncProCustomerToMailerLite("u@v.co");
    expect(ml.subs.get("u@v.co")!.status).toBe("unsubscribed");
  });
});
