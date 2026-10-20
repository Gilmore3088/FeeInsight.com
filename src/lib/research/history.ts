import { sql } from "@/lib/data-store/connection";

export interface Conversation {
  id: number;
  user_id: number;
  agent_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

// The research_* tables come from supabase/migrations (20260406_report_jobs.sql,
// 20261004163709_research_usage_baseline.sql); request code never creates schema (#2234).

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
