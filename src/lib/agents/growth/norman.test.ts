import { describe, expect, it, vi } from "vitest";

import { isMarketingStep, isProviderStep } from "@/lib/agents/types";
import { fixFor, runConversionCheck, stopPointOf, summarizeConversionCheck, type Funnel } from "./norman";

type Db = Parameters<typeof runConversionCheck>[0]["db"];

const empty: Funnel = { trackedVisits: 0, snapshotOpened: 0, snapshotReportClicks: 0, reportRequests: 0, leads: 0, quotesSent: 0, paidReports: 0 };

function fakeDb(options: { outreach?: Array<{ id: number; title: string; link: string }>; week?: Record<string, number>; previous?: Funnel } = {}) {
  const inserts: unknown[][] = [];
  const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?");
    if (query.includes("to_regclass('public.content_drafts')")) return Promise.resolve([{ ready: true }]);
    if (query.includes("kind = 'outreach_email'")) return Promise.resolve(options.outreach ?? []);
    if (query.includes("to_regclass('public.marketing_touches')")) return Promise.resolve([{ touches: true, snapshots: true }]);
    if (query.includes("FROM leads")) return Promise.resolve([{ leads: 2, report_requests: 1, quotes: 0, paid: 0 }]);
    if (query.includes("FROM marketing_touches")) return Promise.resolve([{ n: options.week?.touches ?? 0 }]);
    if (query.includes("FROM snapshot_events")) return Promise.resolve([{ opened: options.week?.opened ?? 0, report_clicks: options.week?.clicks ?? 0 }]);
    if (query.includes("FROM agent_run_events")) return Promise.resolve(options.previous ? [{ detail: { thisWeek: options.previous } }] : []);
    if (query.includes("INSERT INTO content_drafts")) {
      inserts.push(values);
      return Promise.resolve([{ id: 55 }]);
    }
    return Promise.resolve([]);
  });
  return { db: db as unknown as Db, inserts };
}

function site(broken: string[]) {
  return vi.fn(async (url: string | URL | Request) =>
    broken.includes(String(url))
      ? new Response("<title>Page not found · Fee Insight</title>", { status: 404, headers: { "content-type": "text/html" } })
      : new Response("<title>Fee Insight</title><h1>Bank fees</h1>", { status: 200, headers: { "content-type": "text/html" } }),
  ) as unknown as typeof fetch;
}

describe("where people stop", () => {
  it("finds the first step people reach and nobody passes", () => {
    expect(stopPointOf({ ...empty, trackedVisits: 9, snapshotOpened: 4 })).toEqual({ from: "free snapshot opened", to: "report click on a snapshot", count: 4 });
    expect(stopPointOf({ ...empty, trackedVisits: null, snapshotOpened: 3 })).toEqual({ from: "free snapshot opened", to: "report click on a snapshot", count: 3 });
    expect(stopPointOf(empty)).toBeNull();
  });

  it("puts broken destinations ahead of everything else", () => {
    const broken = [{ url: "https://feeinsight.com/institution/5/market", draftId: 49, status: 404, ok: false }];
    expect(fixFor(broken, null, empty)).toContain("1 outreach draft links to a page that doesn't load");
    expect(fixFor([], null, empty)).toContain("Nobody came through a tracked link this week");
  });
});

describe("growth-conversion step", () => {
  const link = "https://feeinsight.com/institution/4715/market?utm_source=email&utm_medium=outreach&utm_campaign=outreach-launch&utm_content=inst-4715";

  it("checks every buying page and unsent outreach link, counts the funnel and files one brief", async () => {
    const { db, inserts } = fakeDb({ outreach: [{ id: 49, title: "Bluestone", link }], week: { touches: 6, opened: 2 }, previous: { ...empty, trackedVisits: 1 } });
    const result = await runConversionCheck({ db, runId: 3, dryRun: false, fetcher: site([link]), now: new Date("2026-10-12T13:00:00Z"), siteUrl: "https://feeinsight.com" });

    expect(result.weekStart).toBe("2026-10-05");
    expect(result.destinations).toHaveLength(6);
    expect(result.broken).toEqual([{ url: link, draftId: 49, status: 404, ok: false }]);
    expect(result.thisWeek).toMatchObject({ trackedVisits: 6, snapshotOpened: 2, snapshotReportClicks: 0, reportRequests: 1 });
    expect(result.previous).toMatchObject({ trackedVisits: 1 });
    expect(result.stopPoint).toEqual({ from: "free snapshot opened", to: "report click on a snapshot", count: 2 });
    expect(result.fix).toContain("No draft should be sent until its link works");
    expect(result.draftId).toBe(55);
    expect(inserts[0]).toContain("norman");
    const caption = String(inserts[0].find((value) => typeof value === "string" && value.startsWith("NORMAN conversion check")));
    expect(caption).toContain(`- ${link} (404) in outreach draft 49`);
    expect(caption).toContain("- visits from a tracked link: 6 / 6 / 1");
    expect(summarizeConversionCheck(result)).toBe("Checked 6 destinations (5 loaded, 1 broken) and the week's funnel; filed NORMAN's brief.");
  });

  it("files nothing on a dry run", async () => {
    const { db, inserts } = fakeDb();
    const result = await runConversionCheck({ db, runId: 3, dryRun: true, fetcher: site([]), siteUrl: "https://feeinsight.com" });
    expect(result.broken).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

  it("is a free marketing step", () => {
    expect(isMarketingStep("growth-conversion")).toBe(true);
    expect(isProviderStep("growth-conversion")).toBe(false);
  });
});
