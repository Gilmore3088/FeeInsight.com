import { sql } from "@/lib/data-store/connection";
import { API_V1_RATE_LIMIT_ROUTE } from "@/lib/api-v1";
import { API_MONTHLY_CALLS, subscriberKeyUserId, subscriberOrgSlug } from "@/lib/api-subscriber-access";

/** One person's successful API calls this month on a shared plan. */
export interface ApiUsagePerson {
  userId: number;
  /** Their display name, else their email, else "User <id>". */
  label: string;
  calls: number;
}

/** A Pro plan's shared API allowance this calendar month (UTC), and who used it. */
export interface ApiUsageSummary {
  /** Calls counted against the allowance this month (the monthly reservation count). */
  used: number;
  allowance: number;
  /** Calls per key holder this month, most first, counting every logged outcome the way the allowance does. Calls logged without a key are not listed. */
  people: ApiUsagePerson[];
}

/** The first instant of `now`'s calendar month in UTC, the same window the monthly limit uses. */
export function usageMonthStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Read-only: this month's use of the payer's shared API allowance, from the monthly
 * reservation row for the payer's organization, plus each key holder's successful calls from
 * usage_events. A key named for no one ("Pro subscription", the payer's older key) counts as
 * the payer's.
 */
export async function getApiUsageSummary(
  payerId: number,
  now: Date = new Date(),
  db: typeof sql = sql,
): Promise<ApiUsageSummary> {
  const monthStart = usageMonthStart(now).toISOString();
  const [org] = await db<{ id: number }[]>`
    SELECT id FROM organizations WHERE slug = ${subscriberOrgSlug(payerId)} LIMIT 1
  `;
  if (!org) return { used: 0, allowance: API_MONTHLY_CALLS, people: [] };
  const orgId = Number(org.id);

  const [limitRow] = await db<{ request_count: number | string }[]>`
    SELECT request_count
      FROM api_rate_limit_events
     WHERE route_id = ${API_V1_RATE_LIMIT_ROUTE}
       AND subject_type = 'organization'
       AND subject_key = ${String(orgId)}
       AND window_start = ${monthStart}
     LIMIT 1
  `;
  const used = limitRow ? Number(limitRow.request_count) : 0;

  // Before usage_events.api_key_id exists (its migration), show the total without a breakdown.
  const keyRows = await db<{ key_name: string | null; calls: number | string }[]>`
    SELECT k.name AS key_name, COUNT(*) AS calls
      FROM usage_events ue
      JOIN api_keys k ON k.id = ue.api_key_id
     WHERE ue.organization_id = ${orgId}
       AND ue.created_at >= ${monthStart}
     GROUP BY k.name
  `.catch((err: unknown) => {
    if ((err as { code?: unknown } | null)?.code === "42703") return [];
    throw err;
  });

  const callsByUser = new Map<number, number>();
  for (const row of keyRows) {
    const holderId = subscriberKeyUserId(row.key_name) ?? payerId;
    callsByUser.set(holderId, (callsByUser.get(holderId) ?? 0) + Number(row.calls));
  }

  const ids = [...callsByUser.keys()];
  const labels = new Map<number, string>();
  if (ids.length > 0) {
    const users = await db<{ id: number; display_name: string | null; email: string | null }[]>`
      SELECT id, display_name, email FROM users WHERE id = ANY(${ids}::bigint[])
    `;
    for (const u of users) {
      const label = u.display_name?.trim() || u.email?.trim();
      if (label) labels.set(Number(u.id), label);
    }
  }

  const people = ids
    .map((userId) => ({ userId, label: labels.get(userId) ?? `User ${userId}`, calls: callsByUser.get(userId) ?? 0 }))
    .sort((a, b) => b.calls - a.calls || a.userId - b.userId);

  return { used, allowance: API_MONTHLY_CALLS, people };
}
