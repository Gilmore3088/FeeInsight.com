/**
 * Pure helpers Magellan uses to read a bank's website: the site map, robots.txt rules,
 * the platform the site runs on, and whether the homepage is built by JavaScript.
 * No network access.
 */

import { CRAWLER_PRODUCT_TOKEN } from "@/lib/agents/crawler-identity";

const MAX_SITEMAP_URLS = 2_000;

/** `<loc>` URLs from a sitemap or sitemap index, in document order. */
export function sitemapLocations(xml: string): string[] {
  const urls: string[] = [];
  const pattern = /<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)\s*(?:\]\]>)?\s*<\/loc>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null && urls.length < MAX_SITEMAP_URLS) {
    urls.push(match[1].replace(/&amp;/g, "&"));
  }
  return urls;
}

/** True when the document is a sitemap index (its `<loc>` entries are more sitemaps). */
export function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex\b/i.test(xml);
}

/** Sitemap URLs named in robots.txt. */
export function robotsSitemaps(robots: string): string[] {
  return robots
    .split(/\r?\n/)
    .map((line) => /^\s*sitemap\s*:\s*(\S+)/i.exec(line)?.[1])
    .filter((url): url is string => Boolean(url));
}

/**
 * The Disallow rules that apply to our crawler: the group naming our product token if
 * there is one, else the `*` group. An empty Disallow allows everything.
 */
export function robotsDisallows(robots: string, userAgentToken: string = CRAWLER_PRODUCT_TOKEN): string[] {
  const token = userAgentToken.toLowerCase();
  const groups: Array<{ agents: string[]; disallow: string[] }> = [];
  let current: { agents: string[]; disallow: string[] } | null = null;
  let lastWasAgent = false;
  for (const rawLine of robots.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const match = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!match) continue;
    const field = match[1].toLowerCase();
    const value = match[2].trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (field === "disallow" && current && value) current.disallow.push(value);
  }
  const ours = groups.filter((group) => group.agents.some((agent) => agent !== "*" && token.includes(agent)));
  const chosen = ours.length > 0 ? ours : groups.filter((group) => group.agents.includes("*"));
  return chosen.flatMap((group) => group.disallow);
}

/** True when a path is allowed under the given Disallow rules (prefix match, `*` and `$`). */
export function robotsAllows(pathWithQuery: string, disallows: string[]): boolean {
  return !disallows.some((rule) => {
    const anchored = rule.endsWith("$");
    const pattern = (anchored ? rule.slice(0, -1) : rule)
      .split("*")
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*");
    return new RegExp(`^${pattern}${anchored ? "$" : ""}`).test(pathWithQuery);
  });
}

/**
 * Website platforms that place fee documents in predictable spots. The first seven are
 * the `platform_registry` keys (Banno covers Jack Henry sites; Digital Insight is NCR);
 * the rest are recorded so per-platform learning can grow new entries.
 */
const PLATFORM_SIGNATURES: Array<[platform: string, pattern: RegExp]> = [
  ["q2", /q2ebanking|q2online|q2cdn|\bq2-(cms|sdk|content)\b|\.q2\.com/i],
  ["banno", /banno|jackhenry|jhaconnect|goldleaf|jha-?digital/i],
  ["ncr", /d3banking|digitalinsight|\bncr(cdn|digital|\.com)\b/i],
  ["fis", /fisglobal|fis-?digital|digitalone\.fis|ibanking-services\.com|fnfis/i],
  ["fiserv", /fiserv|dicontent|\bmbol\b|onlinebank\.com\/fiserv/i],
  ["kentico", /kentico|\/_\/kcms-doc\//i],
  ["wordpress", /wp-content\/|wp-includes\/|<meta[^>]+generator[^>]+wordpress/i],
  ["drupal", /drupal-settings-json|\/sites\/default\/files\/|<meta[^>]+generator[^>]+drupal|data-drupal/i],
  ["squarespace", /static1\.squarespace\.com|squarespace-cdn/i],
  ["wix", /wixstatic\.com|_wix_browser_sess|<meta[^>]+generator[^>]+wix/i],
  ["finalsite", /finalsite/i],
  ["hubspot", /hs-scripts\.com|\/hubfs\//i],
  ["webflow", /webflow\.(com|io)|data-wf-site/i],
];

export function detectPlatform(html: string): string | null {
  for (const [platform, pattern] of PLATFORM_SIGNATURES) {
    if (pattern.test(html)) return platform;
  }
  return null;
}

/** Counts `<a href>` links in raw HTML. */
export function countAnchors(html: string): number {
  return (html.match(/<a\b[^>]*href\s*=/gi) ?? []).length;
}

/**
 * A homepage whose links are drawn by JavaScript: almost no links in the HTML but a
 * script bundle or an empty app root. A plain download sees nothing to follow there.
 */
export function looksJavaScriptBuilt(html: string): boolean {
  if (countAnchors(html) >= 5) return false;
  return /<script\b[^>]*src=/i.test(html) || /<div[^>]+id=["'](root|app|__next|__nuxt)["'][^>]*>\s*<\/div>/i.test(html);
}

/**
 * A path worth sharing with other banks on the same platform: no dated upload folder or
 * long id that only exists on one site.
 */
export function isReusablePath(pathname: string): boolean {
  if (pathname.length > 120 || pathname === "/" || pathname === "") return false;
  if (/\/(19|20)\d{2}\//.test(pathname)) return false;
  return !/\d{5,}|[0-9a-f]{16,}/i.test(pathname);
}
