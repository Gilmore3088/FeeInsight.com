import { sql } from "@/lib/data-store/connection";
import { getResearchQueryLimit } from "@/lib/access";
import type { User } from "@/lib/auth";

/**
 * Daily Hamilton AI quota, counted in Postgres (research_usage) so it holds across
 * every serverless instance. Each completed Analyze answer, Simulate interpretation,
 * admin chat turn and generated report logs one row; a report counts once even though
 * it makes several model calls. Limits come from getResearchQueryLimit (Pro 50/day; team
 * seat holders, the institution owner included, have no daily cap). The shared provider
 * spend breaker applies to everyone either way.
 */

export const HAMILTON_USAGE_AGENT_PREFIX = "hamilton";

export interface ProAiQuota {
  allowed: boolean;
  used: number;
  limit: number;
  resetsAt: string;
}

function nextUtcMidnight(now: Date): string {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return next.toISOString();
}

export async function checkProAiQuota(user: User, now: Date = new Date()): Promise<ProAiQuota> {
  const limit = getResearchQueryLimit(user);
  const resetsAt = nextUtcMidnight(now);
  try {
    const [row] = await sql`
      SELECT COUNT(*)::int AS used
        FROM research_usage
       WHERE user_id = ${user.id}
         AND agent_id LIKE ${`${HAMILTON_USAGE_AGENT_PREFIX}%`}
         AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC')
    `;
    const used = Number(row?.used ?? 0);
    return { allowed: used < limit, used, limit, resetsAt };
  } catch {
    // The quota is a cost guard, not an outage switch: if the count can't be read,
    // the provider budget breaker still caps spend.
    return { allowed: true, used: 0, limit, resetsAt };
  }
}

export function quotaExceededMessage(quota: ProAiQuota): string {
  return `You've used all ${quota.limit} Hamilton AI requests for today. The limit resets at midnight UTC.`;
}
