import { sql } from "./connection";

/**
 * Provider spend against its caps: all agents together (the global policy) and
 * each agent with its own policy. Spend is summed from ai_api_usage_events and
 * caps are read from api_budget_policies, so both are the live values. Days and
 * months are UTC, the same windows the budget guard uses.
 */

export interface SpendLine {
  /** "all" for the global cap, otherwise the agent name. */
  key: string;
  todayUsd: number;
  monthUsd: number;
  dailyCapUsd: number | null;
  monthlyCapUsd: number | null;
  /** False when the policy exists but is switched off (paid calls blocked). */
  enabled: boolean;
}

export interface SpendSummary {
  readAt: string;
  total: SpendLine;
  agents: SpendLine[];
}

const usd = (micro: unknown): number => Math.round(Number(micro ?? 0) / 10_000) / 100;
const cap = (micro: unknown): number | null => (micro === null || micro === undefined ? null : usd(micro));

export async function getSpendSummary(): Promise<SpendSummary> {
  const [policies, spend] = await Promise.all([
    sql`
      SELECT policy_key, agent_name, enabled, hard_daily_microusd, hard_monthly_microusd
        FROM public.api_budget_policies
       WHERE policy_key = 'global:provider:default' OR policy_key LIKE 'agent:%'
    `,
    sql`
      SELECT COALESCE(agent_name, 'unattributed') AS agent,
             COALESCE(SUM(estimated_cost_microusd) FILTER (WHERE created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'), 0)::bigint AS today,
             COALESCE(SUM(estimated_cost_microusd), 0)::bigint AS month
        FROM public.ai_api_usage_events
       WHERE status = 'completed'
         AND created_at >= date_trunc('month', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
       GROUP BY 1
    `,
  ]);

  const spendByAgent = new Map(spend.map((row) => [String(row.agent), { today: usd(row.today), month: usd(row.month) }]));
  const global = policies.find((row) => row.policy_key === "global:provider:default");
  const total: SpendLine = {
    key: "all",
    todayUsd: Math.round([...spendByAgent.values()].reduce((sum, row) => sum + row.today, 0) * 100) / 100,
    monthUsd: Math.round([...spendByAgent.values()].reduce((sum, row) => sum + row.month, 0) * 100) / 100,
    dailyCapUsd: cap(global?.hard_daily_microusd),
    monthlyCapUsd: cap(global?.hard_monthly_microusd),
    enabled: Boolean(global?.enabled),
  };

  const agentNames = new Set<string>([
    ...policies.filter((row) => row.agent_name).map((row) => String(row.agent_name)),
    ...spendByAgent.keys(),
  ]);
  const agents: SpendLine[] = [...agentNames]
    .map((name) => {
      const policy = policies.find((row) => row.agent_name === name);
      const used = spendByAgent.get(name) ?? { today: 0, month: 0 };
      return {
        key: name,
        todayUsd: used.today,
        monthUsd: used.month,
        dailyCapUsd: cap(policy?.hard_daily_microusd),
        monthlyCapUsd: cap(policy?.hard_monthly_microusd),
        enabled: policy ? Boolean(policy.enabled) : false,
      };
    })
    .sort((a, b) => b.monthUsd - a.monthUsd || a.key.localeCompare(b.key));

  return { readAt: new Date().toISOString(), total, agents };
}

/**
 * One agent's provider spend for the current UTC day, from the same ledger and
 * windows Controls shows. Null when the ledger could not be read, so a panel never
 * shows $0.00 for a failed read.
 */
export async function getAgentSpendToday(agent: string): Promise<{ todayUsd: number; readAt: string } | null> {
  try {
    const summary = await getSpendSummary();
    return { todayUsd: summary.agents.find((line) => line.key === agent)?.todayUsd ?? 0, readAt: summary.readAt };
  } catch (error) {
    console.error(`Spend read for ${agent} failed`, error);
    return null;
  }
}
