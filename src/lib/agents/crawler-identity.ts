import { SITE_DOMAIN } from "@/lib/constants";

/** Agents that make outbound requests to institution websites. */
export type CrawlerAgent = "Magellan" | "Rosetta";

export const CRAWLER_PRODUCT_TOKEN = "FeeInsightBot";
export const CRAWLER_INFO_URL = `https://${SITE_DOMAIN}/bot`;

/**
 * The identity every outbound pipeline fetch presents. Sites match the shared
 * product token (FeeInsightBot) in robots.txt and allowlists; the bracketed agent
 * name tells anyone reading their logs which agent made the request. Site operators
 * can read what the bot does and how to reach us at /bot.
 */
export function crawlerUserAgent(agent: CrawlerAgent): string {
  return `${CRAWLER_PRODUCT_TOKEN}/1.0 (${agent}; +${CRAWLER_INFO_URL})`;
}
