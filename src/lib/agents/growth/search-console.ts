import { createSign } from "node:crypto";

/**
 * Google Search Console reads for the weekly growth score (step `growth-score`). Free and
 * read-only: a service account signs its own token (RS256 JWT with node:crypto, no Google SDK),
 * trades it for an access token, and asks Search Analytics for clicks, impressions, average
 * position and the top pages. Nothing is written to Google and no model is called.
 *
 * Env: `GSC_SERVICE_ACCOUNT_JSON` (the service-account key JSON; the account must be added as a
 * user on the Search Console property) and `GSC_SITE_URL` (default `sc-domain:feeinsight.com`).
 *
 * Search Console data lags about 3 days, so the window ends `GSC_LAG_DAYS` before today (UTC):
 * "this week" is the 7 days ending then, "the week before" the 7 days before that.
 */

export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
export const GSC_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GSC_DEFAULT_SITE = "sc-domain:feeinsight.com";
export const GSC_LAG_DAYS = 3;
export const GSC_WINDOW_DAYS = 7;
export const GSC_TOP_PAGES = 10;
export const GSC_NOT_CONFIGURED = "GSC_SERVICE_ACCOUNT_JSON is not set; Search Console is not read.";
const DAY_MS = 86_400_000;

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export function searchConsoleConfigured(): boolean {
  return Boolean((process.env.GSC_SERVICE_ACCOUNT_JSON || "").trim());
}

export function searchConsoleSite(): string {
  return (process.env.GSC_SITE_URL || "").trim() || GSC_DEFAULT_SITE;
}

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export function parseServiceAccount(raw: string): ServiceAccountKey {
  let parsed: Partial<ServiceAccountKey>;
  try {
    parsed = JSON.parse(raw) as Partial<ServiceAccountKey>;
  } catch {
    throw new Error("GSC_SERVICE_ACCOUNT_JSON is not valid JSON.");
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("GSC_SERVICE_ACCOUNT_JSON has no client_email or private_key.");
  }
  // Keys pasted into env vars often carry literal "\n" instead of newlines.
  return { client_email: parsed.client_email, private_key: parsed.private_key.replace(/\\n/g, "\n"), token_uri: parsed.token_uri };
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

/** The signed assertion Google's token endpoint takes for a service account (RFC 7523). */
export function signServiceAccountJwt(key: ServiceAccountKey, now: Date = new Date()): string {
  const iat = Math.floor(now.getTime() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({ iss: key.client_email, scope: GSC_SCOPE, aud: GSC_TOKEN_URL, iat, exp: iat + 3600 }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  signer.end();
  return `${header}.${claims}.${base64url(signer.sign(key.private_key))}`;
}

async function accessToken(key: ServiceAccountKey, fetcher: FetchLike, now: Date): Promise<string> {
  const response = await fetcher(GSC_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: signServiceAccountJwt(key, now) }).toString(),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as { access_token?: string; error?: string; error_description?: string } | null;
  if (!response.ok || !body?.access_token) {
    throw new Error(`Google token exchange answered ${response.status}: ${body?.error_description ?? body?.error ?? "no access token"}`);
  }
  return body.access_token;
}

export interface SearchWindow {
  startDate: string;
  endDate: string;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** This week (7 days ending `GSC_LAG_DAYS` before today, UTC) and the 7 days before it. */
export function searchWindows(now: Date = new Date()): { thisWeek: SearchWindow; weekBefore: SearchWindow } {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const end = today - GSC_LAG_DAYS * DAY_MS;
  const start = end - (GSC_WINDOW_DAYS - 1) * DAY_MS;
  const priorEnd = start - DAY_MS;
  const priorStart = priorEnd - (GSC_WINDOW_DAYS - 1) * DAY_MS;
  return {
    thisWeek: { startDate: isoDate(new Date(start)), endDate: isoDate(new Date(end)) },
    weekBefore: { startDate: isoDate(new Date(priorStart)), endDate: isoDate(new Date(priorEnd)) },
  };
}

interface RawRow {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
}

export function searchAnalyticsUrl(site: string): string {
  return `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`;
}

async function query(
  site: string,
  token: string,
  body: Record<string, unknown>,
  fetcher: FetchLike,
): Promise<RawRow[]> {
  const response = await fetcher(searchAnalyticsUrl(site), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = (await response.json().catch(() => null)) as { rows?: RawRow[]; error?: { message?: string } } | null;
  if (!response.ok) throw new Error(`Search Console query answered ${response.status}: ${json?.error?.message ?? "no message"}`);
  return json?.rows ?? [];
}

export interface SearchTotals {
  startDate: string;
  endDate: string;
  clicks: number;
  impressions: number;
  /** Google's impression-weighted average position; null when the week had no impressions. */
  averagePosition: number | null;
}

export interface SearchPage {
  page: string;
  clicks: number;
  impressions: number;
  averagePosition: number | null;
}

export interface SearchWeekReport {
  site: string;
  lagNote: string;
  thisWeek: SearchTotals;
  weekBefore: SearchTotals;
  topPages: SearchPage[];
}

function round(value: number | undefined, places = 1): number | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** Totals for a window from a query with no dimensions (one row, or none when the site had no data). */
export function totalsFrom(rows: RawRow[], window: SearchWindow): SearchTotals {
  const row = rows[0];
  const impressions = row?.impressions ?? 0;
  return {
    ...window,
    clicks: row?.clicks ?? 0,
    impressions,
    averagePosition: impressions > 0 ? round(row?.position) : null,
  };
}

export function pagesFrom(rows: RawRow[]): SearchPage[] {
  return rows
    .map((row) => ({
      page: row.keys?.[0] ?? "",
      clicks: row.clicks ?? 0,
      impressions: row.impressions ?? 0,
      averagePosition: (row.impressions ?? 0) > 0 ? round(row.position) : null,
    }))
    .filter((row) => row.page)
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, GSC_TOP_PAGES);
}

/**
 * Clicks, impressions and average position for this week and the week before, and the top 10
 * pages this week by clicks. Throws on a missing key or any API error; the caller records it.
 */
export async function readSearchWeek(options: { fetcher?: FetchLike; now?: Date } = {}): Promise<SearchWeekReport> {
  const raw = (process.env.GSC_SERVICE_ACCOUNT_JSON || "").trim();
  if (!raw) throw new Error(GSC_NOT_CONFIGURED);
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? new Date();
  const key = parseServiceAccount(raw);
  const site = searchConsoleSite();
  const token = await accessToken(key, fetcher, now);
  const { thisWeek, weekBefore } = searchWindows(now);
  const current = await query(site, token, { ...thisWeek, type: "web" }, fetcher);
  const prior = await query(site, token, { ...weekBefore, type: "web" }, fetcher);
  const pages = await query(site, token, { ...thisWeek, type: "web", dimensions: ["page"], rowLimit: GSC_TOP_PAGES }, fetcher);
  return {
    site,
    lagNote: `Search Console data lags about ${GSC_LAG_DAYS} days, so this week ends ${thisWeek.endDate}, ${GSC_LAG_DAYS} days before the run.`,
    thisWeek: totalsFrom(current, thisWeek),
    weekBefore: totalsFrom(prior, weekBefore),
    topPages: pagesFrom(pages),
  };
}

export type SearchResult =
  | ({ measured: true } & SearchWeekReport)
  | { measured: false; reason: string; site?: string };

/** What the growth-score step records: the report, or why there is none. Never throws, never estimates. */
export async function searchForScore(options: { fetcher?: FetchLike; now?: Date } = {}): Promise<SearchResult> {
  if (!searchConsoleConfigured()) return { measured: false, reason: GSC_NOT_CONFIGURED };
  try {
    return { measured: true, ...(await readSearchWeek(options)) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { measured: false, site: searchConsoleSite(), reason: `Search Console read failed: ${message}` };
  }
}

export function summarizeSearch(search: SearchResult): string {
  if (!search.measured) return `Search: not measured (${search.reason})`;
  const { thisWeek: now, weekBefore: prev } = search;
  const position = (value: number | null) => (value === null ? "n/a" : String(value));
  return `Search ${now.startDate} to ${now.endDate}: ${now.clicks} clicks (week before ${prev.clicks}), `
    + `${now.impressions} impressions (${prev.impressions}), average position ${position(now.averagePosition)} (${position(prev.averagePosition)}).`;
}
