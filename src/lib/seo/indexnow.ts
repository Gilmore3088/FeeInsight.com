/**
 * IndexNow: tells Bing (and the other IndexNow engines) which pages changed, so new and
 * updated institution pages are recrawled within hours instead of waiting for the sitemap.
 * Google ignores IndexNow and keeps using the sitemap.
 *
 * The key is public by design: the engines confirm ownership by fetching
 * `${SITE_URL}/${INDEXNOW_KEY}.txt` (public/), which must contain exactly the key.
 */
import { SITE_URL } from "@/lib/constants";
import { getInstitutionIdsWithFeeDates } from "@/lib/data-store";
import { MIN_VERIFIED_FEES_FOR_OFFER } from "@/app/(public)/institution/[id]/profile-copy";

export const INDEXNOW_KEY = "ca6202af6d65f287a44e558a58a3ad22";
export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
/** Daily run; the window overlaps by an hour so a late run misses nothing. */
export const INDEXNOW_WINDOW_HOURS = 25;
/** IndexNow accepts at most 10,000 URLs per request. */
export const INDEXNOW_MAX_URLS = 10_000;

/** Pages whose content moves with the published fee data, listed on every ping that has changes. */
const DATA_PAGES = ["/", "/institutions", "/fees", "/research/national-fee-index"];

type InstitutionFreshness = Awaited<ReturnType<typeof getInstitutionIdsWithFeeDates>>[number];

export interface IndexNowResult {
  dryRun: boolean;
  urls: string[];
  changedInstitutions: number;
  submitted: number;
  httpStatus: number | null;
  skipped: string | null;
  error: string | null;
}

/**
 * Institution pages (same filter as the sitemap) with a fee published since `since`, plus
 * the data pages when any changed. Empty when nothing changed.
 */
export function buildIndexNowUrls(
  institutions: InstitutionFreshness[],
  since: Date,
  siteUrl: string = SITE_URL,
): { urls: string[]; changedInstitutions: number } {
  const changed = institutions.filter((inst) => {
    if (inst.verified_fee_count != null && inst.verified_fee_count < MIN_VERIFIED_FEES_FOR_OFFER) return false;
    if (!inst.last_fee_at) return false;
    const at = new Date(inst.last_fee_at);
    return !Number.isNaN(at.getTime()) && at >= since;
  });
  if (changed.length === 0) return { urls: [], changedInstitutions: 0 };
  const paths = [...DATA_PAGES, ...changed.map((inst) => `/institution/${inst.id}`)];
  return {
    urls: paths.slice(0, INDEXNOW_MAX_URLS).map((path) => `${siteUrl}${path}`),
    changedInstitutions: changed.length,
  };
}

/** Only the production site pings; previews and local runs would advertise the wrong host. */
function skipReason(siteUrl: string): string | null {
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv && vercelEnv !== "production") return `not production (${vercelEnv})`;
  if (!siteUrl.startsWith("https://")) return `site URL is not https (${siteUrl})`;
  return null;
}

export async function runIndexNowPing(options: {
  dryRun?: boolean;
  now?: Date;
  siteUrl?: string;
  fetchImpl?: typeof fetch;
  loadInstitutions?: () => Promise<InstitutionFreshness[]>;
} = {}): Promise<IndexNowResult> {
  const dryRun = options.dryRun ?? false;
  const now = options.now ?? new Date();
  const siteUrl = options.siteUrl ?? SITE_URL;
  const since = new Date(now.getTime() - INDEXNOW_WINDOW_HOURS * 60 * 60 * 1000);
  const institutions = await (options.loadInstitutions ?? getInstitutionIdsWithFeeDates)();
  const { urls, changedInstitutions } = buildIndexNowUrls(institutions, since, siteUrl);
  const base = { dryRun, urls, changedInstitutions, submitted: 0, httpStatus: null, error: null };

  if (urls.length === 0) return { ...base, skipped: "no pages changed" };
  if (dryRun) return { ...base, skipped: "dry run" };
  const reason = skipReason(siteUrl);
  if (reason) return { ...base, skipped: reason };

  const host = new URL(siteUrl).host;
  try {
    const response = await (options.fetchImpl ?? fetch)(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host,
        key: INDEXNOW_KEY,
        keyLocation: `${siteUrl}/${INDEXNOW_KEY}.txt`,
        urlList: urls,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    // 200 = accepted, 202 = accepted and key check pending; anything else is a failure.
    const ok = response.status === 200 || response.status === 202;
    return {
      ...base,
      httpStatus: response.status,
      submitted: ok ? urls.length : 0,
      skipped: null,
      error: ok ? null : `IndexNow returned HTTP ${response.status}`,
    };
  } catch (error) {
    return { ...base, skipped: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export function summarizeIndexNow(result: IndexNowResult): string {
  if (result.error) return `Could not notify Bing via IndexNow: ${result.error}.`;
  if (result.skipped === "no pages changed") return "No institution pages changed in the last day; nothing to send to IndexNow.";
  if (result.skipped) return `Found ${result.urls.length} changed pages but did not send them (${result.skipped}).`;
  return `Sent ${result.submitted} changed pages (${result.changedInstitutions} institutions) to Bing via IndexNow (HTTP ${result.httpStatus}).`;
}
