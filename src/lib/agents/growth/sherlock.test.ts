import { describe, expect, it, vi } from "vitest";

import type { IndexEntry } from "@/lib/data-store/fee-index";
import { isMarketingStep, isProviderStep } from "@/lib/agents/types";
import { briefText, categoryFor, competitorLines, isFeeTopic, runMarketIntel, summarizeMarketIntel, type IndexReader } from "./sherlock";

type Db = Parameters<typeof runMarketIntel>[0]["db"];

function entry(category: string, median: number, institutions: number): IndexEntry {
  return {
    fee_category: category,
    fee_family: null,
    median_amount: median,
    p25_amount: null,
    p75_amount: null,
    min_amount: null,
    max_amount: null,
    institution_count: institutions,
    observation_count: institutions,
    approved_count: institutions,
    bank_count: 0,
    cu_count: 0,
    maturity_tier: "strong",
    last_updated: null,
  };
}

const index: IndexReader = {
  national: async () => [entry("overdraft", 30, 2400), entry("nsf", 30, 1900)],
  state: async (state) => (state === "NY" ? [entry("overdraft", 30, 120)] : [entry("overdraft", 25, 4)]),
};

function fakeDb(options: { articles?: Record<string, unknown>[]; previousWatch?: unknown; cited?: string[] } = {}) {
  const inserts: unknown[][] = [];
  const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?");
    if (query.includes("to_regclass('public.content_drafts')")) return Promise.resolve([{ ready: true }]);
    if (query.includes("FROM reg_articles")) return Promise.resolve(options.articles ?? []);
    if (query.includes("FROM reg_tracker_items")) return Promise.resolve([]);
    if (query.includes("SELECT facts FROM content_drafts")) return Promise.resolve([{ facts: { links: options.cited ?? [] } }]);
    if (query.includes("FROM agent_run_events")) return Promise.resolve(options.previousWatch ? [{ detail: { watch: options.previousWatch } }] : []);
    if (query.includes("INSERT INTO content_drafts")) {
      inserts.push(values);
      return Promise.resolve([{ id: 91 }]);
    }
    return Promise.resolve([]);
  });
  return { db: db as unknown as Db, inserts };
}

function fetcher(pages: Record<string, string>) {
  return vi.fn(async (url: string | URL | Request) => {
    const key = String(url);
    if (key.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /", { status: 200, headers: { "content-type": "text/plain" } });
    const body = pages[key];
    return body === undefined ? new Response("", { status: 404 }) : new Response(body, { status: 200, headers: { "content-type": "text/html" } });
  }) as unknown as typeof fetch;
}

describe("what SHERLOCK reads as a fee item", () => {
  it("keeps consumer deposit fee titles and drops the rest", () => {
    expect(isFeeTopic("CFPB issues report on overdraft and NSF fee revenue")).toBe(true);
    expect(isFeeTopic("New York bill caps checking account fees")).toBe(true);
    expect(isFeeTopic("Agencies issue Regulation E guidance")).toBe(true);
    expect(isFeeTopic("FDIC announces enforcement actions for August")).toBe(false);
    expect(isFeeTopic("Federal Reserve Board approves merger of two banks")).toBe(false);
  });

  it("files a title under NSF only when it names NSF and not overdraft", () => {
    expect(categoryFor("Bill bans NSF fees on declined items")).toBe("nsf");
    expect(categoryFor("Overdraft and NSF fee report")).toBe("overdraft");
    expect(categoryFor("Junk fee rule")).toBe("overdraft");
  });

  it("keeps a competitor page's short fee-related lines, once each", () => {
    const html = "<h1>Annual Overdraft Fee Survey 2026</h1><p>Contact us</p><li>Pricing benchmark data for credit unions</li><h2>Annual Overdraft Fee Survey 2026</h2><script>fee()</script>";
    expect(competitorLines(html)).toEqual(["Annual Overdraft Fee Survey 2026", "Pricing benchmark data for credit unions"]);
  });
});

describe("growth-intel step", () => {
  const article = (title: string, source: string, link: string) => ({ source, title, link, published_at: "2026-10-08T12:00:00Z" });

  it("files one brief with fee findings our data can support, and skips thin or repeated ones", async () => {
    const { db, inserts } = fakeDb({
      articles: [
        article("NY DFS warns banks on overdraft fee disclosures", "state:NY", "https://dfs.ny.gov/a"),
        article("Wyoming bill on overdraft fees", "state:WY", "https://wyoleg.gov/b"),
        article("FDIC announces board meeting", "FDIC", "https://fdic.gov/c"),
        article("CFPB report on NSF fees", "CFPB", "https://cfpb.gov/d"),
      ],
      cited: ["https://cfpb.gov/d"],
    });
    const result = await runMarketIntel({ db, runId: 7, dryRun: false, fetcher: fetcher({}), index, now: new Date("2026-10-09T12:00:00Z") });

    expect(result.regulatorItemsRead).toBe(4);
    expect(result.feeItems).toBe(3);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      kind: "regulator",
      link: "https://dfs.ny.gov/a",
      ourData: { scope: "New York", category: "overdraft", median: 30, institutions: 120 },
    });
    expect(result.skipped.map((item) => item.reason)).toEqual([
      "our live data is too thin (4 institutions; 10 needed)",
      "already in a brief in the last 14 days",
    ]);
    expect(result.draftId).toBe(91);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toContain("sherlock");
    expect(inserts[0]).toContain("brief");
    expect(summarizeMarketIntel(result)).toBe("Read 4 new regulator items (3 about fees) and 0 of 5 competitor pages; filed a brief with 1 finding.");
  });

  it("sets a competitor baseline on the first read and reports new fee lines after that", async () => {
    const page = "<h1>Fee benchmarking for banks</h1><h2>New: 2026 overdraft fee survey results</h2>";
    const first = await runMarketIntel({ db: fakeDb().db, runId: 1, dryRun: false, fetcher: fetcher({ "https://www.moebs.com/": page }), index });
    expect(first.findings).toHaveLength(0);
    expect(first.watch[0]).toMatchObject({ name: "Moebs Services", lines: ["Fee benchmarking for banks", "New: 2026 overdraft fee survey results"] });

    const { db, inserts } = fakeDb({ previousWatch: [{ name: "Moebs Services", url: "https://www.moebs.com/", status: 200, lines: ["Fee benchmarking for banks"] }] });
    const second = await runMarketIntel({ db, runId: 2, dryRun: false, fetcher: fetcher({ "https://www.moebs.com/": page }), index });
    expect(second.findings).toEqual([
      expect.objectContaining({ kind: "competitor", what: 'Moebs Services changed its public page: "New: 2026 overdraft fee survey results"' }),
    ]);
    expect(inserts).toHaveLength(1);
  });

  it("skips a page its robots.txt closes to crawlers", async () => {
    const closed = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith("/robots.txt")
        ? new Response("User-agent: *\nDisallow: /", { status: 200, headers: { "content-type": "text/plain" } })
        : new Response("<h1>Fee survey</h1>", { status: 200, headers: { "content-type": "text/html" } }),
    ) as unknown as typeof fetch;
    const result = await runMarketIntel({ db: fakeDb().db, runId: 1, dryRun: true, fetcher: closed, index });
    expect(result.pagesFetched).toBe(5);
    expect(result.skipped).toHaveLength(5);
    expect(result.watch.every((page) => page.lines.length === 0)).toBe(true);
  });

  it("files nothing on a quiet day or a dry run", async () => {
    const quiet = fakeDb();
    const result = await runMarketIntel({ db: quiet.db, runId: 1, dryRun: false, fetcher: fetcher({}), index });
    expect(result.draftId).toBeNull();
    expect(quiet.inserts).toHaveLength(0);
    expect(summarizeMarketIntel(result)).toContain("nothing new worth a brief");

    const dry = fakeDb({ articles: [article("NY DFS warns banks on overdraft fee disclosures", "state:NY", "https://dfs.ny.gov/a")] });
    const dryResult = await runMarketIntel({ db: dry.db, runId: 1, dryRun: true, fetcher: fetcher({}), index });
    expect(dryResult.findings).toHaveLength(1);
    expect(dry.inserts).toHaveLength(0);
  });

  it("writes a brief that says where every number comes from", () => {
    const text = briefText(
      [{ kind: "regulator", what: "CFPB: report", link: "https://cfpb.gov/d", seenOn: "2026-10-08", whyItMatters: "w", ourData: { scope: "nationally", category: "nsf", median: 30, institutions: 1900 }, suggestedJob: "j" }],
      "2026-10-09",
    );
    expect(text).toContain("NSF median $30 across 1900 institutions nationally (live catalog, not source-checked for this brief).");
    expect(text).toContain("nothing here is sent or posted");
  });

  it("is a free marketing step", () => {
    expect(isMarketingStep("growth-intel")).toBe(true);
    expect(isProviderStep("growth-intel")).toBe(false);
  });
});
