import { describe, expect, it, vi } from "vitest";

import { allowedNumbers, pickSpotlightState, unbackedNumbers, type FactBundle } from "./facts";
import { copyProblems, copyText, renderEmail, withMailingAddress, writerPrompt, type EmailCopy } from "./email";
import { campaignName, parseCampaignName, planMonth, scoreCampaign, type CampaignResult, FORMAT_COOLDOWN_MONTHS } from "./formats";
import { createAbDraft, marketingGroupIds, toAgentCampaign } from "./mailerlite-campaigns";
import { stateEditionCopy } from "./state-edition";
import { lessonsFrom, runMarketingSend, summarizeWrite } from "./monthly";

const bundle: FactBundle = {
  month: "2026-11",
  asOf: "2026-11-01",
  liveInstitutions: 2665,
  liveFees: 40839,
  national: [
    { key: "overdraft", median: 30, p25: 25, p75: 32, institutions: 1509 },
    { key: "nsf", median: 30, p25: 25, p75: 31.25, institutions: 1831 },
  ],
  previousCoverage: [{ key: "overdraft", institutions: 1480 }],
  byCharter: [{ key: "overdraft", bank: { key: "overdraft", median: 34, p25: 30, p75: 35, institutions: 505 }, creditUnion: { key: "overdraft", median: 28, p25: 25, p75: 30, institutions: 1004 } }],
  state: null,
};

const copy: EmailCopy = {
  subjectA: "Overdraft sits at $30",
  subjectB: "Where does your overdraft fee sit?",
  label: "Fee Pulse · November 2026",
  headline: "Overdraft holds at $30, with 29 more institutions counted",
  intro: "The national overdraft median is $30, across 1,509 institutions.",
  sections: [{ heading: "Banks and credit unions", body: "Banks sit at $34 and credit unions at $28, a $6 gap." }],
  table: "national",
};

describe("format rotation", () => {
  it("never repeats a format inside the cooldown", () => {
    const history: CampaignResult[] = [
      { format: "market_move", month: "2026-10", recipients: 500, openRate: 0.5, clickRate: 0.1, unsubscribeRate: 0 },
      { format: "state_spotlight", month: "2026-09", recipients: 500, openRate: 0.5, clickRate: 0.1, unsubscribeRate: 0 },
    ];
    const plan = planMonth("2026-11", history);
    expect(plan).toHaveLength(2);
    expect(plan).not.toContain("market_move");
    expect(plan).not.toContain("state_spotlight");
    expect(FORMAT_COOLDOWN_MONTHS).toBe(3);
  });

  it("prefers formats that scored well once they are rested", () => {
    const history: CampaignResult[] = [
      { format: "myth_check", month: "2026-01", recipients: 500, openRate: 0.6, clickRate: 0.2, unsubscribeRate: 0 },
      { format: "bank_vs_cu", month: "2026-01", recipients: 500, openRate: 0.05, clickRate: 0, unsubscribeRate: 0.02 },
    ];
    const plan = planMonth("2026-11", history);
    expect(plan[0]).toBe("myth_check");
    expect(plan).not.toContain("bank_vs_cu");
  });

  it("scores clicks up and unsubscribes hard down", () => {
    expect(scoreCampaign({ openRate: 0.4, clickRate: 0.05, unsubscribeRate: 0 })).toBe(22);
    expect(scoreCampaign({ openRate: 0.4, clickRate: 0.05, unsubscribeRate: 0.03 })).toBe(0);
  });

  it("round-trips campaign names so the agent finds its own", () => {
    expect(parseCampaignName(campaignName("2026-11", "myth_check", "Is overdraft really $35?"))).toEqual({ month: "2026-11", format: "myth_check" });
    expect(parseCampaignName("DRAFT · Fee Pulse · October 2026")).toBeNull();
  });

  it("rotates spotlight states past recent ones", () => {
    expect(pickSpotlightState(["TX", "CA", "NY"], ["TX"])).toBe("CA");
  });
});

describe("number guard", () => {
  it("accepts numbers from the bundle and their differences", () => {
    expect(unbackedNumbers(`${copy.intro} ${copy.sections[0].body} ${copy.headline}`, allowedNumbers(bundle))).toEqual([]);
  });

  it("gives the writer last month's coverage, never last month's medians", () => {
    const prompt = writerPrompt({ format: "market_move", brief: "b", bundle, lessons: [] });
    expect(prompt).toContain('"coverage_last_month":[{"fee":');
    expect(prompt).not.toContain("previous_month_national");
    expect(prompt).not.toMatch(/"coverage_last_month":\[[^\]]*median/);
  });

  it("rejects a number the data can't back", () => {
    expect(unbackedNumbers("The median is $27.50 at 812 institutions.", allowedNumbers(bundle))).toEqual(["27.50", "812"]);
  });
});

describe("copy checks", () => {
  it("passes clean copy", () => {
    expect(copyProblems(copy)).toEqual([]);
  });

  it("blocks pricing advice, the product name and identical subjects", () => {
    const bad = { ...copy, subjectB: copy.subjectA, intro: "Raise your fees now. The Bank Fee Index says so." };
    const problems = copyProblems(bad);
    expect(problems.join(" ")).toMatch(/identical/);
    expect(problems.join(" ")).toMatch(/banned phrase/);
    expect(problems.join(" ")).toMatch(/Bank Fee Index/);
  });

  it("renders Fee Insight alone in the header and the data table from the bundle", () => {
    const html = renderEmail(copy, bundle, "market_move", "PO Box 1, Town, ST 00000");
    const header = html.slice(0, html.indexOf("<h1"));
    expect(header).toContain("Fee Insight");
    expect(header).not.toContain("Bank Fee Index");
    expect(html).toContain("1,509");
    expect(html).toContain("PO Box 1, Town, ST 00000");
    expect(html).toContain("{$unsubscribe}");
  });

  it("drafts cleanly without an address, and the send step can add it later", () => {
    const html = renderEmail(copy, bundle, "market_move", null);
    expect(html).not.toMatch(/mailing address/i);
    const withAddress = withMailingAddress(html, "PO Box 1, Town, ST 00000");
    expect(withAddress).toMatch(/PO Box 1, Town, ST 00000<br>\n<a href="\{\$unsubscribe\}"/);
    expect(withMailingAddress(withAddress!, "PO Box 1, Town, ST 00000")).toBe(withAddress);
    expect(withMailingAddress("<p>no link</p>", "PO Box 1")).toBeNull();
  });
});

describe("MailerLite", () => {
  it("creates an A/B subject draft and never sends", async () => {
    process.env.MAILERLITE_API_KEY = "test-key";
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ data: { id: "9", name: "FI Agent 2026-11 · myth_check · x", status: "draft", type: "ab", emails: [{ subject: "A" }, { subject: "B" }] } }), { status: 201 }),
    );
    const draft = await createAbDraft({ name: "FI Agent 2026-11 · myth_check · x", subjectA: "A", subjectB: "B", html: "<p/>", groupIds: ["1"] }, fetcher);
    expect(draft.status).toBe("draft");
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/campaigns$/);
    const body = JSON.parse(String(init.body));
    expect(body.type).toBe("ab");
    expect(body.ab_settings.b_value.subject).toBe("B");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refuses to send without a postal address", async () => {
    delete process.env.MARKETING_MAILING_ADDRESS;
    const fetcher = vi.fn();
    const result = await runMarketingSend({ month: "2026-11", fetcher });
    expect(result.refused).toMatch(/MARKETING_MAILING_ADDRESS/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("adds the address to a draft's footer before sending it", async () => {
    process.env.MAILERLITE_API_KEY = "test-key";
    process.env.MARKETING_MAILING_ADDRESS = "PO Box 1, Town, ST 00000";
    const draftHtml = renderEmail(copy, bundle, "market_move", null);
    const raw = {
      id: "7",
      name: "FI Agent 2026-11 · market_move · x",
      status: "draft",
      type: "ab",
      emails: [{ subject: "A", content: draftHtml }, { subject: "B", content: draftHtml }],
      filter: [[{ operator: "in_any", args: ["groups", ["42"]] }]],
      settings: { test_split: 20 },
    };
    const calls: Array<{ url: string; method: string; body: string }> = [];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET", body: String(init?.body ?? "") });
      if (url.includes("filter[status]=draft")) return new Response(JSON.stringify({ data: [raw], meta: { last_page: 1 } }));
      if (url.endsWith("/schedule")) return new Response(JSON.stringify({ data: {} }));
      return new Response(JSON.stringify({ data: raw }));
    });
    const result = await runMarketingSend({ month: "2026-11", fetcher });
    delete process.env.MARKETING_MAILING_ADDRESS;
    expect(result.sent).toHaveLength(1);
    const put = calls.find((c) => c.method === "PUT");
    const body = JSON.parse(put!.body);
    expect(body.emails[0].content).toContain("PO Box 1, Town, ST 00000");
    expect(body.groups).toEqual(["42"]);
    expect(body.ab_settings.b_value.subject).toBe("B");
    expect(calls.findIndex((c) => c.method === "PUT")).toBeLessThan(calls.findIndex((c) => c.url.endsWith("/schedule")));
  });

  it("reads sent stats from a campaign", () => {
    const campaign = toAgentCampaign({
      id: "1",
      name: "n",
      status: "sent",
      type: "ab",
      stats: { sent: 400, open_rate: { float: 0.4 }, click_rate: { float: 0.05 }, unsubscribe_rate: { float: 0.0025 } },
      emails: [{ subject: "A", is_winner: true }, { subject: "B" }],
    });
    expect(campaign).toMatchObject({ recipients: 400, openRate: 0.4, clickRate: 0.05, winnerSubject: "A" });
  });
});

describe("lessons and summaries", () => {
  it("learns only from sends big enough to count", () => {
    const lessons = lessonsFrom([
      { result: { format: "myth_check", month: "2026-11", recipients: 20, openRate: 0.9, clickRate: 0.5, unsubscribeRate: 0 }, score: 100, winnerSubject: null },
      { result: { format: "bank_vs_cu", month: "2026-11", recipients: 300, openRate: 0.4, clickRate: 0.05, unsubscribeRate: 0 }, score: 22, winnerSubject: "Banks charge more" },
    ]);
    expect(lessons).toHaveLength(1);
    expect(lessons[0]).toMatch(/bank_vs_cu/);
    expect(lessons[0]).toMatch(/Banks charge more/);
  });

  it("says when sending is blocked", () => {
    const text = summarizeWrite({
      month: "2026-11",
      planned: ["myth_check", "bank_vs_cu"],
      drafts: [{ format: "myth_check", campaignId: "1", name: "n", subjects: ["a", "b"], previewUrl: null }],
      failures: [{ format: "bank_vs_cu", reason: "rejected twice: numbers not in FACTS: 812" }],
      alreadyDrafted: false,
      costMicrousd: 0,
      groupSize: 2,
      addressMissing: true,
      skipped: null,
    });
    expect(text).toMatch(/Drafted 1 of 2/);
    expect(text).toMatch(/812/);
    expect(text).toMatch(/MARKETING_MAILING_ADDRESS/);
  });
});

describe("state editions", () => {
  const tnBundle: FactBundle = {
    ...bundle,
    national: [
      { key: "overdraft", median: 30, p25: 25, p75: 32, institutions: 1509 },
      { key: "stop_payment", median: 26, p25: 20, p75: 30, institutions: 2212 },
      { key: "wire_domestic_outgoing", median: 25, p25: 20, p75: 25, institutions: 1434 },
      { key: "cashiers_check", median: 5, p25: 3, p75: 6, institutions: 1605 },
    ],
    state: {
      code: "TN",
      name: "Tennessee",
      fees: [
        { key: "overdraft", median: 32, p25: 30, p75: 35, institutions: 32 },
        { key: "stop_payment", median: 30, p25: 25, p75: 32.5, institutions: 49 },
        { key: "wire_domestic_outgoing", median: 20, p25: 20, p75: 25, institutions: 21 },
        { key: "cashiers_check", median: 5, p25: 3, p75: 5, institutions: 36 },
      ],
    },
  };

  it("writes a state's edition from its own numbers, and every number checks out", () => {
    const edition = stateEditionCopy(tnBundle)!;
    expect(edition.headline).toBe("Tennessee runs above the national median on 2 fees and below on 1");
    expect(edition.sections[0].body).toMatch(/Stop payment: \$30 in Tennessee across 49 institutions, against \$26 nationally/i);
    expect(edition.sections[1].body).toMatch(/\$20 in Tennessee across 21 institutions/);
    expect(edition.subjectA).toMatch(/^Tennessee: Overdraft/);
    expect(copyProblems(edition)).toEqual([]);
    const allowed = allowedNumbers(tnBundle);
    ["0", "1", "2", "3", "4"].forEach((n) => allowed.add(n));
    expect(unbackedNumbers(copyText(edition), allowed)).toEqual([]);
  });

  it("skips a state with too little data", () => {
    expect(stateEditionCopy({ ...tnBundle, state: { ...tnBundle.state!, fees: tnBundle.state!.fees.slice(0, 2) } })).toBeNull();
  });

  it("sends monthly emails to every signup group unless one is named", () => {
    process.env.MAILERLITE_GROUP_ID = "news";
    process.env.MAILERLITE_REPORT_GROUP_ID = "report";
    process.env.MAILERLITE_WATCHER_GROUP_ID = "watch";
    expect(marketingGroupIds()).toEqual(["news", "report", "watch"]);
    process.env.MAILERLITE_MARKETING_GROUP_ID = "only";
    expect(marketingGroupIds()).toEqual(["only"]);
    for (const key of ["MAILERLITE_GROUP_ID", "MAILERLITE_REPORT_GROUP_ID", "MAILERLITE_WATCHER_GROUP_ID", "MAILERLITE_MARKETING_GROUP_ID"]) delete process.env[key];
  });
});
