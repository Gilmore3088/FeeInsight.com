import { SITE_DOMAIN } from "@/lib/constants";

/**
 * The single identity every outbound pipeline fetch presents. Site operators can read
 * what the bot does and how to reach us at /bot.
 */
export const CRAWLER_USER_AGENT = `FeeInsightBot/1.0 (+https://${SITE_DOMAIN}/bot)`;
