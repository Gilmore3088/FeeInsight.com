import type { sql } from "@/lib/data-store/connection";
import { inSavepoint } from "@/lib/agents/savepoint";

type SqlTag = typeof sql;
const DEFAULT_OUTCOME = "failed, nothing written";

/**
 * A publish-step sub-check that failed without failing the publish (its own savepoint rolled its
 * writes back) leaves a `step.warning` run event, so the run ledger shows the failure and not only
 * the server log. Returns the error text for the step detail. The event write runs in its own
 * savepoint: if it fails too, the publish still carries on. `outcome` says what the failure left
 * behind (default "failed, nothing written"); a failed read passes "read failed".
 */
export async function recordStepWarning(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; check: string; what: string; outcome?: string; error: unknown },
): Promise<string> {
  const message = options.error instanceof Error ? options.error.message : String(options.error);
  try {
    await inSavepoint(db, (scope) => scope`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (${options.runId}, ${options.stepId ?? null}, 'step.warning', 'info',
              ${`${options.what} ${options.outcome ?? DEFAULT_OUTCOME}: ${message}`},
              ${JSON.stringify({ check: options.check, error: message })}::jsonb)
    `);
  } catch (eventError) {
    console.error(`${options.what} warning event failed:`, eventError);
  }
  return message;
}
