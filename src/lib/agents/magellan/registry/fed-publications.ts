import { sql } from "@/lib/data-store/connection";
import {
  discoverReserveBankFeeds,
  FED_IN_PRINT_RSS_INDEX,
  parseReserveBankFeed,
  RESERVE_BANKS,
  type FedPublication,
} from "@/lib/regulatory/fed-banks";
import { registryFetch, type RegistryFetchOptions } from "@/lib/regulatory/http";
import { mapWithConcurrency, recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry step: read the 12 regional Federal Reserve Banks' publication feeds
 * once a day into fed_publications (partition "current"), so Hamilton and the regulation
 * tracker can cite district research and regional reports beside the Beige Book.
 *
 * Feeds come from the Fed in Print RSS page; a bank it doesn't link falls back to the
 * bank's own feeds. Each bank's outcome (feed used, items read, or why none) is in the
 * partition detail so a missing district shows on the run ledger.
 */

export const FED_PUBLICATIONS_SOURCE = "fed-publications";
export const FED_PUBLICATIONS_PARTITION = "current";
const FED_PUBLICATIONS_REFRESH_HOURS = 24;
const FEED_CONCURRENCY = 4;

export interface RegistryFedPublicationsResult {
  source: string;
  partitionKey: string;
  indexReachable: boolean;
  fetched: number;
  inserted: number;
  byBank: Record<string, number>;
  banksWithoutItems: string[];
  failedFeeds: string[];
  dryRun: boolean;
}

export async function runRegistryFedPublications(
  options: { runId?: number | null; dryRun?: boolean; db?: RegistryDb; fetchOptions?: RegistryFetchOptions } = {},
): Promise<RegistryFedPublicationsResult> {
  const db = options.db ?? sql;
  const fetchOptions = { retries: 1, timeoutMs: 20_000, ...options.fetchOptions };
  const failedFeeds: string[] = [];
  let discovered = new Map<number, string[]>();
  let indexReachable = false;
  try {
    const response = await registryFetch(FED_IN_PRINT_RSS_INDEX, fetchOptions);
    discovered = discoverReserveBankFeeds(await response.text());
    indexReachable = true;
  } catch (error) {
    failedFeeds.push(`Fed in Print index: ${error instanceof Error ? error.message : String(error)}`);
  }

  const perBank = await mapWithConcurrency(RESERVE_BANKS, FEED_CONCURRENCY, async (bank) => {
    const feeds = discovered.get(bank.district) ?? bank.fallbackFeeds;
    const items: FedPublication[] = [];
    for (const feedUrl of feeds) {
      try {
        const response = await registryFetch(feedUrl, fetchOptions);
        items.push(...parseReserveBankFeed(await response.text(), bank, feedUrl));
      } catch (error) {
        failedFeeds.push(`${bank.name} ${feedUrl}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { bank, feeds, items };
  });

  const byLink = new Map<string, FedPublication>();
  for (const { items } of perBank) for (const item of items) byLink.set(item.link, item);
  const publications = [...byLink.values()];
  const byBank = Object.fromEntries(perBank.map(({ bank, items }) => [bank.name, items.length]));
  const banksWithoutItems = perBank.filter(({ items }) => items.length === 0).map(({ bank, feeds }) =>
    feeds.length === 0 ? `${bank.name} (no feed found)` : bank.name,
  );
  if (publications.length === 0 && failedFeeds.length > 0) {
    throw new Error(`No Reserve Bank feed could be read: ${failedFeeds.slice(0, 5).join("; ")}`);
  }

  const result: RegistryFedPublicationsResult = {
    source: FED_PUBLICATIONS_SOURCE,
    partitionKey: FED_PUBLICATIONS_PARTITION,
    indexReachable,
    fetched: publications.length,
    inserted: 0,
    byBank,
    banksWithoutItems,
    failedFeeds,
    dryRun: Boolean(options.dryRun),
  };
  if (options.dryRun) return result;

  if (publications.length > 0) {
    const payload = JSON.stringify(publications);
    const inserted = await db<Array<{ link: string }>>`
      INSERT INTO fed_publications (link, district, bank, title, published_at, feed_url, fetched_at)
      SELECT r.link, r.district, r.bank, r.title, r.published_at::timestamptz, r.feed_url, NOW()
        FROM jsonb_to_recordset(${payload}::jsonb) AS r(
          link text, district int, bank text, title text, published_at text, feed_url text
        )
      ON CONFLICT (link) DO NOTHING
      RETURNING link
    `;
    result.inserted = inserted.length;
  }
  await recordRegistryPartition(db, {
    source: FED_PUBLICATIONS_SOURCE,
    partitionKey: FED_PUBLICATIONS_PARTITION,
    status: publications.length > 0 ? "succeeded" : "empty",
    rowCount: result.fetched,
    insertedCount: result.inserted,
    unmatchedCount: failedFeeds.length,
    sourceUrl: FED_IN_PRINT_RSS_INDEX,
    runId: options.runId ?? null,
    nextAttemptAfterHours: FED_PUBLICATIONS_REFRESH_HOURS,
    detail: {
      index_reachable: indexReachable,
      by_bank: byBank,
      feeds: Object.fromEntries(perBank.map(({ bank, feeds }) => [bank.name, feeds])),
      banks_without_items: banksWithoutItems,
      failed_feeds: failedFeeds,
    },
  });
  return result;
}
