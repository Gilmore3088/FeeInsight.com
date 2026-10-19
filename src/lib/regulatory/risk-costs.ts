import { publishedNumber } from "./economy";
import { registryFetch, RegistryHttpError, type RegistryFetchOptions } from "./http";

/**
 * Small pure helpers shared by the risk-and-cost loaders (US Courts bankruptcy, USDA farm,
 * BLS OEWS). No DB access.
 */

/** First URL that answers; 404 and 403 move on to the next candidate, other errors throw. */
export async function fetchFirstAvailable(
  urls: string[],
  options: RegistryFetchOptions = {},
): Promise<{ url: string; response: Response } | { url: null; tried: string[] }> {
  for (const url of urls) {
    try {
      return { url, response: await registryFetch(url, options) };
    } catch (error) {
      if (error instanceof RegistryHttpError && (error.status === 404 || error.status === 403 || error.status === 410)) continue;
      throw error;
    }
  }
  return { url: null, tried: urls };
}

export interface PageLink {
  href: string;
  text: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeHtml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Every <a href> on a page, resolved against `base`, with its visible text. */
export function pageLinks(html: string, base: string): PageLink[] {
  const out: PageLink[] = [];
  for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi)) {
    const raw = decodeHtml((m[1] ?? m[2] ?? "").trim());
    if (!raw || raw.startsWith("#") || /^(mailto|javascript):/i.test(raw)) continue;
    let href: string;
    try {
      href = new URL(raw, base).toString();
    } catch {
      continue;
    }
    const text = decodeHtml(m[3].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    out.push({ href, text });
  }
  return out;
}

/** A value as published: the number, or null with the publisher's flag ("*", "#", "(D)", "-"). */
export function valueWithFlag(cell: unknown): { value: number | null; flag: string | null } {
  const value = publishedNumber(cell);
  if (value !== null) return { value, flag: null };
  const text = cell === null || cell === undefined ? "" : String(cell).trim();
  return { value: null, flag: text === "" ? null : text.slice(0, 40) };
}

export function bump(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

/** Lower snake case slug for a series key part. */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}
