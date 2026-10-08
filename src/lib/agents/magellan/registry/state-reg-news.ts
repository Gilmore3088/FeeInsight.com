import { sql } from "@/lib/data-store/connection";
import { classify } from "@/lib/data-store/news";
import { registryFetch, type RegistryFetchOptions } from "@/lib/regulatory/http";
import type { FeedArticle } from "@/lib/regulatory/news";
import { STATE_REGULATORS, type StateRegulator } from "@/lib/regulatory/state-regulators";
import {
  discoverFeedLinks,
  discoverNewsPage,
  isFeeHeadline,
  isFeedXml,
  parseNewsPage,
  parseStateFeed,
} from "@/lib/regulatory/state-news";
import { mapWithConcurrency, recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry step: each state banking regulator's own press releases and
 * bulletins (and the credit union regulator's, where a state has a separate one), to
 * pair with the Open States bills. Once a day (partition "current") it reads every
 * regulator's home page, follows the feed it advertises, and falls back to reading its
 * news page as a list of article links. Each agency's mode (feed, page, none, failed),
 * item count and fee headlines are in the partition detail, so a site that needs its
 * own reader shows up in the run ledger.
 *
 * Shadow mode until STATE_NEWS_TRACKER_LIVE=true: the step reads and counts but stores
 * nothing. Live, items go into reg_articles with source "state:XX".
 */

export const STATE_REG_NEWS_SOURCE = "state-reg-news";
export const STATE_REG_NEWS_PARTITION = "current";
const REFRESH_HOURS = 24;
const CONCURRENCY = 8;
/** No new agency starts after this long, so the run ends inside its expected time. */
export const STATE_REG_NEWS_START_CUTOFF_MS = 90_000;
const FETCH_OPTIONS: RegistryFetchOptions = { retries: 0, timeoutMs: 15_000 };

/** One flag for both state news steps (this one and registry-state-bill-news). */
export function stateNewsLive(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STATE_NEWS_TRACKER_LIVE === "true";
}

export type StateRegNewsMode = "feed" | "page" | "none" | "failed" | "no_website" | "not_reached";

export interface StateRegNewsAgencyResult {
  state: string;
  agency: string;
  mode: StateRegNewsMode;
  /** The feed or news page read; null when none was found. */
  url: string | null;
  items: number;
  feeItems: number;
  sample: string[];
  error?: string;
}

export interface RegistryStateRegNewsResult {
  source: string;
  partitionKey: string;
  agencies: StateRegNewsAgencyResult[];
  fetched: number;
  feeRelated: number;
  stored: number;
  shadow: boolean;
  dryRun: boolean;
}

export interface StateAgencySite {
  state: string;
  agency: string;
  website: string | null;
}

/** Every regulator site: the bank regulator, plus a separate credit union regulator's site. */
export function stateAgencySites(regulators: readonly StateRegulator[] = STATE_REGULATORS): StateAgencySite[] {
  const sites: StateAgencySite[] = [];
  for (const r of regulators) {
    sites.push({ state: r.stateCode, agency: r.agency, website: r.website });
    if (r.creditUnionAgency && r.creditUnionWebsite && r.creditUnionWebsite !== r.website) {
      sites.push({ state: r.stateCode, agency: r.creditUnionAgency, website: r.creditUnionWebsite });
    }
  }
  return sites;
}

type TextFetcher = (url: string) => Promise<string>;

/** Read one agency: its advertised feed first, then its news page. */
export async function readAgencyNews(site: StateAgencySite, fetchText: TextFetcher): Promise<{ result: StateRegNewsAgencyResult; articles: FeedArticle[] }> {
  const base: StateRegNewsAgencyResult = { state: site.state, agency: site.agency, mode: "none", url: null, items: 0, feeItems: 0, sample: [] };
  if (!site.website) return { result: { ...base, mode: "no_website" }, articles: [] };
  const source = `state:${site.state}`;
  const finish = (mode: StateRegNewsMode, url: string, articles: FeedArticle[]) => {
    const fee = articles.filter((a) => isFeeHeadline(a.title));
    return {
      result: { ...base, mode, url, items: articles.length, feeItems: fee.length, sample: (fee.length > 0 ? fee : articles).slice(0, 3).map((a) => a.title) },
      articles,
    };
  };

  let home: string;
  try {
    home = await fetchText(site.website);
  } catch (error) {
    return { result: { ...base, mode: "failed", error: (error instanceof Error ? error.message : String(error)).slice(0, 200) }, articles: [] };
  }
  // A home page that is itself a feed (rare) counts as the feed.
  if (isFeedXml(home)) {
    const articles = parseStateFeed(home, source);
    if (articles.length > 0) return finish("feed", site.website, articles);
  }
  for (const feedUrl of discoverFeedLinks(home, site.website).slice(0, 2)) {
    try {
      const body = await fetchText(feedUrl);
      if (!isFeedXml(body)) continue;
      const articles = parseStateFeed(body, source);
      if (articles.length > 0) return finish("feed", feedUrl, articles);
    } catch {
      // Try the next candidate; the news page is the fallback.
    }
  }
  for (const pageUrl of discoverNewsPage(home, site.website).slice(0, 2)) {
    try {
      const body = await fetchText(pageUrl);
      // A news page often advertises its own feed even when the home page does not.
      if (isFeedXml(body)) {
        const articles = parseStateFeed(body, source);
        if (articles.length > 0) return finish("feed", pageUrl, articles);
        continue;
      }
      for (const feedUrl of discoverFeedLinks(body, pageUrl).slice(0, 1)) {
        try {
          const feed = await fetchText(feedUrl);
          const articles = isFeedXml(feed) ? parseStateFeed(feed, source) : [];
          if (articles.length > 0) return finish("feed", feedUrl, articles);
        } catch {
          // Fall through to the page's own links.
        }
      }
      const articles = parseNewsPage(body, pageUrl, source);
      if (articles.length > 0) return finish("page", pageUrl, articles);
    } catch {
      // Try the next candidate page.
    }
  }
  return { result: base, articles: [] };
}

const defaultFetchText: TextFetcher = async (url) => {
  const response = await registryFetch(url, FETCH_OPTIONS);
  return response.text();
};

export async function runRegistryStateRegNews(
  options: {
    runId?: number | null;
    dryRun?: boolean;
    db?: RegistryDb;
    live?: boolean;
    sites?: readonly StateAgencySite[];
    fetchText?: TextFetcher;
    startCutoffMs?: number;
    clock?: () => number;
  } = {},
): Promise<RegistryStateRegNewsResult> {
  const db = options.db ?? sql;
  const sites = [...(options.sites ?? stateAgencySites())];
  const fetchText = options.fetchText ?? defaultFetchText;
  const clock = options.clock ?? Date.now;
  const cutoff = options.startCutoffMs ?? STATE_REG_NEWS_START_CUTOFF_MS;
  const startedAt = clock();
  const shadow = !(options.live ?? stateNewsLive());

  const reads = await mapWithConcurrency(sites, CONCURRENCY, async (site) => {
    if (clock() - startedAt >= cutoff) {
      return { result: { state: site.state, agency: site.agency, mode: "not_reached" as const, url: null, items: 0, feeItems: 0, sample: [] }, articles: [] };
    }
    return readAgencyNews(site, fetchText);
  });
  const agencies = reads.map((r) => r.result);
  const articles = reads.flatMap((r) => r.articles);
  const result: RegistryStateRegNewsResult = {
    source: STATE_REG_NEWS_SOURCE,
    partitionKey: STATE_REG_NEWS_PARTITION,
    agencies,
    fetched: articles.length,
    feeRelated: articles.filter((a) => isFeeHeadline(a.title)).length,
    stored: 0,
    shadow,
    dryRun: Boolean(options.dryRun),
  };
  const withWebsite = agencies.filter((a) => a.mode !== "no_website");
  if (withWebsite.length > 0 && withWebsite.every((a) => a.mode === "failed")) {
    throw new Error(`Every state regulator site failed: ${withWebsite.slice(0, 3).map((a) => `${a.state}: ${a.error}`).join("; ")}`);
  }
  if (options.dryRun) return result;

  if (!shadow && articles.length > 0) {
    const unique = [...new Map(articles.map((a) => [a.guid, a])).values()];
    const payload = JSON.stringify(unique.map((a) => ({ ...a, topic: classify(a.title) })));
    const inserted = await db<Array<{ guid: string }>>`
      INSERT INTO reg_articles (guid, source, title, link, topic, published_at)
      SELECT r.guid, r.source, r.title, r.link, r.topic, r.published_at
        FROM jsonb_to_recordset(${payload}::jsonb) AS r(guid text, source text, title text, link text, topic text, published_at text)
      ON CONFLICT (guid) DO NOTHING
      RETURNING guid
    `;
    result.stored = inserted.length;
  }
  const count = (mode: StateRegNewsMode) => agencies.filter((a) => a.mode === mode).length;
  await recordRegistryPartition(db, {
    source: STATE_REG_NEWS_SOURCE,
    partitionKey: STATE_REG_NEWS_PARTITION,
    status: articles.length > 0 ? "succeeded" : "empty",
    rowCount: result.fetched,
    insertedCount: result.stored,
    unmatchedCount: count("failed") + count("none"),
    runId: options.runId ?? null,
    nextAttemptAfterHours: REFRESH_HOURS,
    detail: {
      shadow,
      modes: { feed: count("feed"), page: count("page"), none: count("none"), failed: count("failed"), no_website: count("no_website"), not_reached: count("not_reached") },
      fee_related: result.feeRelated,
      agencies,
    },
  });
  return result;
}
