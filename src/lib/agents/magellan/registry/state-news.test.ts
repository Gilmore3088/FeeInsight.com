import { describe, expect, it, vi } from "vitest";
import { RegistryHttpError } from "@/lib/regulatory/http";
import type { RegistryDb } from "./partitions";
import { loadFeeBills, runRegistryStateBillNews, statesForDay } from "./state-bill-news";
import { readAgencyNews, runRegistryStateRegNews, stateAgencySites } from "./state-reg-news";

function createDb(handlers: Array<[string, (values: unknown[]) => unknown[]]> = []) {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const db = vi.fn((strings: unknown, ...values: unknown[]) => {
    const text = Array.isArray(strings) ? strings.join(" ") : String(strings);
    statements.push({ text, values });
    for (const [needle, handler] of handlers) if (text.includes(needle)) return Promise.resolve(handler(values));
    return Promise.resolve([]);
  });
  return { db: db as unknown as RegistryDb, statements };
}

const RSS = (titles: string[]) =>
  `<?xml version="1.0"?><rss version="2.0"><channel>${titles
    .map((t, i) => `<item><title>${t}</title><link>https://x.example.gov/n/${i}-${encodeURIComponent(t)}</link><pubDate>Mon, 06 Oct 2026 12:00:00 GMT</pubDate></item>`)
    .join("")}</channel></rss>`;

function fetcher(pages: Record<string, string>) {
  return vi.fn(async (url: string) => {
    if (url in pages) return pages[url];
    throw new RegistryHttpError(`HTTP 404 for ${url}`, url, 404);
  });
}

describe("state regulator news", () => {
  it("lists the bank regulator and a separate credit union regulator's site", () => {
    const sites = stateAgencySites([
      { stateCode: "TX", stateName: "Texas", agency: "Texas Department of Banking", website: "https://dob.example.gov", creditUnionAgency: "Texas CU Dept", creditUnionWebsite: "https://cud.example.gov" },
      { stateCode: "AL", stateName: "Alabama", agency: "Alabama Banking", website: "https://al.example.gov", creditUnionAgency: "Alabama CUA", creditUnionWebsite: null },
    ]);
    expect(sites.map((s) => s.website)).toEqual(["https://dob.example.gov", "https://cud.example.gov", "https://al.example.gov"]);
  });

  it("reads the advertised feed, else the news page, else reports none", async () => {
    const fetchText = fetcher({
      "https://a.example.gov": `<link rel="alternate" type="application/rss+xml" href="/feed.xml">`,
      "https://a.example.gov/feed.xml": RSS(["Commissioner warns on overdraft fees", "New deputy named"]),
      "https://b.example.gov": `<a href="/press-releases">Press Releases</a>`,
      "https://b.example.gov/press-releases": `<a href="/press-releases/2026/merger">Division approves merger of two state-chartered banks</a>`,
      "https://c.example.gov": `<a href="/about">About</a>`,
    });
    const feed = await readAgencyNews({ state: "AA", agency: "A", website: "https://a.example.gov" }, fetchText);
    expect(feed.result).toMatchObject({ mode: "feed", url: "https://a.example.gov/feed.xml", items: 2, feeItems: 1, sample: ["Commissioner warns on overdraft fees"] });
    expect(feed.articles[0].source).toBe("state:AA");
    const page = await readAgencyNews({ state: "BB", agency: "B", website: "https://b.example.gov" }, fetchText);
    expect(page.result).toMatchObject({ mode: "page", url: "https://b.example.gov/press-releases", items: 1 });
    const none = await readAgencyNews({ state: "CC", agency: "C", website: "https://c.example.gov" }, fetchText);
    expect(none.result).toMatchObject({ mode: "none", items: 0 });
    const failed = await readAgencyNews({ state: "DD", agency: "D", website: "https://d.example.gov" }, fetchText);
    expect(failed.result.mode).toBe("failed");
  });

  it("stores nothing in shadow mode and records each agency's mode", async () => {
    const { db, statements } = createDb();
    const fetchText = fetcher({
      "https://a.example.gov": `<link rel="alternate" type="application/rss+xml" href="/feed.xml">`,
      "https://a.example.gov/feed.xml": RSS(["Overdraft fee guidance issued"]),
    });
    const result = await runRegistryStateRegNews({
      db,
      live: false,
      fetchText,
      sites: [
        { state: "AA", agency: "A", website: "https://a.example.gov" },
        { state: "BB", agency: "B", website: "https://b.example.gov" },
        { state: "CC", agency: "C", website: null },
      ],
    });
    expect(result).toMatchObject({ fetched: 1, feeRelated: 1, stored: 0, shadow: true });
    expect(statements.some((s) => s.text.includes("INSERT INTO reg_articles"))).toBe(false);
    const partition = statements.find((s) => s.text.includes("registry_ingest_partitions"));
    const detail = JSON.parse(String(partition?.values.find((v) => typeof v === "string" && v.includes("modes"))));
    expect(detail.modes).toMatchObject({ feed: 1, failed: 1, no_website: 1 });
  });

  it("stores items live and throws when every site fails", async () => {
    const { db, statements } = createDb([["INSERT INTO reg_articles", () => [{ guid: "x" }]]]);
    const fetchText = fetcher({ "https://a.example.gov": RSS(["Bulletin one"]) });
    const result = await runRegistryStateRegNews({ db, live: true, fetchText, sites: [{ state: "AA", agency: "A", website: "https://a.example.gov" }] });
    expect(result.stored).toBe(1);
    expect(statements.some((s) => s.text.includes("INSERT INTO reg_articles"))).toBe(true);
    await expect(
      runRegistryStateRegNews({ db, live: false, fetchText: fetcher({}), sites: [{ state: "BB", agency: "B", website: "https://b.example.gov" }] }),
    ).rejects.toThrow(/Every state regulator site failed/);
  });

  it("starts no new site after the cutoff", async () => {
    const { db } = createDb();
    let now = 0;
    const fetchText = vi.fn(async () => {
      await Promise.resolve();
      now += 100_000;
      return RSS(["Item"]);
    });
    const result = await runRegistryStateRegNews({
      db,
      live: false,
      fetchText,
      clock: () => now,
      sites: [
        { state: "AA", agency: "A", website: "https://a.example.gov" },
        { state: "BB", agency: "B", website: "https://b.example.gov" },
        { state: "CC", agency: "C", website: "https://c.example.gov" },
        { state: "DD", agency: "D", website: "https://d.example.gov" },
        { state: "EE", agency: "E", website: "https://e.example.gov" },
        { state: "FF", agency: "F", website: "https://f.example.gov" },
        { state: "GG", agency: "G", website: "https://g.example.gov" },
        { state: "HH", agency: "H", website: "https://h.example.gov" },
        { state: "II", agency: "I", website: "https://i.example.gov" },
      ],
    });
    expect(result.agencies.filter((a) => a.mode === "not_reached").map((a) => a.state)).toEqual(["II"]);
  });
});

describe("news on state fee bills", () => {
  it("reads fee bills from the state-bills rows", async () => {
    const { db } = createDb([
      ["detail->'bills'", () => [{ partition_key: "ca", bills: ["AB 1520 (signed)"] }, { partition_key: "CO", bills: ["SB 79 (introduced)", "HB 1046 (in_committee)"] }]],
    ]);
    expect(await loadFeeBills(db)).toEqual([
      { state: "CA", identifier: "AB 1520", stage: "signed" },
      { state: "CO", identifier: "HB 1046", stage: "in_committee" },
      { state: "CO", identifier: "SB 79", stage: "introduced" },
    ]);
  });

  it("searches a quarter of the states each day and every state over four days", () => {
    const states = ["A", "B", "C", "D", "E", "F", "G", "H"];
    const days = [0, 1, 2, 3].map((d) => statesForDay(new Date(Date.UTC(2026, 9, 8 + d)), states));
    expect(days.every((d) => d.length === 2)).toBe(true);
    expect(new Set(days.flat()).size).toBe(8);
  });

  it("keeps bill coverage, filters state searches to fee headlines, and stores nothing in shadow mode", async () => {
    const { db, statements } = createDb();
    const fetchText = vi.fn(async (url: string) => {
      const q = new URL(url).searchParams.get("q") ?? "";
      return q.startsWith(`"AB 1520"`)
        ? RSS(["Newsom signs AB 1520 - Los Angeles Times"])
        : RSS(["Lawmakers weigh overdraft fee cap - Local Paper", "Bank opens branch - Local Paper"]);
    });
    const result = await runRegistryStateBillNews({
      db,
      live: false,
      now: new Date(Date.UTC(2026, 9, 8)),
      bills: [{ state: "CA", identifier: "AB 1520", stage: "signed" }],
      fetchText,
    });
    expect(fetchText).toHaveBeenCalledTimes(1 + result.states.length);
    expect(result.queries[0]).toMatchObject({ kind: "bill", state: "CA", bill: "AB 1520", items: 1 });
    expect(result.queries.filter((q) => q.kind === "state").every((q) => q.items === 1)).toBe(true);
    expect(result.stored).toBe(0);
    expect(statements.some((s) => s.text.includes("INSERT INTO reg_articles"))).toBe(false);
  });

  it("stops searching once Google News rate limits the run", async () => {
    const { db } = createDb();
    const fetchText = vi.fn(async (url: string) => {
      throw new RegistryHttpError("HTTP 429", url, 429);
    });
    await expect(
      runRegistryStateBillNews({ db, live: false, now: new Date(Date.UTC(2026, 9, 8)), bills: [{ state: "CA", identifier: "AB 1520", stage: null }], fetchText }),
    ).rejects.toThrow(/Every news search failed/);
    expect(fetchText.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
