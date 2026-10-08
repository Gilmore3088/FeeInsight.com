import { sql } from "@/lib/data-store/connection";
import { classify } from "@/lib/data-store/news";
import { RegistryHttpError, registryFetch, type RegistryFetchOptions } from "@/lib/regulatory/http";
import type { FeedArticle } from "@/lib/regulatory/news";
import { STATE_BILL_JURISDICTIONS } from "@/lib/regulatory/open-states";
import {
  billNewsQuery,
  googleNewsSearchUrl,
  isBillStory,
  isStateFeeStory,
  parseBillLabel,
  parseStateFeed,
  stateFeeNewsQuery,
} from "@/lib/regulatory/state-news";
import { STATE_NAMES } from "@/lib/us-states";
import { mapWithConcurrency, recordRegistryPartition, type RegistryDb } from "./partitions";
import { STATE_BILLS_PARTITION, STATE_BILLS_SOURCE } from "./state-bills";
import { STATE_NEWS_PARSER_VERSION, stateNewsLive } from "./state-reg-news";

/**
 * Magellan registry step: news coverage of state bank fee bills, to pair with the Open
 * States bills. Once a day (partition "current") it searches Google News RSS for each fee
 * bill the registry-state-bills step found (read from that step's per-state partition
 * rows, so it works in shadow mode too), and for fee legislation news in a quarter of the
 * states, so every state is searched every four days. That second search also covers
 * states where Open States finds nothing.
 *
 * Shadow mode until STATE_NEWS_TRACKER_LIVE=true: counts and sample headlines go in the
 * partition detail and nothing is stored. Live, items go into reg_articles with source
 * "news:XX".
 */

export const STATE_BILL_NEWS_SOURCE = "state-bill-news";
export const STATE_BILL_NEWS_PARTITION = "current";
const REFRESH_HOURS = 24;
const CONCURRENCY = 2;
const ITEMS_PER_QUERY = 10;
/** States searched for fee legislation news each day: a quarter of them, by day number. */
export const STATE_QUERY_GROUPS = 4;
export const STATE_BILL_NEWS_START_CUTOFF_MS = 90_000;
const FETCH_OPTIONS: RegistryFetchOptions = { retries: 0, timeoutMs: 15_000 };

export interface FeeBill {
  state: string;
  identifier: string;
  stage: string | null;
}

export interface NewsQueryResult {
  kind: "bill" | "state";
  state: string;
  bill: string | null;
  stage: string | null;
  items: number;
  /** Stories the search returned that were off topic or about another state. */
  dropped?: number;
  sample: string[];
  error?: string;
}

export interface RegistryStateBillNewsResult {
  source: string;
  partitionKey: string;
  bills: number;
  states: string[];
  queries: NewsQueryResult[];
  notReached: number;
  rateLimited: boolean;
  fetched: number;
  stored: number;
  shadow: boolean;
  dryRun: boolean;
}

/** Fee bills from the state-bills step's per-state rows ("AB 1520 (signed)"). */
export async function loadFeeBills(db: RegistryDb): Promise<FeeBill[]> {
  const rows = await db<Array<{ partition_key: string; bills: unknown }>>`
    SELECT partition_key, detail->'bills' AS bills
      FROM registry_ingest_partitions
     WHERE source = ${STATE_BILLS_SOURCE} AND partition_key <> ${STATE_BILLS_PARTITION}
       AND jsonb_typeof(detail->'bills') = 'array'
  `;
  const bills: FeeBill[] = [];
  for (const row of rows) {
    if (!Array.isArray(row.bills)) continue;
    for (const label of row.bills) {
      const parsed = typeof label === "string" ? parseBillLabel(label) : null;
      if (parsed) bills.push({ state: String(row.partition_key).toUpperCase(), ...parsed });
    }
  }
  return bills.sort((a, b) => a.state.localeCompare(b.state) || a.identifier.localeCompare(b.identifier));
}

/** This day's quarter of the states for the fee legislation search. */
export function statesForDay(now: Date, states: readonly string[] = STATE_BILL_JURISDICTIONS): string[] {
  const day = Math.floor(now.getTime() / 86_400_000);
  return states.filter((_, index) => index % STATE_QUERY_GROUPS === day % STATE_QUERY_GROUPS);
}

type TextFetcher = (url: string) => Promise<string>;

const defaultFetchText: TextFetcher = async (url) => {
  const response = await registryFetch(url, FETCH_OPTIONS);
  return response.text();
};

export async function runRegistryStateBillNews(
  options: {
    runId?: number | null;
    dryRun?: boolean;
    db?: RegistryDb;
    live?: boolean;
    now?: Date;
    bills?: FeeBill[];
    fetchText?: TextFetcher;
    startCutoffMs?: number;
    clock?: () => number;
  } = {},
): Promise<RegistryStateBillNewsResult> {
  const db = options.db ?? sql;
  const now = options.now ?? new Date();
  const fetchText = options.fetchText ?? defaultFetchText;
  const clock = options.clock ?? Date.now;
  const cutoff = options.startCutoffMs ?? STATE_BILL_NEWS_START_CUTOFF_MS;
  const shadow = !(options.live ?? stateNewsLive());
  const bills = options.bills ?? (await loadFeeBills(db));
  const states = statesForDay(now);

  const plan: Array<{ kind: "bill" | "state"; state: string; bill: string | null; stage: string | null; query: string }> = [
    ...bills.map((b) => ({ kind: "bill" as const, state: b.state, bill: b.identifier, stage: b.stage, query: billNewsQuery(b.identifier, STATE_NAMES[b.state] ?? b.state) })),
    ...states.map((s) => ({ kind: "state" as const, state: s, bill: null, stage: null, query: stateFeeNewsQuery(STATE_NAMES[s] ?? s) })),
  ];

  const startedAt = clock();
  let rateLimited = false;
  const reads = await mapWithConcurrency(plan, CONCURRENCY, async (entry): Promise<{ result: NewsQueryResult | null; articles: FeedArticle[] }> => {
    const base: NewsQueryResult = { kind: entry.kind, state: entry.state, bill: entry.bill, stage: entry.stage, items: 0, sample: [] };
    if (rateLimited || clock() - startedAt >= cutoff) return { result: null, articles: [] as FeedArticle[] };
    try {
      const xml = await fetchText(googleNewsSearchUrl(entry.query));
      const source = `news:${entry.state}`;
      const stateName = STATE_NAMES[entry.state] ?? entry.state;
      const found = parseStateFeed(xml, source, ITEMS_PER_QUERY);
      // Search matches words anywhere in a story: a bill number also names other states'
      // bills and box scores, and a state search returns national and non-bank fee stories.
      // Keep stories whose headline names this state (or bill) and is on topic.
      const articles = found.filter((a) =>
        entry.kind === "bill" && entry.bill ? isBillStory(a.title, entry.bill, stateName) : isStateFeeStory(a.title, stateName),
      );
      return {
        result: { ...base, items: articles.length, dropped: found.length - articles.length, sample: articles.slice(0, 3).map((a) => a.title) },
        articles,
      };
    } catch (error) {
      if (error instanceof RegistryHttpError && (error.status === 429 || error.status === 503)) rateLimited = true;
      return { result: { ...base, error: (error instanceof Error ? error.message : String(error)).slice(0, 200) }, articles: [] as FeedArticle[] };
    }
  });
  const queries = reads.map((r) => r.result).filter((r): r is NewsQueryResult => r !== null);
  const articles = [...new Map(reads.flatMap((r) => r.articles).map((a) => [a.link, a])).values()];
  const result: RegistryStateBillNewsResult = {
    source: STATE_BILL_NEWS_SOURCE,
    partitionKey: STATE_BILL_NEWS_PARTITION,
    bills: bills.length,
    states,
    queries,
    notReached: plan.length - queries.length,
    rateLimited,
    fetched: articles.length,
    stored: 0,
    shadow,
    dryRun: Boolean(options.dryRun),
  };
  if (queries.length > 0 && queries.every((q) => q.error)) {
    throw new Error(`Every news search failed: ${queries.slice(0, 3).map((q) => q.error).join("; ")}`);
  }
  if (options.dryRun) return result;

  if (!shadow && articles.length > 0) {
    const payload = JSON.stringify(articles.map((a) => ({ ...a, guid: a.link, topic: classify(a.title) })));
    const inserted = await db<Array<{ guid: string }>>`
      INSERT INTO reg_articles (guid, source, title, link, topic, published_at)
      SELECT r.guid, r.source, r.title, r.link, r.topic, r.published_at
        FROM jsonb_to_recordset(${payload}::jsonb) AS r(guid text, source text, title text, link text, topic text, published_at text)
      ON CONFLICT (guid) DO NOTHING
      RETURNING guid
    `;
    result.stored = inserted.length;
  }
  await recordRegistryPartition(db, {
    source: STATE_BILL_NEWS_SOURCE,
    partitionKey: STATE_BILL_NEWS_PARTITION,
    status: articles.length > 0 ? "succeeded" : "empty",
    rowCount: result.fetched,
    insertedCount: result.stored,
    unmatchedCount: queries.filter((q) => q.error).length,
    runId: options.runId ?? null,
    nextAttemptAfterHours: REFRESH_HOURS,
    detail: {
      parser_version: STATE_NEWS_PARSER_VERSION,
      shadow,
      bills: bills.length,
      bills_with_news: queries.filter((q) => q.kind === "bill" && q.items > 0).length,
      states,
      states_with_news: queries.filter((q) => q.kind === "state" && q.items > 0).map((q) => q.state),
      not_reached: result.notReached,
      rate_limited: rateLimited,
      queries,
    },
  });
  return result;
}
