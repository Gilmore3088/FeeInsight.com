import { registryFetch, type RegistryFetchOptions } from "./http";

/**
 * Federal Reserve published data: Beige Book release pages and FRED series.
 * Pure: fetch + parse, no DB.
 */

export const FED_BASE = "https://www.federalreserve.gov";
export const BEIGE_BOOK_INDEX_URL = `${FED_BASE}/monetarypolicy/beige-book-default.htm`;
export const BEIGE_BOOK_ARCHIVE_URL = `${FED_BASE}/monetarypolicy/beige-book-archive.htm`;

/** District slug in the release URL -> Federal Reserve district number. */
export const BEIGE_BOOK_DISTRICTS: Array<{ slug: string; district: number }> = [
  { slug: "boston", district: 1 },
  { slug: "new-york", district: 2 },
  { slug: "philadelphia", district: 3 },
  { slug: "cleveland", district: 4 },
  { slug: "richmond", district: 5 },
  { slug: "atlanta", district: 6 },
  { slug: "chicago", district: 7 },
  { slug: "st-louis", district: 8 },
  { slug: "minneapolis", district: 9 },
  { slug: "kansas-city", district: 10 },
  { slug: "dallas", district: 11 },
  { slug: "san-francisco", district: 12 },
];

export function beigeBookPageUrl(releaseCode: string, part: string): string {
  return `${FED_BASE}/monetarypolicy/beigebook${releaseCode}-${part}.htm`;
}

/** Release codes (YYYYMM) linked from a Beige Book index or archive page. */
export function parseBeigeBookReleaseCodes(html: string): string[] {
  const codes = new Set<string>();
  for (const match of html.matchAll(/beigebook(\d{6})(?:-summary)?\.htm/g)) codes.add(match[1]);
  return [...codes].sort();
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&rsquo;": "’",
  "&lsquo;": "‘",
  "&ldquo;": "“",
  "&rdquo;": "”",
  "&mdash;": "—",
  "&ndash;": "–",
  "&nbsp;": " ",
};

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|li|div|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;|&#\d+;/gi, (entity) => ENTITIES[entity] ?? (entity.startsWith("&#") ? String.fromCharCode(Number(entity.slice(2, -1))) : " "))
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n\n")
    .trim();
}

export interface BeigeBookSection {
  section_name: string;
  content_text: string;
}

export interface BeigeBookPage {
  releaseDate: string | null;
  sections: BeigeBookSection[];
}

/**
 * Splits a release page into its h4 sections. Content runs from the release
 * heading (h2 "Beige Book - August 2026") to the site footer (first h6).
 */
export function parseBeigeBookPage(html: string): BeigeBookPage {
  const start = html.search(/<h2[^>]*>\s*Beige Book/i);
  if (start < 0) return { releaseDate: null, sections: [] };
  const footer = html.indexOf("<h6", start);
  const body = html.slice(start, footer > 0 ? footer : undefined);
  const heading = /<h2[^>]*>\s*Beige Book\s*[-–—]\s*([^<]+)<\/h2>/i.exec(body);
  const sections: BeigeBookSection[] = [];
  const parts = body.split(/<h4[^>]*>/i).slice(1);
  for (const part of parts) {
    const end = part.search(/<\/h4>/i);
    if (end < 0) continue;
    const name = htmlToText(part.slice(0, end));
    const content = htmlToText(part.slice(end + 5));
    if (name && content) sections.push({ section_name: name, content_text: content });
  }
  return { releaseDate: heading ? heading[1].trim() : null, sections };
}

export async function fetchText(url: string, options: RegistryFetchOptions = {}): Promise<string | null> {
  try {
    const response = await registryFetch(url, options);
    return await response.text();
  } catch (error) {
    if (error && typeof error === "object" && "status" in error && (error as { status: number }).status === 404) return null;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// FRED (keyless graph CSV endpoint)
// ---------------------------------------------------------------------------

export function fredCsvUrl(seriesId: string): string {
  return `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}`;
}

export interface FredObservation {
  observation_date: string;
  value: number;
}

/** Parses `DATE,SERIES` (or `observation_date,SERIES`) CSV; "." marks a missing value. */
export function parseFredCsv(csv: string): FredObservation[] {
  const lines = csv.trim().split(/\r?\n/).slice(1);
  const out: FredObservation[] = [];
  for (const line of lines) {
    const [date, raw] = line.split(",");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) continue;
    const value = Number(raw);
    if (raw === undefined || raw.trim() === "." || !Number.isFinite(value)) continue;
    out.push({ observation_date: date.trim(), value });
  }
  return out;
}

/** Series in fed_economic_indicators that come from FRED (other loaders prefix theirs). */
export function isFredNativeSeries(seriesId: string): boolean {
  return !/^(NYFED|OFR|BLS|CU)_/.test(seriesId) && /^[A-Z0-9]+$/.test(seriesId);
}
