import type { sql } from "@/lib/data-store/connection";
import { nextArchiveRolloutAction, STORAGE_ROLLOUT_SOURCE, STORAGE_VERIFIED_CANARY_RUN, type ArchiveRolloutState } from "./storage-rollout";

/** Read committed evidence only; the caller still authenticates and executes through Atlas. */
export async function readArchiveRolloutProgress(db: typeof sql) {
  const [canary] = await db<{ ready: boolean }[]>`
    SELECT EXISTS(SELECT 1 FROM agent_run_events e JOIN agent_run_steps s ON s.id=e.step_id
      WHERE e.agent_run_id=${STORAGE_VERIFIED_CANARY_RUN} AND s.step_key='atlas-storage-retention'
        AND e.event_type='step.finished' AND e.status='completed'
        AND e.detail#>>'{storage_compaction,live}'='true'
        AND e.detail#>>'{storage_compaction,callItems,changed}'='5000'
        AND e.detail#>>'{storage_compaction,hmda,changed}'='5000'
        AND NOT (e.detail->'storage_compaction' ? 'error')) ready
  `;
  if (!canary?.ready) throw new Error("The verified production conversion canary is required");
  const files = await db<Array<{ source: string; period: string; row_count: string; sha256: string; verified: boolean; rehearsed: boolean; pruned: boolean; accepted: boolean }>>`
    WITH completed AS MATERIALIZED (
      SELECT e.detail FROM agent_run_events e JOIN agent_run_steps s ON s.id=e.step_id
        JOIN agent_runs r ON r.id=e.agent_run_id
       WHERE s.step_key='atlas-storage-retention' AND e.event_type='step.finished' AND e.status='completed'
         AND r.params_json->>'source'=${STORAGE_ROLLOUT_SOURCE} AND r.run_kind='workflow' AND r.trigger_source='admin'
    )
    SELECT f.source,f.period,f.row_count::text,f.sha256,f.verified_at IS NOT NULL verified,f.pruned_at IS NOT NULL pruned,
      EXISTS(SELECT 1 FROM completed e
        WHERE e.detail#>>'{cold_tier,rehearsed,source}'=f.source AND e.detail#>>'{cold_tier,rehearsed,period}'=f.period
          AND e.detail#>>'{cold_tier,rehearsed,sha256}'=f.sha256 AND e.detail#>>'{cold_tier,rehearsed,status}'='verified'
          AND e.detail#>>'{storage_preprune_acceptance,sha256}'=f.sha256
          AND e.detail#>>'{storage_preprune_acceptance,source}'=f.source AND e.detail#>>'{storage_preprune_acceptance,period}'=f.period
          AND e.detail#>>'{storage_preprune_acceptance,status}'='verified'
          AND e.detail#>>'{storage_preprune_acceptance,consumersVerified}'='true') rehearsed,
      EXISTS(SELECT 1 FROM completed e
        WHERE e.detail#>>'{storage_read_acceptance,source}'=f.source AND e.detail#>>'{storage_read_acceptance,period}'=f.period
          AND e.detail#>>'{storage_read_acceptance,sha256}'=f.sha256 AND e.detail#>>'{storage_read_acceptance,status}'='verified'
          AND e.detail#>>'{storage_read_acceptance,consumersVerified}'='true') accepted
      FROM public_data_cold_files f WHERE f.table_name='institution_call_report_items'
  `;
  const state: ArchiveRolloutState[] = files.map((file) => ({ ...file, rowCount: Number(file.row_count) }));
  return nextArchiveRolloutAction(state);
}
