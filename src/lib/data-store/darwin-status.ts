import { sql } from "./connection";
import { toISO } from "../pg-helpers";

/**
 * Darwin's counters for its admin panel, read from the fee tiers and the shared run
 * ledger, so scheduled lane work counts the same as a manual repair run. Days are
 * UTC, the window the spend ledger and budget guard use.
 */
export interface DarwinLedgerStatus {
  /** Knox rows with no verified row yet (includes rows Darwin has rejected or holds). */
  unverified: number;
  /** verified_fee_observations rows created since UTC midnight. */
  verifiedToday: number;
  /** The most recently finished Darwin step in agent_run_steps, from any run. */
  lastStep: { runId: number; status: string; at: string } | null;
  readAt: string;
}

export async function getDarwinLedgerStatus(): Promise<DarwinLedgerStatus> {
  const [[counts], [step]] = await Promise.all([
    sql`
      SELECT
        (SELECT COUNT(*)::int FROM raw_fee_observations fr
          WHERE fr.source = 'knox'
            AND NOT EXISTS (SELECT 1 FROM verified_fee_observations fv WHERE fv.fee_raw_id = fr.fee_raw_id)) AS unverified,
        (SELECT COUNT(*)::int FROM verified_fee_observations
          WHERE created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS verified_today
    `,
    sql`
      SELECT agent_run_id, status, completed_at AS at
        FROM agent_run_steps
       WHERE agent_name = 'darwin' AND completed_at IS NOT NULL
       ORDER BY completed_at DESC, id DESC
       LIMIT 1
    `,
  ]);
  const at = step ? toISO(step.at as string | Date | null) : null;
  return {
    unverified: Number(counts?.unverified ?? 0),
    verifiedToday: Number(counts?.verified_today ?? 0),
    lastStep: step && at ? { runId: Number(step.agent_run_id), status: String(step.status), at } : null,
    readAt: new Date().toISOString(),
  };
}
