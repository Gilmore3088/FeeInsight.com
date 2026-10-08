import { sql, withTransaction } from "./connection";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export async function ensureNewsTable(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS reg_articles (
      guid TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      link TEXT NOT NULL,
      topic TEXT NOT NULL DEFAULT 'general',
      published_at TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_reg_articles_published
    ON reg_articles(published_at DESC)
  `;
}

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
  rulemaking_compliance: [
    "proposed rule", "final rule", "nprm", "regulatory guidance",
    "supervisory guidance", "enforcement action", "consent order",
    "civil money penalty", "interagency", "comment period",
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

interface GetArticlesOptions {
  source?: string;
  topic?: string;
  limit?: number;
  offset?: number;
  since?: string; // ISO date string
}

export async function getArticles(opts: GetArticlesOptions = {}): Promise<RegArticle[]> {
  // Check table exists
  try {
    await sql`SELECT 1 FROM reg_articles LIMIT 1`;
  } catch {
    return [];
  }

  const conditions: string[] = [FEDERAL_RELEASES_ONLY];
  const params: (string | number)[] = [];

  if (opts.source) {
    conditions.push(`source = $${params.length + 1}`);
    params.push(opts.source);
  }
  if (opts.topic) {
    conditions.push(`topic = $${params.length + 1}`);
    params.push(opts.topic);
  }
  if (opts.since) {
    conditions.push(`published_at >= $${params.length + 1}`);
    params.push(opts.since);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  return await sql.unsafe(
    `SELECT guid, source, title, link, topic, published_at, created_at
     FROM reg_articles
     ${where}
     ORDER BY published_at DESC NULLS LAST, created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  ) as unknown as RegArticle[];
}

export async function getArticleCount(opts: { source?: string; topic?: string; since?: string } = {}): Promise<number> {
  try {
    await sql`SELECT 1 FROM reg_articles LIMIT 1`;
  } catch {
    return 0;
  }

  const conditions: string[] = [FEDERAL_RELEASES_ONLY];
  const params: (string | number | null)[] = [];

  if (opts.source) {
    conditions.push(`source = $${params.length + 1}`);
    params.push(opts.source);
  }
  if (opts.topic) {
    conditions.push(`topic = $${params.length + 1}`);
    params.push(opts.topic);
  }
  if (opts.since) {
    conditions.push(`published_at >= $${params.length + 1}`);
    params.push(opts.since);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const [row] = await sql.unsafe(
    `SELECT COUNT(*) as cnt FROM reg_articles ${where}`,
    params,
  );
  return Number(row.cnt);
}

export async function getTopicCounts(since?: string): Promise<Record<string, number>> {
  try {
    await sql`SELECT 1 FROM reg_articles LIMIT 1`;
  } catch {
    return {};
  }

  const sinceClause = since ? `WHERE ${FEDERAL_RELEASES_ONLY} AND published_at >= $1` : `WHERE ${FEDERAL_RELEASES_ONLY}`;
  const params = since ? [since] : [];

  const rows = await sql.unsafe(
    `SELECT topic, COUNT(*) as cnt FROM reg_articles ${sinceClause} GROUP BY topic ORDER BY cnt DESC`,
    params,
  ) as { topic: string; cnt: number }[];

  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.topic] = Number(row.cnt);
  return counts;
}

export async function getSourceCounts(since?: string): Promise<Record<string, number>> {
  try {
    await sql`SELECT 1 FROM reg_articles LIMIT 1`;
  } catch {
    return {};
  }

  const sinceClause = since ? `WHERE ${FEDERAL_RELEASES_ONLY} AND published_at >= $1` : `WHERE ${FEDERAL_RELEASES_ONLY}`;
  const params = since ? [since] : [];

  const rows = await sql.unsafe(
    `SELECT source, COUNT(*) as cnt FROM reg_articles ${sinceClause} GROUP BY source ORDER BY cnt DESC`,
    params,
  ) as { source: string; cnt: number }[];

  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.source] = Number(row.cnt);
  return counts;
}

// ---------------------------------------------------------------------------
// Write: store articles (dedup on guid)
// ---------------------------------------------------------------------------

export async function storeArticles(
  articles: { guid: string; source: string; title: string; link: string; published_at: string | null }[]
): Promise<number> {
  if (articles.length === 0) return 0;

  await ensureNewsTable();

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
