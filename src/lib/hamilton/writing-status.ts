/**
 * Whether Hamilton's written commentary can run right now: a read of the budget
 * policies the briefing thesis call is checked against (global, agent:hamilton and
 * the reports route). Read-only; it never calls a provider or records an attempt,
 * so the Benchmark page can say plainly why the commentary is paused instead of
 * attempting (and logging) a blocked call on every page view.
 */

import { sql } from "@/lib/data-store/connection";

export const HAMILTON_WRITING_POLICY_KEYS = [
  "global:provider:default",
  "agent:hamilton",
  "route:api.reports.generate",
] as const;

export interface HamiltonWritingStatus {
  /** False only when a policy is known to block the call; a failed lookup leaves it true. */
  available: boolean;
  /** Policy keys that block the call: missing, disabled, or enabled without any cap. */
  blockingPolicies: string[];
}

interface PolicyRow {
  policy_key: string;
  enabled: boolean;
  has_cap: boolean;
}

export function evaluateHamiltonWritingPolicies(rows: PolicyRow[]): HamiltonWritingStatus {
  const byKey = new Map(rows.map((row) => [row.policy_key, row]));
  const blockingPolicies = HAMILTON_WRITING_POLICY_KEYS.filter((key) => {
    const row = byKey.get(key);
    return !row || !row.enabled || !row.has_cap;
  });
  return { available: blockingPolicies.length === 0, blockingPolicies };
}

export async function getHamiltonWritingStatus(): Promise<HamiltonWritingStatus> {
  try {
    const rows = await sql`
      SELECT policy_key,
             enabled,
             (hard_daily_microusd IS NOT NULL
               OR hard_monthly_microusd IS NOT NULL
               OR max_provider_calls_per_run IS NOT NULL
               OR max_provider_calls_per_tick IS NOT NULL
               OR max_estimated_cost_per_run_microusd IS NOT NULL
               OR max_estimated_cost_per_tick_microusd IS NOT NULL) AS has_cap
        FROM public.api_budget_policies
       WHERE policy_key = ANY(${[...HAMILTON_WRITING_POLICY_KEYS]})
    `;
    return evaluateHamiltonWritingPolicies(
      rows.map((row) => ({
        policy_key: String(row.policy_key),
        enabled: row.enabled === true,
        has_cap: row.has_cap === true,
      })),
    );
  } catch {
    // Unknown: let the briefing try, as it did before; its own guard still blocks.
    return { available: true, blockingPolicies: [] };
  }
}
