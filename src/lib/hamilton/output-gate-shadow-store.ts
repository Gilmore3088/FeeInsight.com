/**
 * Where the one output gate's shadow verdicts are kept (#1077, claim contract step 4): in the run
 * ledger, one `pro.answer_gate_shadow` run per verdict, with the record as `gate_shadow` in its
 * params (agent_runs.params_json, with its step and event). No table or migration. Server only.
 *
 * Every shadow is computed and written after the response (`scheduleGateShadow`, Next's `after()`):
 * nothing a reader waits on awaits it, and a shadow that fails never reaches the response.
 */

import { after } from "next/server";
import { recordProRequest } from "@/lib/agents/run-store";
import { sql } from "@/lib/data-store/connection";
import { readGateShadowRecord, tallyGateShadow, type GateShadowRecord, type GateShadowTally } from "./output-gate-shadow";

/** The params key every shadow record rides under. */
export const GATE_SHADOW_DETAIL_KEY = "gate_shadow";

const SURFACE_LABEL: Record<GateShadowRecord["surface"], string> = {
  written_answer: "written answer", memo: "memo", report_section: "report section", simulate: "Simulate read",
};

export function shadowSummary(record: GateShadowRecord): string {
  if (record.error) return `Shadow gate could not run (${record.error}); today's decision (${record.today}) stands.`;
  return `Shadow gate: ${record.unified.replace("_", " ")}; today: ${record.today.replace("_", " ")}${record.disagreement ? `; disagrees (${record.disagreement.replace("_", " ")})` : "; agrees"}.`;
}

export interface GateShadowContext {
  userId: number | null;
  researchInstitutionId: number | null;
}

/** Records a shadow verdict as its own run. Never throws (recordProRequest does not). */
export async function recordGateShadow(record: GateShadowRecord, context: GateShadowContext): Promise<number | null> {
  return recordProRequest({
    operation: "answer_gate_shadow",
    title: `Hamilton gate shadow: ${SURFACE_LABEL[record.surface] ?? record.surface} (${record.path.replace(/_/g, " ")})`,
    status: "completed",
    summary: shadowSummary(record),
    userId: context.userId,
    // Kept inside the record's params, not as the run's institution, so a shadow run never counts as a request on it.
    detail: { [GATE_SHADOW_DETAIL_KEY]: record, research_institution_id: context.researchInstitutionId },
  });
}

/**
 * Computes and records a shadow verdict after the response. `compute` must close over values
 * captured now, never over state that changes later. Never throws, never makes the caller wait:
 * inside a request it is handed to `after()`; outside one (tests, scripts) it starts unawaited.
 */
export function scheduleGateShadow(compute: () => GateShadowRecord, context: GateShadowContext): void {
  const task = async () => {
    try {
      await recordGateShadow(compute(), context);
    } catch (error) {
      console.error("[hamilton] the shadow output gate could not be recorded", error);
    }
  };
  try {
    after(task);
  } catch {
    void task();
  }
}

/**
 * Every shadow record of the last `days` days, counted (tallyGateShadow): agreements, each kind of
 * disagreement, what the unified gate would hold for, per surface and path.
 */
export async function countGateShadowDisagreements(days = 7, db: typeof sql = sql): Promise<GateShadowTally> {
  const rows = await db<Array<{ record: unknown }>>`
    SELECT params_json->${GATE_SHADOW_DETAIL_KEY} AS record
      FROM agent_runs
     WHERE run_kind = 'pro_request'
       AND params_json ? ${GATE_SHADOW_DETAIL_KEY}
       AND started_at >= NOW() - make_interval(days => ${days})
  `;
  return tallyGateShadow([...rows].map((row) => readGateShadowRecord(row.record)).filter((r): r is GateShadowRecord => r !== null));
}
