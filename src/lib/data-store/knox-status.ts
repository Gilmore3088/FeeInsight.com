import { sql } from "./connection";
import { toISO } from "../pg-helpers";

/**
 * Knox's headline numbers for its admin page, read from raw_fee_observations and the shared
 * run ledger: what it extracted in the last 24 hours, what still waits for Darwin, and its
 * newest finished step.
 */
export interface KnoxStatus {
  /** Raw fee rows Knox wrote in the last 24 hours. */
  fees24h: number;
  /** Distinct source documents those rows came from. */
  documents24h: number;
  /** Knox rows with no verified row yet (Darwin's queue, including rows it rejected or holds). */
  waitingForDarwin: number;
  lastStep: { runId: number; status: string; at: string } | null;
  readAt: string;
}

export async function getKnoxStatus(): Promise<KnoxStatus> {
  const [[counts], [step]] = await Promise.all([
    sql`
      SELECT
        (SELECT COUNT(*)::int FROM raw_fee_observations
          WHERE source = 'knox' AND created_at >= NOW() - INTERVAL '24 hours') AS fees_24h,
        (SELECT COUNT(DISTINCT source_document_id)::int FROM raw_fee_observations
          WHERE source = 'knox' AND created_at >= NOW() - INTERVAL '24 hours') AS documents_24h,
        (SELECT COUNT(*)::int FROM raw_fee_observations fr
          WHERE fr.source = 'knox'
            AND NOT EXISTS (SELECT 1 FROM verified_fee_observations fv WHERE fv.fee_raw_id = fr.fee_raw_id)) AS waiting
    `,
    sql`
      SELECT agent_run_id, status, completed_at AS at
        FROM agent_run_steps
       WHERE agent_name = 'knox' AND completed_at IS NOT NULL
       ORDER BY completed_at DESC, id DESC
       LIMIT 1
    `,
  ]);
  const at = step ? toISO(step.at as string | Date | null) : null;
  return {
    fees24h: Number(counts?.fees_24h ?? 0),
    documents24h: Number(counts?.documents_24h ?? 0),
    waitingForDarwin: Number(counts?.waiting ?? 0),
    lastStep: step && at ? { runId: Number(step.agent_run_id), status: String(step.status), at } : null,
    readAt: new Date().toISOString(),
  };
}
