import { likePattern } from "@/lib/regulatory/wire";
import { feeTypeSql, type FeeType } from "@/lib/regulatory/wire-fee-types";
import { sql, withTransaction } from "./connection";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

// reg_articles and idx_reg_articles_published come from
// supabase/migrations/20260406_report_jobs.sql; request code never creates schema (#2234).

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegArticle {
  guid: string;
  source: string;
  title: string;
  link: string;
  topic: string;
  published_at: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Topic classification
// ---------------------------------------------------------------------------

/**
 * Enforcement actions, orders and their terminations. Checked after the overdraft, lending and
 * M&A topics (a consent order over overdraft fees stays an overdraft item) and before rulemaking
 * and fees & pricing. Plain
 * words only, so the same pattern runs in JavaScript and as a Postgres regex.
 */
const ENFORCEMENT_KEYWORDS = ["enforcement action", "enforcement order", "consent order", "civil money penalt", "cease and desist", "prohibition order"];
export const ENFORCEMENT_TITLE = new RegExp(ENFORCEMENT_KEYWORDS.join("|"), "i");

/**
 * reg_articles' topic as the readers see it. Rows stored as Rulemaking or General before the
 * enforcement topic existed read as Enforcement when their title says so; no row is rewritten.
 */
export const TOPIC_SQL = `(CASE WHEN topic IN ('rulemaking_compliance', 'general') AND title ~* '${ENFORCEMENT_KEYWORDS.join("|")}' THEN 'enforcement' ELSE topic END)`;

const TOPICS: Record<string, string[]> = {
  overdraft: [
    "overdraft fee", "overdraft fees", "nsf fee", "non-sufficient funds",
    "overdraft protection", "overdraft coverage", "reg e opt-in",
    "courtesy pay", "junk fee", "junk fees",
  ],
  consumer_lending: [
    "consumer loan", "consumer lending", "credit card", "auto loan",
    "personal loan", "bnpl", "buy now pay later", "late fee",
    "annual percentage rate", "rate cap", "tila", "reg z",
    "credit card late fee", "interest rate cap",
  ],
  mergers_acquisitions: [
    "merger", "acquisition", "merger agreement", "de novo",
    "branch sale", "purchase and assumption", "consolidation",
    "acquir", "application by",
  ],
  enforcement: ENFORCEMENT_KEYWORDS,
  rulemaking_compliance: [
    "proposed rule", "final rule", "nprm", "regulatory guidance",
    "supervisory guidance", "interagency", "comment period",
    "examination", "supervisory letter",
  ],
  fees_pricing: [
    "fee schedule", "service charge", "account fee", "monthly fee",
    "maintenance fee", "atm fee", "wire transfer fee", "pricing",
    "fee increase", "fee reduction", "fee cap",
  ],
};

export const TOPIC_LABELS: Record<string, string> = {
  overdraft: "Overdraft & NSF",
  consumer_lending: "Consumer Lending",
  mergers_acquisitions: "M&A",
  rulemaking_compliance: "Rulemaking",
  enforcement: "Enforcement",
  fees_pricing: "Fees & Pricing",
  general: "General",
};

export const SOURCE_LABELS: Record<string, string> = {
  FED: "Federal Reserve",
  FDIC: "FDIC",
  OCC: "OCC",
  CFPB: "CFPB",
};

export function classify(title: string): string {
  const lower = title.toLowerCase();
  for (const [topic, keywords] of Object.entries(TOPICS)) {
    if (keywords.some((kw) => lower.includes(kw))) return topic;
  }
  return "general";
}

// ---------------------------------------------------------------------------
// RSS Feed URLs
// ---------------------------------------------------------------------------

/**
 * reg_articles also holds the state news steps' items (registry-state-reg-news, source
 * "state:XX"; registry-state-bill-news, source "news:XX", press coverage). Every reader
 * that means federal agency releases keeps to this, so a state bulletin or a newspaper
 * story is never cited as an agency release. A static clause, safe inside SQL text.
 */
export const STATE_NEWS_SOURCE_PATTERNS = ["state:%", "news:%"];
export const FEDERAL_RELEASES_ONLY = STATE_NEWS_SOURCE_PATTERNS.map((p) => `source NOT LIKE '${p}'`).join(" AND ");

export const FEEDS: Record<string, string> = {
  FED: "https://www.federalreserve.gov/feeds/press_all.xml",
  FDIC: "https://public.govdelivery.com/topics/USFDIC_26/feed.rss",
  OCC: "https://www.occ.gov/rss/occ_news.xml",
  CFPB: "https://www.consumerfinance.gov/about-us/newsroom/feed/",
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface ArticleFilter {
  source?: string;
  topic?: string;
  since?: string; // ISO date string
  /** Case-insensitive match anywhere in the title. */
  q?: string;
  /** Fee-type tag from the headline (wire-fee-types). */
  fee?: FeeType;
}

interface GetArticlesOptions extends ArticleFilter {
  limit?: number;
  offset?: number;
}

/**
 * The WHERE clause and its parameters for the federal release readers. Always federal
 * releases only; every value is a bind parameter ($1, $2, ...), never SQL text.
 */
export function buildArticleFilter(opts: ArticleFilter = {}): { where: string; params: string[] } {
  const conditions: string[] = [FEDERAL_RELEASES_ONLY];
  const params: string[] = [];
  const add = (clause: (n: number) => string, value: string) => {
    params.push(value);
    conditions.push(clause(params.length));
  };
  if (opts.source) add((n) => `source = $${n}`, opts.source);
  if (opts.topic) add((n) => `${TOPIC_SQL} = $${n}`, opts.topic);
  if (opts.since) add((n) => `published_at >= $${n}`, opts.since);
  const pattern = likePattern(opts.q);
  if (pattern) add((n) => `title ILIKE $${n}`, pattern);
  if (opts.fee) {
    const fee = feeTypeSql(opts.fee);
    add((n) => `title ~* $${n}`, fee.include);
    if (fee.exclude) add((n) => `title !~* $${n}`, fee.exclude);
  }
  return { where: `WHERE ${conditions.join(" AND ")}`, params };
}

async function hasArticlesTable(): Promise<boolean> {
  try {
    await sql`SELECT 1 FROM reg_articles LIMIT 1`;
    return true;
  } catch {
    return false;
  }
}

export async function getArticles(opts: GetArticlesOptions = {}): Promise<RegArticle[]> {
  if (!(await hasArticlesTable())) return [];
  const { where, params } = buildArticleFilter(opts);
  const limit = opts.limit ?? 50;
  const offset = Math.max(0, opts.offset ?? 0);

  return await sql.unsafe(
    `SELECT guid, source, title, link, ${TOPIC_SQL} AS topic, published_at, created_at
     FROM reg_articles
     ${where}
     ORDER BY published_at DESC NULLS LAST, created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  ) as unknown as RegArticle[];
}

export async function getArticleCount(opts: ArticleFilter = {}): Promise<number> {
  if (!(await hasArticlesTable())) return 0;
  const { where, params } = buildArticleFilter(opts);
  const [row] = await sql.unsafe(`SELECT COUNT(*) as cnt FROM reg_articles ${where}`, params);
  return Number(row.cnt);
}

async function countBy(column: "topic" | "source", since?: string, q?: string, fee?: FeeType): Promise<Record<string, number>> {
  if (!(await hasArticlesTable())) return {};
  const { where, params } = buildArticleFilter({ since, q, fee });
  const key = column === "topic" ? TOPIC_SQL : column;
  const rows = await sql.unsafe(
    `SELECT ${key} AS key, COUNT(*) as cnt FROM reg_articles ${where} GROUP BY 1 ORDER BY cnt DESC`,
    params,
  ) as unknown as { key: string; cnt: number }[];
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.key] = Number(row.cnt);
  return counts;
}

/** Federal releases per topic in the window (and matching the search, when given). */
export async function getTopicCounts(since?: string, q?: string, fee?: FeeType): Promise<Record<string, number>> {
  return countBy("topic", since, q, fee);
}

/** Federal releases per agency in the window (and matching the search, when given). */
export async function getSourceCounts(since?: string, q?: string, fee?: FeeType): Promise<Record<string, number>> {
  return countBy("source", since, q, fee);
}

// ---------------------------------------------------------------------------
// Write: store articles (dedup on guid)
// ---------------------------------------------------------------------------

export async function storeArticles(
  articles: { guid: string; source: string; title: string; link: string; published_at: string | null }[]
): Promise<number> {
  if (articles.length === 0) return 0;

  let inserted = 0;
  await withTransaction(async (tx) => {
    for (const a of articles) {
      const topic = classify(a.title);
      const result = await tx`
        INSERT INTO reg_articles (guid, source, title, link, topic, published_at)
        VALUES (${a.guid}, ${a.source}, ${a.title}, ${a.link}, ${topic}, ${a.published_at})
        ON CONFLICT (guid) DO NOTHING
      `;
      if (result.count > 0) inserted++;
    }
  });
  return inserted;
}
