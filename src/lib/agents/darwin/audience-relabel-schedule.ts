import { sql } from "@/lib/data-store/connection";
import { startAgentRun } from "@/lib/agents/run-store";
import { AUDIENCE_RELABEL_MODE, AUDIENCE_RELABEL_SOURCE, AUDIENCE_RELABEL_VERSION } from "./audience-relabel";

type SqlTag = typeof sql;

/**
 * Queues the relabel step once a day (dry run while off), and once per mode and version when
 * live or rolling back. A free, deterministic step: the pipeline control pauses it.
 */
export async function scheduleAudienceRelabelRun(db: SqlTag = sql, now = new Date()): Promise<{ scheduled: boolean; runId: number | null }> {
  const day = now.toISOString().slice(0, 10);
  const marker = { source: AUDIENCE_RELABEL_SOURCE, mode: AUDIENCE_RELABEL_MODE, version: AUDIENCE_RELABEL_VERSION, ...(AUDIENCE_RELABEL_MODE === "off" ? { day } : {}) };
  const [existing] = await db<Array<{ id: number | string }>>`
    SELECT id FROM agent_runs WHERE agent_name = 'darwin' AND params_json @> ${JSON.stringify(marker)}::jsonb ORDER BY id DESC LIMIT 1
  `;
  if (existing) return { scheduled: false, runId: Number(existing.id) };
  const started = await startAgentRun({
    agent: "darwin",
    kind: AUDIENCE_RELABEL_MODE === "off" ? "dry_run" : "manual_repair",
    title: AUDIENCE_RELABEL_MODE === "off"
      ? "Darwin audience relabel: dry run"
      : AUDIENCE_RELABEL_MODE === "live" ? "Darwin audience relabel" : "Darwin audience relabel: roll back",
    params: marker,
    triggeredBy: "api.admin.agents.tick",
    triggerSource: "schedule",
    idempotencyKey: `darwin:audience-relabel:${AUDIENCE_RELABEL_MODE}:v${AUDIENCE_RELABEL_VERSION}${AUDIENCE_RELABEL_MODE === "off" ? `:${day}` : ""}`,
    steps: [{ key: "audience-relabel", agent: "darwin", title: "Decide the audience of live fees verified as unknown" }],
    summary: "Darwin's audience decision for live fees verified before migration 47 (#1059).",
  });
  return { scheduled: !started.reused, runId: started.run.id };
}
