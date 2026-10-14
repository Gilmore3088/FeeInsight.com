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
 */
export const OWN_SITE_MAX_USES = 2;

type WebSearchTool = Anthropic.WebSearchTool20250305;

/** A web search tool with no domain limit. */
export function webSearchTool(maxUses: number): WebSearchTool {
  return { type: "web_search_20250305", name: "web_search", max_uses: maxUses };
}

/** The site a bank's search is limited to, or null when it searches the open web. */
export function ownSiteDomain(row: { website_url: string | null | undefined; asset_size?: number | string | null }): string | null {
  const assets = Number(row.asset_size ?? 0);
  if (Number.isFinite(assets) && assets >= LARGE_BANK_ASSETS) return null;
  const host = row.website_url ? websiteHost(row.website_url) : null;
  // A dotless host ("localhost") cannot be an allowed domain; the API rejects it.
  return host && host.includes(".") ? host : null;
}

/**
 * The tool for a search for a bank's own document: its own site at most `OWN_SITE_MAX_USES`
 * times, or the open web at `openWebMaxUses` for a $10B+ bank or a bank with no usable host.
 * The domain list covers the host's subdomains.
 */
export function bankWebSearchTool(
  row: { website_url: string | null | undefined; asset_size?: number | string | null },
  openWebMaxUses: number,
): WebSearchTool {
  const domain = ownSiteDomain(row);
  if (!domain) return webSearchTool(openWebMaxUses);
  return { ...webSearchTool(Math.min(OWN_SITE_MAX_USES, openWebMaxUses)), allowed_domains: [domain] };
}

