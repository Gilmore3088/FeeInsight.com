/**
 * Regulator press-release feeds (Fed, FDIC, OCC, CFPB): RSS/Atom fetch + parse.
 * Pure: no DB. Magellan's registry-reg-news step stores what this returns.
 */

export interface FeedArticle {
  guid: string;
  source: string;
  title: string;
  link: string;
  published_at: string | null;
}

export const MAX_ENTRIES_PER_FEED = 20;

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function extractTag(xml: string, tag: string): string | null {
  const cdata = xml.match(new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, "i"));
  if (cdata) return cdata[1].trim();
  const plain = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return plain ? decodeEntities(plain[1].trim()) : null;
}

function extractAtomLink(xml: string): string | null {
  const match = xml.match(/<link[^>]*href="([^"]+)"[^>]*\/?>/i);
  return match ? match[1] : null;
}

function parseDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** RSS <item> and Atom <entry> blocks with a title and link, newest-first as the feed lists them. */
export function parseFeed(xml: string, source: string, limit = MAX_ENTRIES_PER_FEED): FeedArticle[] {
  const out: FeedArticle[] = [];
  for (const match of xml.matchAll(/<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/gi)) {
    const block = match[1];
    const title = extractTag(block, "title");
    const link = extractAtomLink(block) || extractTag(block, "link");
    if (!title || !link) continue;
    const guid = extractTag(block, "guid") || extractTag(block, "id") || link;
    const date =
      extractTag(block, "pubDate") || extractTag(block, "dc:date") || extractTag(block, "published") || extractTag(block, "updated");
    out.push({ guid, source, title: title.slice(0, 300), link, published_at: parseDate(date) });
    if (out.length >= limit) break;
  }
  return out;
}
