import type { Anthropic } from "@/lib/ai-provider";

import { LARGE_BANK_ASSETS, websiteHost } from "./link-coverage";

/**
 * The web search tool Magellan's paid searches send (#1035).
 *
 * Search results are most of a paid search's cost: in the 10 days to 2026-10-11 a schedule
 * search averaged 26,252 input tokens and 5.5 cents, about 10,000 tokens and 1 cent per search
 * it ran, and 1,034 of its 1,212 calls used all three searches it was allowed. The tool has no
 * setting for the number of results a search returns, and the find model (Haiku 4.5) cannot
 * use the newer tool that filters results before the model reads them, so two settings are
 * left: the searches per call (`max_uses`) and the sites a search may return (`allowed_domains`).
 *
 * A bank under $10B is searched on its own site only, at most twice: 232 of the schedule
 * search's 235 finds and all 113 of the paid web search's finds in those 14 days were on the
 * bank's website host, and every answer off it fails `onBankDomain` anyway. Banks of $10B or
 * more keep the open web and the finder's own limit, because large banks post their schedules
 * on a parent company's domain (Citi's is on citigroup.com) that cannot be listed in advance.
 *
 * Follow-ups (#1251):
 * - "Its own site" also covers the other hosts the bank is known to own (`own-hosts.ts`), so a
 *   bank that moved to machiassavings.bank is not searched only on machiassavings.com.
 * - A bank with no asset size on file searches the open web: it may be a $10B+ bank.
 * - A host the API may refuse (an IP address, a trailing dot, odd characters) or a third-party
 *   host stored as the website (a bot check, a social page) searches the open web.
 */
export const OWN_SITE_MAX_USES = 2;
/** Most sites one search is limited to: the website and up to three other own hosts. */
export const MAX_SITE_DOMAINS = 4;

type WebSearchTool = Anthropic.WebSearchTool20250305;

/** A web search tool with no domain limit. */
export function webSearchTool(maxUses: number): WebSearchTool {
  return { type: "web_search_20250305", name: "web_search", max_uses: maxUses };
}

/**
 * A host name the API takes as an allowed domain: dotted labels of letters, digits and hyphens,
 * ending in a letter label. Rejects IP addresses, a trailing dot and dotless names ("localhost").
 */
const SEARCH_HOST = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Hosts stored as a bank's website that are not the bank's site: a bot check, a social page, a
 * free site builder (2 active institutions had `validate.perfdrive.com` on 2026-10-14).
 */
const THIRD_PARTY_HOST = /(^|\.)(perfdrive\.com|facebook\.com|google\.com|linkedin\.com|yelp\.com|instagram\.com|twitter\.com|x\.com)$/;

/** True when a search can be limited to this host. */
export function usableSearchHost(host: string | null | undefined): host is string {
  return Boolean(host) && SEARCH_HOST.test(host as string) && !THIRD_PARTY_HOST.test(host as string);
}

/** Assets in thousands, or null when none is on file. */
function knownAssets(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const assets = Number(value);
  return Number.isFinite(assets) && assets > 0 ? assets : null;
}

export interface BankSearchSite {
  website_url: string | null | undefined;
  asset_size?: number | string | null;
}

/**
 * The sites a bank's search is limited to, the website host first, or null when it searches
 * the open web: a $10B+ bank, a bank with no asset size, or a website with no usable host.
 * `ownHosts` are the other hosts the bank owns (`own-hosts.ts`); unusable ones are dropped.
 */
export function ownSiteDomains(row: BankSearchSite, ownHosts: readonly string[] = []): string[] | null {
  const assets = knownAssets(row.asset_size);
  if (assets == null || assets >= LARGE_BANK_ASSETS) return null;
  const host = row.website_url ? websiteHost(row.website_url) : null;
  if (!usableSearchHost(host)) return null;
  const domains = [host];
  for (const other of ownHosts) {
    if (usableSearchHost(other) && !domains.includes(other)) domains.push(other);
  }
  return domains.slice(0, MAX_SITE_DOMAINS);
}

/**
 * The tool for a search for a bank's own document: its own sites at most `OWN_SITE_MAX_USES`
 * times, or the open web at `openWebMaxUses`. The domain list covers each host's subdomains.
 */
export function bankWebSearchTool(row: BankSearchSite, openWebMaxUses: number, ownHosts: readonly string[] = []): WebSearchTool {
  return webSearchToolFor(ownSiteDomains(row, ownHosts), openWebMaxUses);
}

/** The tool for an already chosen site list (null for the open web). */
export function webSearchToolFor(domains: string[] | null, openWebMaxUses: number): WebSearchTool {
  if (!domains) return webSearchTool(openWebMaxUses);
  return { ...webSearchTool(Math.min(OWN_SITE_MAX_USES, openWebMaxUses)), allowed_domains: domains };
}

/**
 * The prompt's rule for where the answer may be. A site-limited search cannot reach a parent
 * company's domain, so it is not offered one.
 */
export function domainRule(websiteHostOrUrl: string, domains: string[] | null): string {
  if (!domains) return `- The URL must be on the bank's own domain (${websiteHostOrUrl}, a subdomain of it, or its parent company's domain).`;
  return `- The URL must be on the bank's own site (${domains.join(" or ")}, or a subdomain of it).`;
}
