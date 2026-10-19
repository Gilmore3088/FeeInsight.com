import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import { briefRecipients, buildDailyBrief, dailyBriefEmail, storageWarningLines } from "./daily-brief";
import type { PipelineHealth } from "@/lib/job-health";
import type { PipelineFunnel } from "@/lib/data-store/pipeline-funnel";
import type { RegistryFeedFreshness } from "@/lib/data-store/feed-freshness";
import type { HoovieCadence, HoovieSourceContract } from "./hoovie/contract";
import { buildSourceHealthReport } from "./hoovie/source-health";

function contract(source: string, cadence: HoovieCadence): HoovieSourceContract {
  return { source, loader: source, publisher: "test", licence: { status: "public-domain" }, connection: "bulk-file", cadence, grain: ["institution"], linkKeys: [], tables: [] };
}

function feed(source: string, partial: Partial<RegistryFeedFreshness>): RegistryFeedFreshness {
  return {
    source, latestPeriod: null, lastSuccessAt: null, nextAttemptAt: null, failed: 0, scheduled: 0, lastError: null,
    blocked: 0, blockedHost: null, succeeded: 0, lastFailedAt: null, lastBlockedAt: null, ...partial,
  };
}

const health: PipelineHealth = {
  pipeline_enabled: true,
  provider_automation_enabled: true,
  last_successful_tick_at: "2026-10-03T12:40:00Z",
  minutes_since_successful_tick: 2,
  blocked_ticks_1h: 0,
  stale_running_steps: 0,
  overdue_state_lanes: 0,
  last_published_at: "2026-10-03T10:00:00Z",
  hours_since_last_publish: 2,
  provider_failure_count_24h: 0,
  runs_completed_24h: 14,
  runs_failed_24h: 1,
};

const funnel: PipelineFunnel = {
  institutions: 8750, withFeeUrl: 4620, documentsFetched: 4500, textsRead: 300,
  rawExtracted: 2000, verified: 6500, publishedRows: 3900, publishedInstitutions: 1190, sourcedInstitutions: 260,
};

describe("buildDailyBrief", () => {
  it("reports the goal numbers and never documents downloaded (#1040)", () => {
    const goal = {
      readAt: "2026-10-03T12:00:00Z",
      windowDays: 7,
      coverageCells: { query: "goal.coverage_cells", readyCells: 64, totalCells: 161, institutionsShort: 524, institutionsShortWeekAgo: 480, bySize: [] },
      liveInstitutions: { query: "goal.live_institutions", live: 3858, addedThisWeek: 12, droppedThisWeek: 20 },
      accuracy: null,
      wrongAfterPublish: { query: "goal.wrong_after_publish_7d", published: 1000, wrong: 20, rate: 0.02, housekeeping: 300, topErrors: [] },
      spend: { query: "goal.provider_spend_7d", weekUsd: 60, costPerNewInstitutionUsd: 5, byAgent: [] },
      knoxPasses: null,
      unstatedAudience: { query: "goal.unstated_audience", liveFees: 1000, unknownFees: 997, share: 0.997 },
    };
    const brief = buildDailyBrief({
      health, funnel, goal, stepsByAgent: {}, feed24h: [],
      previous: { funnel: { ...funnel, documentsFetched: 100 }, at: "2026-10-02T12:47:05Z" },
      now: new Date("2026-10-03T12:47:00Z"),
    });
    const text = brief.lines.join("\n");
    expect(text).not.toContain("documents downloaded");
    expect(text).toContain("Coverage: 64 of 161 state and size groups under $10B meet the target; 524 more covered institutions would close the gap (480 7 days ago).");
    expect(text).toContain("Institutions with live fees: 3,858, 12 added in the last 7 days and 20 dropped (net -8).");
    expect(text).toContain("Stored-copy support (secondary): could not be read today.");
    expect(text).toContain("Wrong after publish: 2.0% (20 of 1,000");
    expect(text).toContain("$5.00 per institution added");
    expect(text).toContain("Audience not stated: 99.7% of live fees");
  });

  it("copies the quality ledger into the email (Oct 15)", () => {
    const brief = buildDailyBrief({
      health, funnel, stepsByAgent: {}, feed24h: [], previous: null,
      ledger: {
        answerKey: { precision: 0.874, recall: 0.575, scoredAt: "2026-10-14T16:53:00Z", scorerVersion: 2 },
        liveFees: 76629, storedNotes: 75227, perItemPeriods: 12, noSourceLink: 1338,
      },
      now: new Date("2026-10-15T12:00:00Z"),
    });
    const text = brief.lines.join("\n");
    expect(text).toContain("Quality ledger (live fees now):");
    expect(text).toContain("Answer key (scorer v2, 2026-10-14): 87.4% of the fees we publish are right; we find 57.5% of the fees we should.");
    expect(text).toContain("Knox's note still stored in a live fee's conditions: 75,227 of 76,629 (target 0).");
    expect(text).toContain("NSF, overdraft and returned-item fees stored by a period (James's per-item rule): 12, including overdraft programs");
    expect(text).toContain("Live fees with no link to the bank's own document: 1,338 (target 0).");
  });

  it("summarizes runs, movement since the last brief, and what needs the owner", () => {
    const brief = buildDailyBrief({
      health,
      funnel,
      previous: { funnel: { ...funnel, withFeeUrl: 4600, textsRead: 77, sourcedInstitutions: 239 }, at: "2026-10-02T12:47:05Z" },
      stepsByAgent: { magellan: 412, knox: 260, rosetta: 260, darwin: 3 },
      now: new Date("2026-10-03T12:47:00Z"),
      feed24h: [
        { id: 1, at: "2026-10-03T10:00:00Z", agent: "magellan", runId: 1, stateCode: "GA", tone: "ok", text: "Downloaded 25." },
        { id: 2, at: "2026-10-03T10:05:00Z", agent: "knox", runId: 1, stateCode: "GA", tone: "error", text: "Stopped with an error while working on \"extract\": boom" },
      ],
    });
    expect(brief.subject).toBe("Atlas daily brief: pipeline running, 260 institutions published");
    expect(brief.lines[0]).toBe("What ran: 14 runs finished, 1 failed, 0 blocked. Busiest by completed steps: Magellan (412), Rosetta (260), Knox (260).");
    expect(brief.lines[1]).toBe("Since yesterday: +20 fee URLs, +223 documents read, +21 institutions published.");
    expect(brief.lines[2]).toContain("260 of 8,750 institutions have sourced fees");
    expect(brief.lines[3]).toContain("Needs you:");
    expect(brief.lines.length).toBeLessThanOrEqual(5);
  });

  it("is reassuring when nothing is wrong and has no history on the first day", () => {
    const brief = buildDailyBrief({ health: { ...health, runs_failed_24h: 0 }, funnel, previous: null, stepsByAgent: {}, feed24h: [] });
    expect(brief.lines).toContain("Nothing is stuck. Nothing needs you.");
    expect(brief.lines.some((line) => line.startsWith("Since"))).toBe(false);
    expect(brief.lines[0]).toBe("What ran: 14 runs finished, 0 failed, 0 blocked.");
  });

  it("names the date when the last brief was not yesterday", () => {
    const brief = buildDailyBrief({
      health,
      funnel,
      previous: { funnel: { ...funnel, verified: 6400 }, at: "2026-09-30T12:47:05Z" },
      stepsByAgent: {},
      feed24h: [],
      now: new Date("2026-10-03T12:47:00Z"),
    });
    expect(brief.lines[1]).toBe("Since the last brief (Sep 30): +100 fees verified.");
  });
});

describe("morning brief", () => {
  const base = {
    health,
    funnel,
    previous: null,
    stepsByAgent: {},
    feed24h: [],
    now: new Date("2026-10-06T12:00:00Z"),
  };

  it("leads with the Needs-you list and the spend line", () => {
    const brief = buildDailyBrief({
      ...base,
      needsYou: [
        { id: "lead:1", severity: "critical", area: "Customers", title: "Reply overdue by 4 hours: Pat Lee", detail: "", href: "/admin/leads", action: "Open lead" },
      ],
      spend: {
        readAt: "2026-10-06T12:00:00Z",
        total: { key: "all", todayUsd: 8.35, monthUsd: 23.27, dailyCapUsd: 75, monthlyCapUsd: 500, enabled: true },
        agents: [],
      },
    });
    expect(brief.subject).toBe("Morning brief: 1 thing needs you, pipeline running");
    expect(brief.lines[0]).toBe("1 thing needs you.\n- Reply overdue by 4 hours: Pat Lee. Open lead: https://feeinsight.com/admin/leads");
    expect(brief.lines).toContain("Spend: $8.35 so far today of the $75 daily cap; $23.27 this month of $500 ($476.73 remaining).");
  });

  it("says plainly when nothing needs you", () => {
    const brief = buildDailyBrief({ ...base, needsYou: [] });
    expect(brief.subject).toBe("Morning brief: nothing needs you, pipeline running");
    expect(brief.lines[0]).toBe("Nothing needs you.");
  });

  it("says nothing about storage on a day with no storage warning", () => {
    const brief = buildDailyBrief({ ...base, needsYou: [], storage: { alerts: [], at: "2026-10-05T12:17:00Z" } });
    expect(brief.subject).toBe("Morning brief: nothing needs you, pipeline running");
    expect(brief.lines.join("\n")).not.toContain("Storage");
    expect(storageWarningLines(null)).toEqual([]);
  });

  it("emails Atlas's storage warnings when there are any (Oct 18)", () => {
    const storage = { alerts: ["area_statistics is 2,100 MB, above its 2,000 MB budget; the sources that write it are held"], at: "2026-10-05T12:17:00Z" };
    const brief = buildDailyBrief({ ...base, needsYou: [], storage });
    expect(brief.subject).toBe("Morning brief: 1 thing needs you, storage warning, pipeline running");
    expect(brief.lines[0]).toBe("1 thing needs you.\n- Storage: area_statistics is 2,100 MB, above its 2,000 MB budget; the sources that write it are held.");

    const busy = buildDailyBrief({
      ...base,
      needsYou: [{ id: "lead:1", severity: "critical", area: "Customers", title: "Reply overdue", detail: "", href: "/admin/leads", action: "Open lead" }],
      storage,
    });
    expect(busy.subject).toBe("Morning brief: 2 things need you, storage warning, pipeline running");
    expect(busy.lines[0]).toContain("- Storage: area_statistics is 2,100 MB");

    const older = buildDailyBrief({ ...base, storage });
    expect(older.subject).toContain("storage warning");
    expect(older.lines).toContain("Storage: area_statistics is 2,100 MB, above its 2,000 MB budget; the sources that write it are held.");
    expect(older.lines).not.toContain("Nothing is stuck. Nothing needs you.");
  });

  it("names a public source that failed or loaded empty, with its reason (#1866)", () => {
    const report = buildSourceHealthReport({
      contracts: [contract("fr-y9c", "quarterly"), contract("hmda", "annual"), contract("fdic-financials", "quarterly")],
      feeds: [
        feed("fr-y9c", { blocked: 2, blockedHost: "www.ffiec.gov", lastBlockedAt: "2026-10-05T03:00:00.000Z" }),
        feed("hmda", { lastSuccessAt: "2026-09-01T00:00:00.000Z", succeeded: 3, failed: 1, lastFailedAt: "2026-10-05T02:00:00.000Z", lastError: "HTTP 503 from ffiec.cfpb.gov" }),
        feed("fdic-financials", { lastSuccessAt: "2026-10-04T00:00:00.000Z", succeeded: 60 }),
      ],
      skips: new Map(),
      now: new Date("2026-10-05T12:00:00Z"),
    });
    const brief = buildDailyBrief({ ...base, needsYou: [], sources: report });
    expect(brief.subject).toBe("Morning brief: public data warning, pipeline running");
    expect(brief.lines[0]).toBe("Public data warning.");
    const section = brief.lines.find((line) => line.startsWith("Public data:"));
    expect(section).toBe([
      "Public data: 2 of 3 sources not fresh (1 failed, 1 empty).",
      "- hmda: failed, 1 partition failed: HTTP 503 from ffiec.cfpb.gov; last nonempty load 2026-09-01; last successful check 2026-09-01",
      "- fr-y9c: empty, www.ffiec.gov refused production's request; no nonempty load recorded",
    ].join("\n"));

    const busy = buildDailyBrief({
      ...base,
      needsYou: [{ id: "lead:1", severity: "critical", area: "Customers", title: "Reply overdue", detail: "", href: "/admin/leads", action: "Open lead" }],
      sources: report,
    });
    expect(busy.subject).toBe("Morning brief: 1 thing needs you, 2 public sources failed or empty, pipeline running");

    const older = buildDailyBrief({ ...base, sources: report });
    expect(older.subject).toContain(", 2 public sources failed or empty,");
    expect(older.lines).not.toContain("Nothing is stuck. Nothing needs you.");
  });

  it("says nothing about public data when every source is fresh", () => {
    const report = buildSourceHealthReport({
      contracts: [contract("fdic-financials", "quarterly")],
      feeds: [feed("fdic-financials", { lastSuccessAt: "2026-10-04T00:00:00.000Z", succeeded: 60 })],
      skips: new Map(),
      now: new Date("2026-10-05T12:00:00Z"),
    });
    const brief = buildDailyBrief({ ...base, needsYou: [], sources: report });
    expect(brief.subject).toBe("Morning brief: nothing needs you, pipeline running");
    expect(brief.lines.join("\n")).not.toContain("Public data");
  });

  it("copies the owner's Gmail unless told otherwise", () => {
    expect(briefRecipients({})).toEqual({ to: "hello@bankfeeindex.com", cc: ["jlgilmore2@gmail.com"] });
    expect(briefRecipients({ ATLAS_BRIEF_CC: "" })).toEqual({ to: "hello@bankfeeindex.com", cc: [] });
    expect(briefRecipients({ ATLAS_BRIEF_TO: "jlgilmore2@gmail.com" }).cc).toEqual([]);
  });
});

describe("actionable morning brief", () => {
  const base = { health, funnel, previous: null, stepsByAgent: {}, feed24h: [] };
  it("counts the health and storage warnings plus shown and omitted decisions", () => {
    const needsYou = Array.from({length:7},(_,i)=>({id:`failure:step:registry-source-${i}`, severity:"critical" as const,
      area:"Agents" as const,title:`Source ${i} failing`,detail:"HTTP 400: invalid geography",href:"/admin/atlas/details",action:"See failures"}));
    const brief = buildDailyBrief({...base,health:{...health,overdue_state_lanes:38,runs_blocked_24h:4}, needsYou,
      storage:{alerts:["financial history needs a budget"],at:"2026-10-19T12:17:00Z"}});
    expect(brief.lines[0]).toMatch(/^9 things need you\./);
    expect(brief.lines[0]).toContain("38 state lanes are overdue");
    expect(brief.lines[0]).toContain("Hoovie: Source 0 failing — HTTP 400: invalid geography");
    expect(brief.lines[0]).toContain("See failures: https://feeinsight.com/admin/atlas/details");
    expect(brief.lines[0]).toContain("and 1 more in the console");
    expect(brief.lines[0]).not.toContain("Source 6 failing");
    expect(brief.lines[1]).toContain("1 failed, 4 blocked");
  });

  it("bounds/redacts evidence, escapes HTML and creates only same-site admin links", () => {
    const brief = buildDailyBrief({...base,needsYou:[{id:"failure:step:extract",severity:"critical",area:"Agents",
      title:"<script>alert(1)</script>", detail:`UserID=secret-key\n${"x".repeat(500)}<img src=x>`,href:"//evil.test",action:"Review"}]});
    const email = dailyBriefEmail(brief);
    expect(brief.lines[0]).toContain("Knox:");
    expect(brief.lines[0]).not.toContain("secret-key");
    expect(brief.lines[0]).toContain("UserID=***");
    expect(brief.lines[0]).toContain("…");
    expect(brief.lines[0]).toContain("Review: https://feeinsight.com/admin");
    expect(brief.lines[0].split("\n")).toHaveLength(2);
    expect(email.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain('href="https://feeinsight.com/admin"');
    expect(email.html).not.toContain("evil.test");
    expect(dailyBriefEmail({subject:"test",lines:["Publisher returned https://:::: and https://evil.test/admin"]}).html)
      .not.toContain('href="https://evil.test');
  });

  it("does not describe an empty check as a nonempty load", () => {
    const sources = buildSourceHealthReport({contracts:[contract("empty", "annual")],
      feeds:[feed("empty",{lastSuccessAt:"2026-10-19T12:00:00Z",lastAttemptAt:"2026-10-19T12:00:00Z",lastLoadedAt:null})],
      skips:new Map(),now:new Date("2026-10-19T13:00:00Z")});
    const brief = buildDailyBrief({...base,needsYou:[],sources});
    const text = brief.lines.join("\n");
    expect(text).toContain("last attempt 2026-10-19; no nonempty load recorded; last successful check 2026-10-19");
    expect(text).not.toContain("last success 2026-10-19");
  });
});
