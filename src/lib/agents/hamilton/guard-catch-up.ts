import { sql } from "@/lib/data-store/connection";
import { startAgentRun } from "@/lib/agents/run-store";
import { CATEGORY_GUARD_VERSION } from "@/lib/fee-category-guard";
import { FREQUENCY_FILL_VERSION } from "@/lib/agents/hamilton/frequency-fill";

type SqlTag = typeof sql;

/**
 * Every publish step re-checks all live guarded fees and frequencies, so a guard or frequency
 * fix reaches live rows without a hand-started run, but only once some lane reaches publish.
 * On 2026-10-09 guard v52 (price ceilings) merged at 01:41 and no publish step ran it by 02:00:
 * the last two ran before the deploy, and the next waited behind paid read steps. This run
 * starts on the first tick after a deploy that raises either version, and once per version
 * pair: a category guard pass and a frequency fill over every live fee. Free steps only.
 */
export const GUARD_CATCH_UP_SOURCE = "hamilton.guard_catch_up";

export interface GuardCatchUpResult {
  scheduled: boolean;
  runId: number | null;
  categoryGuardVersion: number;
  frequencyFillVersion: number;
}

export async function scheduleGuardCatchUpRun(db: SqlTag = sql): Promise<GuardCatchUpResult> {
  const marker = {
    source: GUARD_CATCH_UP_SOURCE,
    category_guard_version: CATEGORY_GUARD_VERSION,
    frequency_fill_version: FREQUENCY_FILL_VERSION,
  };
  const base = { categoryGuardVersion: CATEGORY_GUARD_VERSION, frequencyFillVersion: FREQUENCY_FILL_VERSION };
  const [existing] = await db<Array<{ id: number | string }>>`
    SELECT id FROM agent_runs
     WHERE agent_name = 'hamilton' AND params_json @> ${JSON.stringify(marker)}::jsonb
     ORDER BY id DESC
     LIMIT 1
  `;
  if (existing) return { ...base, scheduled: false, runId: Number(existing.id) };
  const started = await startAgentRun({
    agent: "hamilton",
    kind: "manual_repair",
    title: `Re-check live fees: category guard v${CATEGORY_GUARD_VERSION}, frequency v${FREQUENCY_FILL_VERSION}`,
    params: marker,
    triggeredBy: "api.admin.agents.tick",
    triggerSource: "schedule",
    idempotencyKey: `hamilton:guard-catch-up:g${CATEGORY_GUARD_VERSION}:f${FREQUENCY_FILL_VERSION}`,
    steps: [
      { key: "category-guard", agent: "hamilton", title: "Re-check every live fee against today's category guard" },
      { key: "frequency-fill", agent: "hamilton", title: "Re-read every live fee's frequency from its own schedule row" },
    ],
    summary: "A guard or frequency fix deployed; every live fee is re-checked now rather than at the next publish step.",
  });
  return { ...base, scheduled: !started.reused, runId: started.run.id };
}
