import { sql } from "@/lib/data-store/connection";
import { startAgentRun } from "@/lib/agents/run-store";
import {
  AUDIENCE_RELABEL_MODE,
  AUDIENCE_RELABEL_SOURCE,
  AUDIENCE_RELABEL_VERSION,
  audienceMigrationReady,
  type AudienceRelabelMode,
} from "./audience-relabel";

type SqlTag = typeof sql;

export interface AudienceRelabelSchedule {
  scheduled: boolean;
  runId: number | null;
  /** Why nothing was queued: "waiting" (a batch is under way), "done", or "migration_47_missing". */
  reason?: string;
  afterId?: number;
}

interface LastBatch {
  id: number | string;
  status: string;
  after_id: number | string | null;
  next_after_id: number | string | null;
  done: boolean | null;
}

/**
 * Queues the relabel step. Off: one dry run a day over that day's sample. Full dry run, live or
 * rollback: one
 * bounded batch at a time, the next from where the last finished, until a batch reports none
 * remaining; a failed batch is queued again from its own cursor. Neither starts before migration
 * 20270110000047, so no run is spent while it is missing. A free, deterministic step: the
 * pipeline control pauses it.
 */
export async function scheduleAudienceRelabelRun(
  db: SqlTag = sql,
  now = new Date(),
  mode: AudienceRelabelMode = AUDIENCE_RELABEL_MODE,
): Promise<AudienceRelabelSchedule> {
  const base = { source: AUDIENCE_RELABEL_SOURCE, mode, version: AUDIENCE_RELABEL_VERSION };
  if (mode === "off") {
    const day = now.toISOString().slice(0, 10);
    const marker = { ...base, day };
    const [existing] = await db<Array<{ id: number | string }>>`
      SELECT id FROM agent_runs WHERE agent_name = 'darwin' AND params_json @> ${JSON.stringify(marker)}::jsonb ORDER BY id DESC LIMIT 1
    `;
    if (existing) return { scheduled: false, runId: Number(existing.id), reason: "done" };
    return start(marker, "dry_run", "Darwin audience relabel: dry run (sample)", `darwin:audience-relabel:off:v${AUDIENCE_RELABEL_VERSION}:${day}`);
  }

  if (mode !== "dry_run_full" && !(await audienceMigrationReady(db))) return { scheduled: false, runId: null, reason: "migration_47_missing" };
  const [last] = await db<LastBatch[]>`
    SELECT r.id, r.status, r.params_json->>'after_id' AS after_id,
           (e.detail->>'next_after_id') AS next_after_id, (e.detail->>'done')::boolean AS done
      FROM agent_runs r
      LEFT JOIN LATERAL (
        SELECT detail FROM agent_run_events
         WHERE agent_run_id = r.id AND event_type = 'step.finished'
         ORDER BY id DESC LIMIT 1
      ) e ON TRUE
     WHERE r.agent_name = 'darwin' AND r.params_json @> ${JSON.stringify(base)}::jsonb
     ORDER BY r.id DESC
     LIMIT 1
  `;
  let afterId = 0;
  if (last) {
    if (["queued", "running", "blocked", "cancel_requested"].includes(last.status)) return { scheduled: false, runId: Number(last.id), reason: "waiting" };
    if (last.status === "completed" || last.status === "complete") {
      if (last.done || last.next_after_id == null) return { scheduled: false, runId: Number(last.id), reason: "done" };
      afterId = Number(last.next_after_id);
    } else {
      // A failed or cancelled batch runs again from its own cursor.
      afterId = Number(last.after_id ?? 0);
    }
  }
  const title = mode === "live" ? "Darwin audience relabel" : mode === "rollback" ? "Darwin audience relabel: roll back" : "Darwin audience relabel: full dry run";
  // The full dry run has its own key chain, so a later live run starts its own from cursor 0.
  const keyMode = mode === "dry_run_full" ? "dry" : mode;
  return {
    ...(await start(
      { ...base, after_id: afterId },
      mode === "dry_run_full" ? "dry_run" : "manual_repair",
      `${title} (after ${afterId})`,
      `darwin:audience-relabel:${keyMode}:v${AUDIENCE_RELABEL_VERSION}:after:${afterId}`,
    )),
    afterId,
  };
}

async function start(params: Record<string, unknown>, kind: "dry_run" | "manual_repair", title: string, idempotencyKey: string): Promise<AudienceRelabelSchedule> {
  const started = await startAgentRun({
    agent: "darwin",
    kind,
    title,
    params,
    triggeredBy: "api.admin.agents.tick",
    triggerSource: "schedule",
    idempotencyKey,
    steps: [{ key: "audience-relabel", agent: "darwin", title: "Decide the audience of live fees verified as unknown" }],
    summary: "Darwin's audience decision for live fees verified before migration 47 (#1059).",
  });
  return { scheduled: !started.reused, runId: started.run.id };
}
