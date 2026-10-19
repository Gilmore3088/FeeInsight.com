import { sql } from "@/lib/data-store/connection";

export interface Conversation {
  id: number;
  user_id: number;
  agent_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

/** Ensure research tables exist */
export async function ensureResearchTables(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS research_conversations (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      agent_id TEXT NOT NULL,
      title TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS research_messages (
      id SERIAL PRIMARY KEY,
      conversation_id INTEGER NOT NULL REFERENCES research_conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
      content TEXT NOT NULL,
      tool_calls TEXT,
      token_count INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS research_usage (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      ip_address TEXT,
      agent_id TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost_cents INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_research_conv_user ON research_conversations(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_research_msg_conv ON research_messages(conversation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_research_usage_user_date ON research_usage(user_id, created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_research_usage_ip_date ON research_usage(ip_address, created_at)`;

  await sql`
    CREATE TABLE IF NOT EXISTS research_articles (
      id SERIAL PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      subtitle TEXT,
      content TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'analysis',
      tags TEXT,
      author TEXT DEFAULT 'Bank Fee Index',
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
      generated_by TEXT,
      conversation_id INTEGER,
      published_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      view_count INTEGER NOT NULL DEFAULT 0
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_research_articles_status ON research_articles(status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_research_articles_slug ON research_articles(slug)`;
}

export async function listConversations(
  userId: number,
  agentId?: string,
  limit = 20
): Promise<Conversation[]> {
  if (agentId) {
    return await sql`
      SELECT * FROM research_conversations
      WHERE user_id = ${userId} AND agent_id = ${agentId}
      ORDER BY updated_at DESC LIMIT ${limit}
    ` as Conversation[];
  }
  return await sql`
    SELECT * FROM research_conversations
    WHERE user_id = ${userId}
    ORDER BY updated_at DESC LIMIT ${limit}
  ` as Conversation[];
}

export async function logUsage(
  userId: number | null,
  ipAddress: string | null,
  agentId: string,
  inputTokens: number,
  outputTokens: number,
  estimatedCostCents: number
): Promise<void> {
  await sql`
    INSERT INTO research_usage (user_id, ip_address, agent_id, input_tokens, output_tokens, estimated_cost_cents)
    VALUES (${userId}, ${ipAddress}, ${agentId}, ${inputTokens}, ${outputTokens}, ${estimatedCostCents})
  `;
}

export async function getUsageStats(userId: number): Promise<{
  today: number;
  month: number;
  total_cost_cents: number;
}> {
  const [row] = await sql`
    SELECT
      (SELECT COUNT(*) FROM research_usage WHERE user_id = ${userId} AND created_at >= CURRENT_DATE) as today,
      (SELECT COUNT(*) FROM research_usage WHERE user_id = ${userId} AND created_at >= date_trunc('month', CURRENT_DATE)) as month,
      (SELECT COALESCE(SUM(estimated_cost_cents), 0) FROM research_usage WHERE user_id = ${userId}) as total_cost_cents
  `;
  return row as { today: number; month: number; total_cost_cents: number };
}

/** Full usage dashboard stats for admin view */
export interface UsageDashboard {
  today_queries: number;
  today_cost_cents: number;
  month_queries: number;
  month_cost_cents: number;
  total_queries: number;
  total_cost_cents: number;
  by_agent: { agent_id: string; queries: number; cost_cents: number }[];
  by_day: { date: string; queries: number; cost_cents: number }[];
  top_users: { user_id: number; username: string; queries: number; cost_cents: number }[];
}

export async function getUsageDashboard(): Promise<UsageDashboard> {
  const [totals] = await sql`
    SELECT
      (SELECT COUNT(*) FROM research_usage WHERE created_at >= CURRENT_DATE) as today_queries,
      (SELECT COALESCE(SUM(estimated_cost_cents), 0) FROM research_usage WHERE created_at >= CURRENT_DATE) as today_cost_cents,
      (SELECT COUNT(*) FROM research_usage WHERE created_at >= date_trunc('month', CURRENT_DATE)) as month_queries,
      (SELECT COALESCE(SUM(estimated_cost_cents), 0) FROM research_usage WHERE created_at >= date_trunc('month', CURRENT_DATE)) as month_cost_cents,
      (SELECT COUNT(*) FROM research_usage) as total_queries,
      (SELECT COALESCE(SUM(estimated_cost_cents), 0) FROM research_usage) as total_cost_cents
  ` as {
    today_queries: number;
    today_cost_cents: number;
    month_queries: number;
    month_cost_cents: number;
    total_queries: number;
    total_cost_cents: number;
  }[];

  const by_agent = await sql`
    SELECT agent_id, COUNT(*) as queries, COALESCE(SUM(estimated_cost_cents), 0) as cost_cents
    FROM research_usage
    GROUP BY agent_id
    ORDER BY queries DESC
  ` as { agent_id: string; queries: number; cost_cents: number }[];

  const by_day = await sql`
    SELECT created_at::date as date, COUNT(*) as queries, COALESCE(SUM(estimated_cost_cents), 0) as cost_cents
    FROM research_usage
    WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY created_at::date
    ORDER BY date DESC
  ` as { date: string; queries: number; cost_cents: number }[];

  const top_users = await sql`
    SELECT ru.user_id, COALESCE(u.username, 'public') as username,
           COUNT(*) as queries, COALESCE(SUM(ru.estimated_cost_cents), 0) as cost_cents
    FROM research_usage ru
    LEFT JOIN users u ON ru.user_id = u.id
    WHERE ru.created_at >= date_trunc('month', CURRENT_DATE)
    GROUP BY ru.user_id, u.username
    ORDER BY queries DESC
    LIMIT 10
  ` as { user_id: number; username: string; queries: number; cost_cents: number }[];

  return { ...totals, by_agent, by_day, top_users };
}

/** Check if daily cost threshold is exceeded (circuit breaker) */
export async function getDailyCostCents(): Promise<number> {
  const [row] = await sql`
    SELECT COALESCE(SUM(estimated_cost_cents), 0) as cost
    FROM research_usage
    WHERE created_at >= CURRENT_DATE
  `;
  return (row as { cost: number }).cost;
}
