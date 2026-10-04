"use server";

import { getCurrentUser } from "@/lib/auth";
import { FEEDS, storeArticles } from "@/lib/data-store/news";

interface FeedEntry {
  title?: string;
  link?: string;
  id?: string;
  pubDate?: string;
  "dc:date"?: string;
  published?: string;
  updated?: string;
}

/**
 * Minimal RSS/Atom XML parser. Extracts <item> or <entry> elements.
 * No external dependencies — uses regex extraction.
 */
function parseRss(xml: string): FeedEntry[] {
  const entries: FeedEntry[] = [];

  // Match both RSS <item> and Atom <entry> blocks
  const itemRegex = /<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];

    const title = extractTag(block, "title");
    // Atom uses <link href="..."/>, RSS uses <link>...</link>
    const link = extractAtomLink(block) || extractTag(block, "link");
    const guid = extractTag(block, "guid") || extractTag(block, "id");
    const pubDate =
      extractTag(block, "pubDate") ||
      extractTag(block, "dc:date") ||
      extractTag(block, "published") ||
      extractTag(block, "updated");

    if (title && link) {
      entries.push({ title, link, id: guid || link, pubDate: pubDate || undefined });
    }
  }

  return entries;
}

function extractTag(xml: string, tag: string): string | null {
  // Handle CDATA
  const cdataRegex = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, "i");
  const cdataMatch = xml.match(cdataRegex);
  if (cdataMatch) return cdataMatch[1].trim();

  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = xml.match(regex);
  return m ? decodeEntities(m[1].trim()) : null;
}

function extractAtomLink(xml: string): string | null {
  // <link rel="alternate" href="..."/>
  const m = xml.match(/<link[^>]*href="([^"]+)"[^>]*\/?>/i);
  return m ? m[1] : null;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function parseDate(dateStr: string | undefined): string | null {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}

const MAX_ENTRIES_PER_FEED = 20;
const FETCH_TIMEOUT = 10_000;

export async function refreshFeeds(): Promise<{
  fetched: number;
  inserted: number;
  errors: string[];
}> {
  const user = await getCurrentUser();
  // Feed ingestion writes shared data: operators only.
  if (!user || (user.role !== "admin" && user.role !== "analyst")) {
    throw new Error("Unauthorized");
  }

  const allArticles: {
    guid: string;
    source: string;
    title: string;
    link: string;
    published_at: string | null;
  }[] = [];
  const errors: string[] = [];

  const fetchPromises = Object.entries(FEEDS).map(async ([source, url]) => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

      const resp = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "FeeInsight-News/1.0 (+https://feeinsight.com)" },
      });
      clearTimeout(timeout);

      if (!resp.ok) {
        errors.push(`${source}: HTTP ${resp.status}`);
        return;
      }

      const xml = await resp.text();
      const entries = parseRss(xml).slice(0, MAX_ENTRIES_PER_FEED);

      for (const entry of entries) {
        if (!entry.title || !entry.link) continue;
        allArticles.push({
          guid: entry.id || entry.link,
          source,
          title: entry.title.slice(0, 300),
          link: entry.link,
          published_at: parseDate(entry.pubDate),
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      errors.push(`${source}: ${msg}`);
    }
  });

  await Promise.all(fetchPromises);

  const inserted = await storeArticles(allArticles);

  return { fetched: allArticles.length, inserted, errors };
}
