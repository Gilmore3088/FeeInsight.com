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

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  ndash: "–",
  mdash: "—",
  hellip: "…",
};

/** HTML entities, named and numeric. "&amp;#8211;" (double-encoded, common in feeds) decodes too. */
function decode(s: string): string {
  let out = s;
  for (let pass = 0; pass < 2 && out.includes("&"); pass += 1) {
    out = out.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] === "#") {
        const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
      }
      return NAMED_ENTITIES[code.toLowerCase()] ?? whole;
    });
  }
  return out;
}

/** A headline as people read it: entities decoded, whitespace collapsed. */
export function cleanTitle(title: string): string {
  return decode(title).replace(/\s+/g, " ").trim();
}

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

/** The same host, or one a subdomain of the other. */
function sameHost(a: string, b: string): boolean {
  const ha = siteOf(a);
  const hb = siteOf(b);
  return Boolean(ha && hb) && (ha === hb || ha.endsWith(`.${hb}`) || hb.endsWith(`.${ha}`));
}

/** Same site, or a subdomain of the same state government site (news.ny.gov for dfs.ny.gov). */
function sameSite(a: string, b: string): boolean {
  const ha = siteOf(a);
  const hb = siteOf(b);
  if (!ha || !hb) return false;
  if (sameHost(a, b)) return true;
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
 * first, then links whose URL or text looks like a feed. Only feeds on the agency's own
 * host count: an agency on a shared state domain often links the whole state's news feed
 * (news.delaware.gov for the Bank Commissioner). Comment feeds are skipped.
 */
export function discoverFeedLinks(html: string, baseUrl: string, limit = 4): string[] {
  const urls: string[] = [];
  const add = (url: string | null) => {
    if (url && sameHost(url, baseUrl) && !urls.includes(url) && !/comments?\/feed|\/comments?\b/i.test(url)) urls.push(url);
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
  const items = readNewsLinks(html, pageUrl, source);
  // When the page lists its own articles under its path (/news/press-releases/2026/...),
  // those are the news; links elsewhere are the site's menus and side panels.
  const base = (() => {
    try {
      return new URL(pageUrl).pathname.replace(/\/[^/]*\.[a-z]+$/i, "/").replace(/\/?$/, "/").toLowerCase();
    } catch {
      return "/";
    }
  })();
  const under = items.filter((item) => {
    try {
      const path = new URL(item.link).pathname.toLowerCase();
      return base !== "/" && path.startsWith(base) && path.length > base.length;
    } catch {
      return false;
    }
  });
  return (under.length >= 3 ? under : items).slice(0, limit);
}

/** Page chrome that holds menus, not news. */
const CHROME = /<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi;

function readNewsLinks(html: string, pageUrl: string, source: string): FeedArticle[] {
  const body = html.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(CHROME, " ");
  const out: FeedArticle[] = [];
  const seen = new Set<string>([pageUrl.replace(/\/$/, "")]);
  for (const match of body.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = resolve(match[1], pageUrl);
    if (!url || seen.has(url.replace(/\/$/, ""))) continue;
    // A link whose text is its own URL or path names no article ("/Pages/About/...", "https://...").
    const text = stripTags(match[2]).replace(/\.pdf$/i, "").trim();
    if (/^(https?:\/\/|\/|www\.)/i.test(text)) continue;
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
    const after = stripTags(body.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 300));
    const date = dateInText(text) ?? dateInText(after.slice(0, 120));
    out.push({ guid: url, source, title: text.slice(0, 300), link: url, published_at: date });
    if (out.length >= 60) break;
  }
  return out;
}

/** Feed entries, capped, with their titles decoded (feeds often double-encode "&#8211;"). */
export function parseStateFeed(xml: string, source: string, limit = MAX_STATE_NEWS_ITEMS): FeedArticle[] {
  return parseFeed(xml, source, limit).map((item) => ({ ...item, title: cleanTitle(item.title) }));
}

/** Words that make a headline about fees. */
const FEE_WORDS =
  /\b(overdraft|nsf|non-?sufficient|insufficient funds|junk fees?|hidden fees?|bank fees?|account fees?|atm fees?|service charges?|maintenance fees?|fee caps?|fees?)\b/i;
/** Words that put a headline in banking: "junk fee" alone also covers cable bills and rent. */
const BANK_WORDS = /\b(overdraft|nsf|non-?sufficient|insufficient funds|banks?|banking|credit unions?|checking|atms?|deposits?|debit cards?)\b/i;

/** True when a headline is about bank or credit union fees: a fee word and a banking word. */
export function isFeeHeadline(title: string): boolean {
  return FEE_WORDS.test(title) && BANK_WORDS.test(title);
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

/**
 * Query for one bill: its number in quotes, the state, and a banking word. A bare bill
 * number matches other states' bills and box scores ("SB 79", "A 117").
 */
export function billNewsQuery(identifier: string, stateName: string): string {
  return `"${identifier}" "${stateName}" (bank OR "credit union" OR fee OR overdraft OR loan)`;
}

/** Query for a state's fee legislation coverage. */
export function stateFeeNewsQuery(stateName: string): string {
  return `"${stateName}" (overdraft OR "bank fee" OR "bank fees" OR "NSF fee" OR "credit union fee") (bill OR legislature OR law)`;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The headline names the state (publisher left off: "NBC 4 New York" says nothing). */
export function headlineNamesState(title: string, stateName: string): boolean {
  const { headline } = splitPublisher(title);
  // "Virginia" inside "West Virginia" is another state.
  return new RegExp(`(?<!West\\s)\\b${escapeRegExp(stateName)}\\b`, "i").test(headline);
}

/** The headline carries the bill number (AB 1520, A.B. 1520, AB1520). */
export function headlineNamesBill(title: string, identifier: string): boolean {
  const { headline } = splitPublisher(title);
  const parts = identifier.match(/^([A-Za-z.\s]+?)\s*(\d+)$/);
  if (!parts) return headline.includes(identifier);
  const letters = parts[1].replace(/[.\s]/g, "").split("").map(escapeRegExp).join("\\.?\\s*");
  return new RegExp(`\\b${letters}\\.?\\s*-?\\s*${parts[2]}\\b`, "i").test(headline);
}

const FINANCE_WORDS = /\b(loans?|lend(ers?|ing)?|payday|paycheck|financial|finance|consumers?)\b/i;

/**
 * A story about this bill: the headline names the state or the bill, and is about banking,
 * fees or consumer finance (or names the bill outright).
 */
export function isBillStory(title: string, identifier: string, stateName: string): boolean {
  const { headline } = splitPublisher(title);
  const onTopic = FEE_WORDS.test(headline) || BANK_WORDS.test(headline) || FINANCE_WORDS.test(headline);
  // A bill number alone is not enough: other states reuse it ("SB 79" is also a California
  // housing law), so a story naming only the number must also be on topic.
  if (headlineNamesState(title, stateName)) return onTopic || headlineNamesBill(title, identifier);
  return onTopic && headlineNamesBill(title, identifier);
}

/** A story about this state's bank fees: the headline names the state and is about bank fees. */
export function isStateFeeStory(title: string, stateName: string): boolean {
  return headlineNamesState(title, stateName) && isFeeHeadline(splitPublisher(title).headline);
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

