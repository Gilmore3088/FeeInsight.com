"use server";

import { requireAuth } from "@/lib/auth";
import { assertAtlasDispatchReady } from "@/lib/agents/dispatch-readiness";
import { startAgentRun } from "@/lib/agents/run-store";
import { getExecutionBackendStatus } from "@/lib/execution-backend";
import type { DarwinStatus } from "./types";

export async function fetchDarwinStatus(): Promise<DarwinStatus> {
  await requireAuth("operate");
  const backend = getExecutionBackendStatus();
  return {
    pending: 0,
    today_promoted: 0,
    today_cost_usd: 0,
    circuit: { halted: !backend.enabled, reason: backend.enabled ? null : backend.detail },
    recent_run_avg_tokens_per_row: null,
  };
}

export async function resetDarwinCircuit(actor: string): Promise<{ ok: boolean }> {
  await requireAuth("trigger_jobs");
  void actor;
  return { ok: false };
}

export async function runDarwinRepair(
  size: number,
  batches: number,
): Promise<{ success: boolean; jobId?: number; reused?: boolean; error?: string }> {
  const user = await requireAuth("trigger_jobs");
  if (![100, 500, 1000].includes(size) || !Number.isInteger(batches) || batches < 1 || batches > 20) {
    return { success: false, error: "Invalid classification batch request" };
  }
  try {
    await assertAtlasDispatchReady();
    const result = await startAgentRun({
      agent: "darwin",
      kind: "workflow_lane",
      title: "Darwin classification repair",
      params: { size, batches, source: "admin.darwin_repair" },
      triggeredBy: user.username,
      triggerSource: "admin",
      idempotencyKey: "darwin:classification-repair",
      steps: [
        {
          key: "classify",
          agent: "darwin",
          title: "Classify staged fee observations",
          input: { size, batches },
        },
        {
          key: "verify",
          agent: "darwin",
          title: "Verify canonical category and amount confidence",
        },
        {
          key: "review",
          agent: "knox",
          title: "Escalate anomaly-only exceptions",
        },
      ],
      summary: "Agentic Darwin run accepted. Watch Atlas live status for step events.",
    });
    return { success: true, jobId: result.run.id, reused: result.reused };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function fetchDarwinReasoning(feeRawId: number): Promise<{
  reasoning_prompt: string | null;
  reasoning_output: string | null;
  reasoning_r2_key: string | null;
  created_at: string | null;
}> {
  await requireAuth("operate");
  const { sql } = await import("@/lib/data-store/connection");
  const rows = await sql`
    SELECT reasoning_prompt_text, reasoning_output_text, reasoning_r2_key, created_at::text AS created_at
      FROM agent_events
     WHERE agent_name = 'darwin'
       AND (
         (entity = 'verified_fee_observations' AND entity_id = ${String(feeRawId)})
         OR (entity = 'classification_cache' AND input_payload::text LIKE ${`%${feeRawId}%`})
       )
     ORDER BY created_at DESC
     LIMIT 1
  `;
  const first = rows[0] as {
    reasoning_prompt_text?: string;
    reasoning_output_text?: string;
    reasoning_r2_key?: string;
    created_at?: string;
  } | undefined;
  return {
    reasoning_prompt: first?.reasoning_prompt_text ?? null,
    reasoning_output: first?.reasoning_output_text ?? null,
    reasoning_r2_key: first?.reasoning_r2_key ?? null,
    created_at: first?.created_at ?? null,
  };
}

export async function fetchReasoningFromR2(
  r2Key: string,
): Promise<{ prompt: string | null; output: string | null }> {
  await requireAuth("operate");
  if (!r2Key) return { prompt: null, output: null };
  void r2Key;
  return { prompt: null, output: null };
}

export async function reclassifyFee(feeRawId: number): Promise<{
  fee_raw_id: number;
  fee_name: string | null;
  normalized_name: string | null;
  prompt: string | null;
  output: string | null;
  error?: string;
}> {
  await requireAuth("trigger_jobs");
  return {
    fee_raw_id: feeRawId,
    fee_name: null,
    normalized_name: null,
    prompt: null,
    output: null,
    error: getExecutionBackendStatus().detail,
  };
}
