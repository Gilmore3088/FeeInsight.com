/**
 * Whether Hamilton's written commentary can run right now: a read of the budget
 * policies the briefing thesis call is checked against (global, agent:hamilton and
 * the reports route). Read-only; it never calls a provider or records an attempt,
 * so the Benchmark page can say plainly why the commentary is paused instead of
 * attempting (and logging) a blocked call on every page view.
 */

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
