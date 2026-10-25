/**
 * Where the one output gate's shadow verdicts are kept (#1077, claim contract step 4): in the run
 * ledger, as `gate_shadow` in a Pro request run's params (agent_runs.params_json, with its step and
 * event). No table or migration: a written answer gets its own `pro.answer_gate_shadow` run; the
 * Ask memo and the Simulate stream add the record to the run they already write. Server only.
 */

import { recordProRequest } from "@/lib/agents/run-store";
import { sql } from "@/lib/data-store/connection";
import { readGateShadowRecord, tallyGateShadow, type GateShadowRecord, type GateShadowTally } from "./output-gate-shadow";

/** The params key every shadow record rides under. */
export const GATE_SHADOW_DETAIL_KEY = "gate_shadow";

export function shadowSummary(record: GateShadowRecord): string {
  if (record.error) return `Shadow gate could not run (${record.error}); today's decision (${record.today}) stands.`;
  return `Shadow gate: ${record.unified.replace("_", " ")}; today: ${record.today.replace("_", " ")}${record.disagreement ? `; disagrees (${record.disagreement.replace("_", " ")})` : "; agrees"}.`;
}

/** Records a written answer's shadow verdict as its own run. Never throws (recordProRequest does not). */
export async function recordWrittenAnswerShadow(record: GateShadowRecord, context: { userId: number | null; researchInstitutionId: number | null }): Promise<number | null> {
  return recordProRequest({
    operation: "answer_gate_shadow",
    title: `Hamilton gate shadow: written answer (${record.path === "written_buffered" ? "buffered" : "streaming"})`,
    status: "completed",
    summary: shadowSummary(record),
    userId: context.userId,
    // Kept inside the record's params, not as the run's institution, so a shadow run never counts as a request on it.
    detail: { [GATE_SHADOW_DETAIL_KEY]: record, research_institution_id: context.researchInstitutionId },
  });
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
