import type { sql } from "@/lib/data-store/connection";
import { compactCallStorageReady } from "@/lib/data-store/call-item-storage";
import { packHmdaCosts, unpackHmdaCosts } from "@/lib/regulatory/hmda-cost-storage";
import { inSavepoint } from "@/lib/agents/savepoint";
import { HMDA_REPAIR_MANIFEST } from "./hmda-repair-manifest";

type Db = typeof sql;
/** Production history changes require the reviewed rollout; new ingestion already uses compact formats. */
export const STORAGE_COMPACTION_LIVE = false;
const BATCH = 5000;

export interface CompactionReceipt {
  live: boolean;
  callItems: { changed: number; nextAfterId: string };
  hmda: { changed: number; nextAfterId: string; invalid: number };
  error?: string;
}

/** One bounded batch per table, in the storage step's transaction and execution receipt. */
export async function runStorageCompaction(db: Db, options: { live?: boolean; dryRun?: boolean } = {}): Promise<CompactionReceipt> {
  const live = !options.dryRun && (options.live ?? STORAGE_COMPACTION_LIVE);
  const receipt: CompactionReceipt = { live, callItems: { changed: 0, nextAfterId: "0" }, hmda: { changed: 0, nextAfterId: "0", invalid: 0 } };
  if (!live) return receipt;
  try {
    await inSavepoint(db, async (scope) => {
      const [settings]=await scope<{ statement_timeout: string; lock_timeout: string }[]>`
        SELECT current_setting('statement_timeout') AS statement_timeout,current_setting('lock_timeout') AS lock_timeout
      `;
      await scope`SET LOCAL statement_timeout='10s'`;
      const [last] = await scope<{ compaction: CompactionReceipt }[]>`
        SELECT e.detail->'storage_compaction' AS compaction FROM agent_run_events e
          JOIN agent_run_steps s ON s.id=e.step_id
         WHERE s.step_key='atlas-storage-retention' AND e.event_type='step.finished'
           AND e.status='completed' AND e.detail->'storage_compaction'->>'live'='true'
         ORDER BY e.id DESC LIMIT 1
      `;
      const cursor = (raw: unknown): string => typeof raw === "string" && /^\d+$/.test(raw) ? raw : "0";
      if (await compactCallStorageReady(scope)) {
        const [row] = await scope<{ changed: string; through_id: string | null }[]>`
          SELECT changed::text,through_id::text FROM public.compact_call_report_item_metadata(
            ${cursor(last?.compaction?.callItems?.nextAfterId)}::bigint,${BATCH})
        `;
        receipt.callItems = { changed: Number(row?.changed ?? 0), nextAfterId: row?.through_id ?? "0" };
      }
      // A short-wait table lock serializes against annual ingestion and manifest-pinned repairs.
      await scope`SET LOCAL lock_timeout='2s'`;
      await scope`LOCK TABLE hmda_lender_loan_costs IN SHARE ROW EXCLUSIVE MODE NOWAIT`;
      const rows = await scope<Array<{ id: string; cost_detail: unknown }>>`
        SELECT id::text,cost_detail FROM hmda_lender_loan_costs
         WHERE id>${cursor(last?.compaction?.hmda?.nextAfterId)}::bigint
           AND activity_year<>${HMDA_REPAIR_MANIFEST.year}
           AND jsonb_typeof(cost_detail)='object'
         ORDER BY id LIMIT ${BATCH}
      `;
      const replacements: Array<{ id: string; before: unknown; after: unknown }> = [];
      for (const row of rows) {
        receipt.hmda.nextAfterId = row.id;
        const decoded = unpackHmdaCosts(row.cost_detail);
        if (!decoded) { receipt.hmda.invalid++; continue; }
        replacements.push({ id: row.id, before: row.cost_detail, after: packHmdaCosts(decoded) });
      }
      const changed = await scope`
        WITH r AS (SELECT * FROM jsonb_to_recordset(${JSON.stringify(replacements)}::jsonb)
          AS x(id bigint,before jsonb,after jsonb))
        UPDATE hmda_lender_loan_costs c SET cost_detail=r.after FROM r
         WHERE c.id=r.id AND c.cost_detail=r.before RETURNING c.id
      `;
      receipt.hmda.changed = changed.length;
      if(settings){
        await scope`SELECT set_config('statement_timeout',${settings.statement_timeout},true),set_config('lock_timeout',${settings.lock_timeout},true)`;
      }
    });
  } catch (error) {
    // Savepoint rollback also rolls back the cursors' work. Retry exactly this batch next time.
    receipt.callItems = { changed: 0, nextAfterId: "0" };
    receipt.hmda = { changed: 0, nextAfterId: "0", invalid: 0 };
    receipt.error = error instanceof Error ? error.message.slice(0,300) : "Compaction held";
  }
  return receipt;
}
