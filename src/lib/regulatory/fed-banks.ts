/**
 * Publications of the 12 regional Federal Reserve Banks (research, regional economic
 * reports, speeches), read from their RSS feeds. The main source is Fed in Print, the
 * Federal Reserve System's publication index run by the St. Louis Fed, which lists one
 * feed per Reserve Bank on fedinprint.org/rss; the feeds are found on that page at run
 * time rather than hard-coded. A few banks' own feeds are kept as a fallback for a bank
 * the index page doesn't link.
 * Pure: fetch + parse, no DB. Magellan's registry-fed-publications step stores what this
 * returns in fed_publications.
 */
import { parseFeed, type FeedArticle } from "./news";

export const FED_IN_PRINT_RSS_INDEX = "https://fedinprint.org/rss";

export interface ReserveBank {
  district: number;
  name: string;
  /** Matches the bank in a feed link's text or URL. */
  pattern: RegExp;
  /** The bank's own feeds, tried only when Fed in Print has none for it. */
  fallbackFeeds: string[];
}

export const RESERVE_BANKS: ReserveBank[] = [
  { district: 1, name: "Boston", pattern: /boston/i, fallbackFeeds: ["https://www.bostonfed.org/feeds/rss_speeches.xml"] },
  { district: 2, name: "New York", pattern: /new[\s_-]?york|\bny\b/i, fallbackFeeds: ["https://www.newyorkfed.org/research/rss/feeds/ci.xml"] },
  { district: 3, name: "Philadelphia", pattern: /philadelphia/i, fallbackFeeds: [] },
  { district: 4, name: "Cleveland", pattern: /cleveland/i, fallbackFeeds: [] },
  { district: 5, name: "Richmond", pattern: /richmond/i, fallbackFeeds: [] },
  { district: 6, name: "Atlanta", pattern: /atlanta/i, fallbackFeeds: ["https://www.atlantafed.org/rss/speechindex"] },
  { district: 7, name: "Chicago", pattern: /chicago/i, fallbackFeeds: [] },
  { district: 8, name: "St. Louis", pattern: /st\.?[\s_-]?louis|stlouis/i, fallbackFeeds: [] },
  { district: 9, name: "Minneapolis", pattern: /minneapolis/i, fallbackFeeds: [] },
  { district: 10, name: "Kansas City", pattern: /kansas[\s_-]?city/i, fallbackFeeds: [] },
  { district: 11, name: "Dallas", pattern: /dallas/i, fallbackFeeds: ["https://www.dallasfed.org/rss/speeches"] },
  { district: 12, name: "San Francisco", pattern: /san[\s_-]?francisco|frbsf/i, fallbackFeeds: [] },
];

const stripTags = (html: string): string => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/**
 * Feed links on the Fed in Print RSS page, by district. A link counts as a feed when its
 * URL looks like one (rss, xml, feed); it belongs to the bank its text or URL names.
 */
export function discoverReserveBankFeeds(html: string, baseUrl = FED_IN_PRINT_RSS_INDEX): Map<number, string[]> {
  const feeds = new Map<number, string[]>();
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = match[1].replace(/&amp;/g, "&");
    if (!/rss|\.xml|feed/i.test(href)) continue;
    let url: string;
    try {
      url = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    if (url.replace(/\/$/, "") === baseUrl.replace(/\/$/, "")) continue;
    const label = `${stripTags(match[2])} ${href}`;
    const bank = RESERVE_BANKS.find((candidate) => candidate.pattern.test(label));
    if (!bank) continue;
    const list = feeds.get(bank.district) ?? [];
    if (!list.includes(url)) list.push(url);
    feeds.set(bank.district, list);
  }
  return feeds;
}

export interface FedPublication extends FeedArticle {
  district: number;
  bank: string;
  feed_url: string;
}

export const MAX_ENTRIES_PER_BANK_FEED = 30;

export function parseReserveBankFeed(xml: string, bank: ReserveBank, feedUrl: string): FedPublication[] {
  return parseFeed(xml, `FRB ${bank.name}`, MAX_ENTRIES_PER_BANK_FEED).map((article) => ({
    ...article,
    district: bank.district,
    bank: bank.name,
    feed_url: feedUrl,
  }));
}
