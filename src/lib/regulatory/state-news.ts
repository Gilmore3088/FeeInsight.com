/**
 * State news to pair with the Open States bills: each state banking regulator's own
 * press releases and bulletins, and news coverage of state bank fee bills.
 *
 * Regulators publish no common format. A regulator's feed is found from its home page
 * (a <link rel="alternate"> RSS/Atom tag, or a link that looks like a feed); without
 * one, its news page (a link named News, Press Releases, Newsroom...) is read as a list
 * of article links. News coverage comes from Google News search RSS, one query per
 * fee bill and one per state for fee legislation.
 *
 * Pure: fetch-free parsing and URL building, no DB. Magellan's registry-state-reg-news
 * and registry-state-bill-news steps fetch and store what this reads.
 */
import { parseFeed, type FeedArticle } from "./news";

export const MAX_STATE_NEWS_ITEMS = 20;

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#8217;/g, "'")
    .replace(/&#821[12];/g, "-");

const stripTags = (s: string) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

function resolve(href: string, baseUrl: string): string | null {
  const clean = decode(href.trim());
  if (!clean || clean.startsWith("#") || /^(mailto|javascript|tel):/i.test(clean)) return null;
  try {
    const url = new URL(clean, baseUrl);
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

/** Host without "www.", so www.dfs.ny.gov and dfs.ny.gov count as one site. */
function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/** Same site, or a subdomain of the same state government site (news.ny.gov for dfs.ny.gov). */
function sameSite(a: string, b: string): boolean {
  const ha = siteOf(a);
  const hb = siteOf(b);
  if (!ha || !hb) return false;
  if (ha === hb || ha.endsWith(`.${hb}`) || hb.endsWith(`.${ha}`)) return true;
  // Agencies on a shared state domain (portal.ct.gov/dob, www.in.gov/dfi): same last two labels.
  const root = (h: string) => h.split(".").slice(-2).join(".");
  return root(ha) === root(hb) && /\.gov$/.test(ha);
}

interface Anchor {
  url: string;
  text: string;
}

function anchors(html: string, baseUrl: string): Anchor[] {
  const out: Anchor[] = [];
  for (const match of html.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = resolve(match[1], baseUrl);
    if (!url) continue;
    const titleAttr = match[0].match(/\btitle\s*=\s*["']([^"']+)["']/i)?.[1];
    const text = stripTags(match[2]) || (titleAttr ? stripTags(titleAttr) : "");
    out.push({ url, text });
  }
  return out;
}

/** True when a response body is an RSS, Atom or RDF feed rather than an HTML page. */
export function isFeedXml(body: string): boolean {
  const head = body.slice(0, 2_000);
  return /<rss[\s>]|<feed[\s>]|<rdf:RDF[\s>]/i.test(head) && !/<html[\s>]/i.test(head);
}

/**
 * Feed URLs a page advertises: <link rel="alternate" type="application/rss+xml"> tags
 * first, then same-site links whose URL or text looks like a feed. Newest-first order
 * is not known, so the page's own order is kept. Comment feeds are skipped.
 */
export function discoverFeedLinks(html: string, baseUrl: string, limit = 4): string[] {
  const urls: string[] = [];
  const add = (url: string | null) => {
    if (url && !urls.includes(url) && !/comments?\/feed|\/comments?\b/i.test(url)) urls.push(url);
  };
  for (const tag of html.matchAll(/<link\b[^>]*>/gi)) {
    const t = tag[0];
    if (!/rel\s*=\s*["'][^"']*alternate/i.test(t)) continue;
    if (!/type\s*=\s*["']application\/(rss|atom)\+xml/i.test(t)) continue;
    const href = t.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    if (href) add(resolve(href, baseUrl));
  }
  for (const a of anchors(html, baseUrl)) {
    if (!sameSite(a.url, baseUrl)) continue;
    const path = (() => {
      try {
        const u = new URL(a.url);
        return `${u.pathname}${u.search}`;
      } catch {
        return "";
      }
    })();
    if (/(\.rss|\.xml|\/rss\/?|\/feed\/?|[?&]format=rss|[?&]feed=)/i.test(path) || /^rss( feed)?$/i.test(a.text)) {
      if (!/sitemap/i.test(path)) add(a.url);
    }
  }
  return urls.slice(0, limit);
}

const NEWS_LINK_TEXT =
  /^(news|newsroom|press|press releases?|press room|media|media center|media releases?|news releases?|news (and|&) (events|announcements|updates|press releases|media|publications)|announcements|latest news|industry (bulletins|notices|news)|bulletins|what's new|whats new|public notices)$/i;
const NEWS_LINK_PATH = /\/(news|newsroom|press|press-releases?|pressreleases|media|announcements|bulletins)(\/|$|\.|-)/i;

/** The regulator's news or press page linked from its home page, best match first. */
export function discoverNewsPage(html: string, baseUrl: string): string[] {
  const byText: string[] = [];
  const byPath: string[] = [];
  for (const a of anchors(html, baseUrl)) {
    if (!sameSite(a.url, baseUrl) || a.url.replace(/\/$/, "") === baseUrl.replace(/\/$/, "")) continue;
    if (NEWS_LINK_TEXT.test(a.text)) {
      if (!byText.includes(a.url)) byText.push(a.url);
    } else if (a.text.length < 40 && NEWS_LINK_PATH.test(new URL(a.url).pathname) && !byPath.includes(a.url)) {
      byPath.push(a.url);
    }
  }
  return [...byText, ...byPath].slice(0, 3);
}

const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DATE_PATTERNS = [
  new RegExp(`\\b(${MONTHS})\\.?\\s+\\d{1,2},?\\s+(19|20)\\d{2}\\b`, "i"),
  /\b\d{1,2}\/\d{1,2}\/(19|20)\d{2}\b/,
  /\b(19|20)\d{2}-\d{2}-\d{2}\b/,
];

/** First date written in a piece of text, as an ISO timestamp; null when none parses. */
export function dateInText(text: string): string | null {
  for (const pattern of DATE_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const date = new Date(match[0].replace(/\./, ""));
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return null;
}

/** Navigation text that is never an article ("Read more", "Next page", "Contact Us"). */
const NAV_TEXT = /^(read more|more|next|previous|back|home|contact( us)?|view all|see all|subscribe|archive|archives|more news|all news)\b/i;
const ARTICLE_PATH = /(news|press|release|announce|bulletin|advisor|notice|alert|statement|media|20\d{2}|19\d{2})/i;

/**
 * Article links on a regulator's news page: same-site links whose text reads like a
 * headline (25-250 characters, not navigation) and whose URL looks like a news item.
 * The date comes from text right after the link when the page prints one there.
 */
export function parseNewsPage(html: string, pageUrl: string, source: string, limit = MAX_STATE_NEWS_ITEMS): FeedArticle[] {
  const out: FeedArticle[] = [];
  const seen = new Set<string>([pageUrl.replace(/\/$/, "")]);
  for (const match of html.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = resolve(match[1], pageUrl);
    if (!url || seen.has(url.replace(/\/$/, ""))) continue;
    const text = stripTags(match[2]);
    if (text.length < 25 || text.length > 250 || NAV_TEXT.test(text)) continue;
    if (!sameSite(url, pageUrl) && !/\.pdf(\?|$)/i.test(url)) continue;
    let path = "";
    try {
      path = decodeURIComponent(new URL(url).pathname);
    } catch {
      continue;
    }
    if (!ARTICLE_PATH.test(path) && !/\.pdf$/i.test(path)) continue;
    seen.add(url.replace(/\/$/, ""));
    const after = stripTags(html.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 300));
    const date = dateInText(text) ?? dateInText(after.slice(0, 120));
    out.push({ guid: url, source, title: text.slice(0, 300), link: url, published_at: date });
    if (out.length >= limit) break;
  }
  return out;
}

/** Feed entries, capped: the shared RSS/Atom reader with this module's limit. */
export function parseStateFeed(xml: string, source: string, limit = MAX_STATE_NEWS_ITEMS): FeedArticle[] {
  return parseFeed(xml, source, limit);
}

/** Words that make a headline about bank or credit union fees. */
const FEE_WORDS =
  /\b(overdraft|nsf|non-?sufficient|insufficient funds|junk fees?|hidden fees?|bank fees?|account fees?|atm fees?|service charges?|maintenance fees?|fee caps?|fees?)\b/i;

/** True when a headline is about fees (any "fee", overdraft, NSF, service charge). */
export function isFeeHeadline(title: string): boolean {
  return FEE_WORDS.test(title);
}

// ---------------------------------------------------------------------------
// News coverage (Google News search RSS)
// ---------------------------------------------------------------------------

export const GOOGLE_NEWS_RSS = "https://news.google.com/rss/search";

/** Google News RSS search URL; `when:1y` keeps it to the last year. */
export function googleNewsSearchUrl(query: string, window = "1y"): string {
  const params = new URLSearchParams({ q: `${query} when:${window}`, hl: "en-US", gl: "US", ceid: "US:en" });
  return `${GOOGLE_NEWS_RSS}?${params.toString()}`;
}

/** Query for one bill: its number in quotes, the state, and "bill". */
export function billNewsQuery(identifier: string, stateName: string): string {
  return `"${identifier}" ${stateName} bill`;
}

/** Query for a state's fee legislation coverage. */
export function stateFeeNewsQuery(stateName: string): string {
  return `"${stateName}" (overdraft OR "junk fee" OR "bank fee" OR "NSF fee") (bill OR legislature OR law)`;
}

/** "AB 1520 (signed)" from a state-bills partition's detail into its number and stage. */
export function parseBillLabel(label: string): { identifier: string; stage: string | null } | null {
  const match = label.trim().match(/^(.+?)\s*(?:\(([^)]+)\))?$/);
  if (!match || !match[1]) return null;
  return { identifier: match[1].trim(), stage: match[2]?.trim() ?? null };
}

/**
 * Google News titles end in " - Publisher". Split that off so the headline reads alone
 * and the publisher is kept for the citation.
 */
export function splitPublisher(title: string): { headline: string; publisher: string | null } {
  const match = title.match(/^(.*\S)\s+-\s+([^-]{2,80})$/);
  return match ? { headline: match[1], publisher: match[2].trim() } : { headline: title, publisher: null };
}

