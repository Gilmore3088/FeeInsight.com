import type { sql } from "./data-store/connection";

/**
 * Incurred provider work is separate from a usable answer. Failed usage counts only
 * with recorder-authenticated observed provenance; unknown failures/blocks do not.
 * Zero observed tokens still consume request_count. NULL estimates remain unknown.
 */
export function isIncurredProviderUsage(status: string, observation?: string): boolean {
  return status === "completed" || (status === "failed" && observation === "observed");
}

/** Trusted, parenthesized fragment for the current single-table usage-event readers. */
export function incurredProviderUsageSql(db: typeof sql) {
  return db`(status = 'completed' OR (status = 'failed' AND metadata->>'usage_observation' = 'observed'))`;
}
