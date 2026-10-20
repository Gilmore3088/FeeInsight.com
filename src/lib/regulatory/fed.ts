import { registryFetch, type RegistryFetchOptions } from "./http";

/**
 * Federal Reserve published data (Beige Book release pages, FOMC minutes) and the BLS CPI
 * helpers. Pure: fetch + parse, no DB. The economic indicator catalogue (each series from its
 * original publisher; FRED is no longer read, 2026-10-18) is in ./federal-indicators.
 */

export const FED_BASE = "https://www.federalreserve.gov";

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

export interface IndicatorObservation {
  observation_date: string;
  value: number;
}

/**
 * CPI-U "Checking account and other bank services" (item SS68021, U.S. city average, not seasonally
 * adjusted). Until 2026-10-07 the app read CUUR0000SEMC01 under this name, but SEMC is medical
 * "Professional services" and SEMC01 is physicians' services.
 */
export const CPI_BANK_SERVICES_SERIES = "CUUR0000SS68021";
/** CPI-U "Financial services" (item SEGD05), the group that holds bank services. */
export const CPI_FINANCIAL_SERVICES_SERIES = "CUUR0000SEGD05";

/** Titles for BLS series we track, applied on every refresh so a wrong stored label is corrected. */
export const BLS_SERIES_TITLES: Record<string, string> = {
  CUUR0000SA0: "CPI: All Items (not seasonally adjusted)",
  [CPI_BANK_SERVICES_SERIES]: "CPI: Checking Account and Other Bank Services",
  [CPI_FINANCIAL_SERVICES_SERIES]: "CPI: Financial Services",
  CUUR0000SEMC01: "CPI: Physicians' Services (medical; not a bank series)",
  CUUR0000SEMC02: "CPI: Dental Services (medical; not a bank series)",
  CUUR0100SEMC: "CPI: Medical Professional Services, Northeast",
  CUUR0200SEMC: "CPI: Medical Professional Services, Midwest",
  CUUR0300SEMC: "CPI: Medical Professional Services, South",
  CUUR0400SEMC: "CPI: Medical Professional Services, West",
};

/** BLS CPI series ids (CUUR... not seasonally adjusted, CUSR... adjusted). */
export function isBlsSeries(seriesId: string): boolean {
  return /^CU[US]R[0-9A-Z]+$/.test(seriesId);
}

// ---------------------------------------------------------------------------
// BLS public data API (keyless v1; v2 with BLS_API_KEY raises the daily limit)
// ---------------------------------------------------------------------------

/** Calendar years requested from BLS, so a 5-year chart of 12-month changes is complete. */
export const BLS_YEARS = 7;

export interface BlsSeriesRequest {
  url: string;
  json: { seriesid: string[]; startyear: string; endyear: string; registrationkey?: string; catalog?: boolean };
}

/**
 * A plain GET returns only about 3 years, so the request is a POST with start and
 * end years (both API versions allow up to 10 years per request).
 */
export function blsSeriesRequest(seriesId: string, apiKey?: string | null, now = new Date()): BlsSeriesRequest {
  const endYear = now.getUTCFullYear();
  return {
    url: apiKey
      ? "https://api.bls.gov/publicAPI/v2/timeseries/data/"
      : "https://api.bls.gov/publicAPI/v1/timeseries/data/",
    json: {
      seriesid: [seriesId],
      startyear: String(endYear - BLS_YEARS + 1),
      endyear: String(endYear),
      // v2 with a key returns BLS's own catalog title, which the run ledger records as proof of the series.
      ...(apiKey ? { registrationkey: apiKey, catalog: true } : {}),
    },
  };
}

interface BlsResponse {
  status?: string;
  message?: string[];
  Results?: {
    series?: Array<{ seriesID?: string; catalog?: { series_title?: string }; data?: Array<{ year?: string; period?: string; value?: string }> }>;
  };
}

/** BLS's own title for the series (v2 with catalog=true only); null otherwise. */
export function parseBlsCatalogTitle(body: unknown): string | null {
  const title = (body as BlsResponse)?.Results?.series?.[0]?.catalog?.series_title;
  return typeof title === "string" && title.trim() ? title.trim() : null;
}

export const FOMC_CALENDAR_URL = `${FED_BASE}/monetarypolicy/fomccalendars.htm`;

export function fomcMinutesUrl(meetingDate: string): string {
  return `${FED_BASE}/monetarypolicy/fomcminutes${meetingDate.replace(/-/g, "")}.htm`;
}

/** Meeting dates (YYYY-MM-DD) whose minutes are linked from the FOMC calendar page, newest first. */
export function parseFomcMinutesDates(html: string): string[] {
  const dates = new Set<string>();
  for (const match of html.matchAll(/fomcminutes(\d{4})(\d{2})(\d{2})\.htm/g)) dates.add(`${match[1]}-${match[2]}-${match[3]}`);
  return [...dates].sort().reverse();
}

/** The minutes' text: the article body when the page marks one, else the page between its h3 title and footer. */
export function parseFomcMinutesPage(html: string): { title: string | null; text: string } {
  const title = /<h3[^>]*>\s*(Minutes of the Federal Open Market Committee[^<]*)<\/h3>/i.exec(html)?.[1]?.trim() ?? null;
  const article = html.search(/<div[^>]+id="article"/i);
  const start = article >= 0 ? article : Math.max(0, html.search(/<h3[^>]*>\s*Minutes of the Federal Open Market Committee/i));
  const footer = html.indexOf("<h6", start);
  return { title, text: htmlToText(html.slice(start, footer > start ? footer : undefined)).slice(0, 300_000) };
}
