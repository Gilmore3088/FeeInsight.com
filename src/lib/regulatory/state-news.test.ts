import { describe, expect, it } from "vitest";
import {
  billNewsQuery,
  cleanTitle,
  headlineNamesBill,
  headlineNamesState,
  isBillStory,
  isStateFeeStory,
  dateInText,
  discoverFeedLinks,
  discoverNewsPage,
  emptyHeadlineLabel,
  googleNewsSearchUrl,
  isFeeHeadline,
  isFeedXml,
  parseBillLabel,
  parseNewsPage,
  parseStateFeed,
  readableHeadline,
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

  it("leaves out menus, links named by their own path, and links outside the news list", () => {
    const html = `
      <nav><a href="/news/public-meetings-and-notices">Public Meetings and Notices for Applicants</a></nav>
      <div class="side"><a href="/news/securities-registrations">Securities Registrations &amp; Filings Index</a></div>
      <main>
        <a href="/news/press-releases/2026/one">Division Approves Charter Conversion of Lakeside Savings Bank</a>
        <a href="/news/press-releases/2026/two">Commissioner Issues Bulletin on Overdraft Fee Disclosures to Banks</a>
        <a href="/news/press-releases/2026/three">State Joins Multistate Settlement With Mortgage Servicer</a>
        <a href="/news/press-releases/2026/four">/Pages/About/NewsEvents/NewsReleases/20261006.aspx</a>
      </main>
      <footer><a href="/news/privacy-and-legal-disclaimer">Privacy and legal disclaimer for this site</a></footer>`;
    const items = parseNewsPage(html, "https://dfi.example.gov/news/press-releases", "state:XX");
    expect(items.map((i) => i.title)).toEqual([
      "Division Approves Charter Conversion of Lakeside Savings Bank",
      "Commissioner Issues Bulletin on Overdraft Fee Disclosures to Banks",
      "State Joins Multistate Settlement With Mortgage Servicer",
    ]);
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
    expect(url.searchParams.get("q")).toBe(`"AB 1520" "California" (bank OR "credit union" OR fee OR overdraft OR loan) when:1y`);
  });

  it("reads bill labels and bank fee headlines", () => {
    expect(parseBillLabel("AB 1520 (signed)")).toEqual({ identifier: "AB 1520", stage: "signed" });
    expect(parseBillLabel("HB 1046")).toEqual({ identifier: "HB 1046", stage: null });
    expect(isFeeHeadline("Lawmakers advance overdraft fee cap")).toBe(true);
    expect(isFeeHeadline("Bank opens new branch downtown")).toBe(false);
    // "Junk fee" alone is cable bills and rent, not banking.
    expect(isFeeHeadline("Tong expands junk fee suit against Optimum")).toBe(false);
  });

  // Headlines the first prod run (Oct 8, 2026) returned for these searches.
  it("keeps a bill's stories only when the headline names the state or bill and is on topic", () => {
    expect(isBillStory("Colorado lawmakers face a familiar question as they consider new financial regs: Is a paycheck advance a loan? - The Denver Post", "HB 1046", "Colorado")).toBe(true);
    expect(isBillStory("Trouble Ahead: SB 79 Comes for South Pasadena – What the New Statewide ‘Transit Housing Law’ Actually Is - South Pasadena News", "SB 79", "Colorado")).toBe(false);
    expect(isBillStory("Newsom signs AB 1520, capping overdraft fees - Los Angeles Times", "AB 1520", "California")).toBe(true);
    expect(isBillStory("Will California legislators make changes to contentious new housing law? - Sacramento Bee", "SB 79", "Colorado")).toBe(false);
    expect(isBillStory("Bills beat Browns 23-20 after a 117-yard, 2-TD performance by James Cook - NBC 4 New York", "A 117", "New York")).toBe(false);
    expect(headlineNamesBill("Newsom signs A.B. 1520 on overdraft", "AB 1520")).toBe(true);
  });

  it("keeps a state's stories only when the headline names the state and is about bank fees", () => {
    expect(isStateFeeStory("Arkansas Federal Credit Union class action alleges improper overdraft fees - Top Class Actions", "Arkansas")).toBe(true);
    expect(isStateFeeStory("Why Some Banks Still Charge High Overdraft Fees - The New York Times", "New York")).toBe(false);
    expect(isStateFeeStory("What’s Working: The fees Colorado consumers still face after “junk fee” law has taken effect - The Colorado Sun", "Connecticut")).toBe(false);
    expect(headlineNamesState("West Virginia bank fees rise", "Virginia")).toBe(false);
    expect(headlineNamesState("West Virginia bank fees rise", "West Virginia")).toBe(true);
  });

  it("decodes numeric and double-encoded entities in feed titles", () => {
    expect(cleanTitle("Holiday Schedule &#8211; 10-01-2026")).toBe("Holiday Schedule – 10-01-2026");
    expect(cleanTitle("&amp;#34;The Quarter&amp;#34; Newsletter")).toBe('"The Quarter" Newsletter');
    expect(cleanTitle("Add protection to your &ldquo;Admin Night&rdquo;")).toBe("Add protection to your “Admin Night”");
  });
});

describe("headline readability", () => {
  it("sets all-caps headlines in title case, keeping acronyms and hyphenated names", () => {
    expect(readableHeadline("STATE WARNS PUBLIC ABOUT MISLEADING DOOR-TO-DOOR SOLAR SALES")).toBe(
      "State Warns Public About Misleading Door-to-Door Solar Sales",
    );
    expect(readableHeadline("DCCA DISCIPLINARY ACTIONS (THROUGH AUGUST 2026)")).toBe("DCCA Disciplinary Actions (Through August 2026)");
    expect(readableHeadline("FREE EMISSIONS FIX FOR MERCEDES-BENZ OWNERS")).toBe("Free Emissions Fix for Mercedes-Benz Owners");
    // Mixed case and short labels are the publisher's own and are left alone.
    expect(readableHeadline("DFS proposes limits on bank overdraft fees")).toBe("DFS proposes limits on bank overdraft fees");
    expect(readableHeadline("HB 1046")).toBe("HB 1046");
  });

  it("spots headlines that are only a publication and a date", () => {
    expect(emptyHeadlineLabel("2026-09-17 Electronic Bulletin")).toBe("Electronic bulletin");
    expect(emptyHeadlineLabel("2025-11-26 - Electronic Bulletin")).toBe("Electronic bulletin");
    expect(emptyHeadlineLabel("September 2026 Newsletter")).toBe("Newsletter");
    expect(emptyHeadlineLabel("Report to Agency on Proposed Bulletin")).toBeNull();
    expect(emptyHeadlineLabel("Banking Commissioner Announces 2026 Deposit Index")).toBeNull();
  });
});
