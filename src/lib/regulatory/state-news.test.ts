import { describe, expect, it } from "vitest";
import {
  billNewsQuery,
  dateInText,
  discoverFeedLinks,
  discoverNewsPage,
  googleNewsSearchUrl,
  isFeeHeadline,
  isFeedXml,
  parseBillLabel,
  parseNewsPage,
  parseStateFeed,
  splitPublisher,
} from "./state-news";

const HOME = `<html><head>
<link rel="alternate" type="application/rss+xml" title="Press" href="/feeds/press.xml">
<link rel="alternate" type="application/rss+xml" href="/comments/feed/">
</head><body>
<nav><a href="/about">About</a><a href="/newsroom">Newsroom</a><a href="https://twitter.com/x">Twitter</a>
<a href="/news-and-events/">News &amp; Events</a><a href="/rss">RSS</a></nav></body></html>`;

describe("state regulator discovery", () => {
  it("finds advertised feeds first, skips comment feeds, and adds same-site feed links", () => {
    expect(discoverFeedLinks(HOME, "https://dfi.example.gov")).toEqual([
      "https://dfi.example.gov/feeds/press.xml",
      "https://dfi.example.gov/rss",
    ]);
  });

  it("finds the news page by its link text", () => {
    expect(discoverNewsPage(HOME, "https://dfi.example.gov")).toEqual([
      "https://dfi.example.gov/newsroom",
      "https://dfi.example.gov/news-and-events/",
    ]);
  });

  it("treats a shared state domain as the same site", () => {
    const html = `<a href="https://portal.ct.gov/dob/newsroom">Press Releases</a><a href="https://example.com/news">News</a>`;
    expect(discoverNewsPage(html, "https://portal.ct.gov/dob")).toEqual(["https://portal.ct.gov/dob/newsroom"]);
  });

  it("tells a feed from an HTML page", () => {
    expect(isFeedXml(`<?xml version="1.0"?><rss version="2.0"><channel>`)).toBe(true);
    expect(isFeedXml(`<feed xmlns="http://www.w3.org/2005/Atom">`)).toBe(true);
    expect(isFeedXml(`<!doctype html><html><body>rss</body></html>`)).toBe(false);
  });
});

describe("news page reader", () => {
  it("keeps headline links with their dates and drops navigation", () => {
    const html = `
      <a href="/news/2026/commissioner-announces-overdraft-guidance">Commissioner Announces Guidance on Overdraft Fees for State Banks</a>
      <span class="date">September 30, 2026</span>
      <a href="/news/2026/bank-merger-approved">Department Approves Merger of Two Community Banks in Eastern County</a> - 09/12/2026
      <a href="/news">Read more news and announcements here</a>
      <a href="/about/leadership">Meet the Commissioner and the Leadership Team Members</a>
      <a href="https://other.example.com/news/story">An outside story that is long enough to count here</a>
      <a href="/files/2026-08-bulletin.pdf">Industry Bulletin 2026-08 on Account Fee Disclosures</a>`;
    const items = parseNewsPage(html, "https://dfi.example.gov/news", "state:XX");
    expect(items.map((i) => i.title)).toEqual([
      "Commissioner Announces Guidance on Overdraft Fees for State Banks",
      "Department Approves Merger of Two Community Banks in Eastern County",
      "Industry Bulletin 2026-08 on Account Fee Disclosures",
    ]);
    expect(items[0].published_at?.slice(0, 10)).toBe("2026-09-30");
    expect(items[1].published_at?.slice(0, 10)).toBe("2026-09-12");
    expect(items[0]).toMatchObject({ source: "state:XX", link: "https://dfi.example.gov/news/2026/commissioner-announces-overdraft-guidance" });
  });

  it("reads written and numeric dates", () => {
    expect(dateInText("Posted Oct. 3, 2026 by staff")?.slice(0, 10)).toBe("2026-10-03");
    expect(dateInText("2026-07-01 release")?.slice(0, 10)).toBe("2026-07-01");
    expect(dateInText("no date here")).toBeNull();
  });
});

describe("news coverage", () => {
  const GOOGLE = `<?xml version="1.0"?><rss version="2.0"><channel><title>"AB 1520" California bill</title>
    <item><title>Newsom signs bill capping overdraft fees - Los Angeles Times</title>
      <link>https://news.google.com/rss/articles/abc?oc=5</link>
      <guid isPermaLink="false">abc</guid><pubDate>Mon, 13 Oct 2025 07:00:00 GMT</pubDate>
      <description>&lt;a href="https://news.google.com/rss/articles/abc"&gt;Newsom signs&lt;/a&gt;</description>
      <source url="https://www.latimes.com">Los Angeles Times</source></item>
  </channel></rss>`;

  it("parses Google News RSS items", () => {
    const [item] = parseStateFeed(GOOGLE, "news:CA");
    expect(item).toMatchObject({
      title: "Newsom signs bill capping overdraft fees - Los Angeles Times",
      link: "https://news.google.com/rss/articles/abc?oc=5",
      source: "news:CA",
      published_at: "2025-10-13T07:00:00.000Z",
    });
    expect(splitPublisher(item.title)).toEqual({ headline: "Newsom signs bill capping overdraft fees", publisher: "Los Angeles Times" });
  });

  it("builds one-year search URLs and queries", () => {
    const url = new URL(googleNewsSearchUrl(billNewsQuery("AB 1520", "California")));
    expect(url.origin + url.pathname).toBe("https://news.google.com/rss/search");
    expect(url.searchParams.get("q")).toBe(`"AB 1520" California bill when:1y`);
  });

  it("reads bill labels and fee headlines", () => {
    expect(parseBillLabel("AB 1520 (signed)")).toEqual({ identifier: "AB 1520", stage: "signed" });
    expect(parseBillLabel("HB 1046")).toEqual({ identifier: "HB 1046", stage: null });
    expect(isFeeHeadline("Lawmakers advance overdraft fee cap")).toBe(true);
    expect(isFeeHeadline("Bank opens new branch downtown")).toBe(false);
  });
});
