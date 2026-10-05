import { sql } from "@/lib/data-store/connection";
import { FEEDS, classify } from "@/lib/data-store/news";
import { registryFetch, type RegistryFetchOptions } from "@/lib/regulatory/http";
import { parseFeed, type FeedArticle } from "@/lib/regulatory/news";
import { recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry step: pull the Fed, FDIC, OCC and CFPB press feeds into
 * reg_articles once a day (partition "current"). Before this step the feeds were
 * refreshed only when an operator pressed Refresh, so they went stale.
 */

export const REG_NEWS_SOURCE = "reg-news";
export const REG_NEWS_PARTITION = "current";
const REG_NEWS_REFRESH_HOURS = 24;

export interface RegistryRegNewsResult {
  source: string;
  partitionKey: string;
  fetched: number;
  inserted: number;
  failedFeeds: string[];
  dryRun: boolean;
}

export async function runRegistryRegNews(
  options: { runId?: number | null; dryRun?: boolean; db?: RegistryDb; fetchOptions?: RegistryFetchOptions; feeds?: Record<string, string> } = {},
): Promise<RegistryRegNewsResult> {
  const db = options.db ?? sql;
  const feeds = options.feeds ?? FEEDS;
  const articles: FeedArticle[] = [];
  const failedFeeds: string[] = [];
  await Promise.all(
    Object.entries(feeds).map(async ([source, url]) => {
      try {
        const response = await registryFetch(url, { retries: 1, timeoutMs: 20_000, ...options.fetchOptions });
        articles.push(...parseFeed(await response.text(), source));
      } catch (error) {
        failedFeeds.push(`${source}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }),
  );
  if (articles.length === 0 && failedFeeds.length > 0) {
    throw new Error(`Every regulator feed failed: ${failedFeeds.join("; ")}`);
  }
  const result: RegistryRegNewsResult = {
    source: REG_NEWS_SOURCE,
    partitionKey: REG_NEWS_PARTITION,
    fetched: articles.length,
    inserted: 0,
    failedFeeds,
    dryRun: Boolean(options.dryRun),
  };
  if (options.dryRun) return result;

  if (articles.length > 0) {
    const payload = JSON.stringify(articles.map((article) => ({ ...article, topic: classify(article.title) })));
    const inserted = await db<Array<{ guid: string }>>`
      INSERT INTO reg_articles (guid, source, title, link, topic, published_at)
      SELECT r.guid, r.source, r.title, r.link, r.topic, r.published_at
        FROM jsonb_to_recordset(${payload}::jsonb) AS r(guid text, source text, title text, link text, topic text, published_at text)
      ON CONFLICT (guid) DO NOTHING
      RETURNING guid
    `;
    result.inserted = inserted.length;
  }
  await recordRegistryPartition(db, {
    source: REG_NEWS_SOURCE,
    partitionKey: REG_NEWS_PARTITION,
    status: "succeeded",
    rowCount: result.fetched,
    insertedCount: result.inserted,
    unmatchedCount: failedFeeds.length,
    sourceUrl: null,
    runId: options.runId ?? null,
    nextAttemptAfterHours: REG_NEWS_REFRESH_HOURS,
    detail: { failed_feeds: failedFeeds },
  });
  return result;
}
