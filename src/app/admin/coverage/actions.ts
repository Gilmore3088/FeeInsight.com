"use server";

import { requireAuth } from "@/lib/auth";
import { assertAtlasDispatchReady } from "@/lib/agents/dispatch-readiness";
import { startAgentRun } from "@/lib/agents/run-store";
import { getExecutionBackendStatus } from "@/lib/execution-backend";
import { sql } from "@/lib/data-store/connection";
import type { MagellanStatus } from "./types";

export async function fetchMagellanStatus(): Promise<MagellanStatus> {
  await requireAuth("operate");
  const backend = getExecutionBackendStatus();
  const [row] = await sql`
    SELECT
      COUNT(*) FILTER (
        WHERE COALESCE(status, 'active') = 'active'
          AND (fee_schedule_url IS NULL OR btrim(fee_schedule_url) = '')
          AND website_url IS NOT NULL
          AND btrim(website_url) <> ''
      )::int AS pending,
      COUNT(*) FILTER (WHERE rescue_status = 'rescued')::int AS rescued,
      COUNT(*) FILTER (WHERE rescue_status = 'dead')::int AS dead,
      COUNT(*) FILTER (WHERE rescue_status = 'needs_human')::int AS needs_human,
      COUNT(*) FILTER (WHERE rescue_status = 'retry_after')::int AS retry_after
    FROM institution_sources
  `;
  return {
    pending: Number(row?.pending ?? 0),
    circuit: { halted: !backend.enabled, reason: backend.enabled ? null : backend.detail },
    rescued: Number(row?.rescued ?? 0),
    dead: Number(row?.dead ?? 0),
    needs_human: Number(row?.needs_human ?? 0),
    retry_after: Number(row?.retry_after ?? 0),
    today_cost_usd: 0,
  };
}

export async function resetMagellanCircuit(actor: string): Promise<{ ok: boolean }> {
  await requireAuth("trigger_jobs");
  void actor;
  return { ok: false };
}

export async function runMagellanRepair(
  size: number,
  batches: number,
): Promise<{ success: boolean; jobId?: number; reused?: boolean; error?: string }> {
  const user = await requireAuth("trigger_jobs");
  if (![100, 500, 1000].includes(size) || !Number.isInteger(batches) || batches < 1 || batches > 20) {
    return { success: false, error: "Invalid repair batch request" };
  }
  try {
    await assertAtlasDispatchReady();
    const result = await startAgentRun({
      agent: "magellan",
      kind: "workflow_lane",
      title: "Magellan fee URL rescue",
      params: { size, batches, limit: size * batches, source: "admin.magellan.rescue" },
      triggeredBy: user.username,
      triggerSource: "admin",
      idempotencyKey: "magellan:rescue",
      steps: [
        {
          key: "rescue",
          agent: "magellan",
          title: "Resolve failed fee schedule discovery/fetch candidates",
          input: { size, batches },
        },
        {
          key: "read",
          agent: "rosetta",
          title: "Read rescued source documents",
        },
        {
          key: "extract",
          agent: "knox",
          title: "Extract fee observations from rescued documents",
        },
      ],
      summary: "Agentic Magellan run accepted. Watch Atlas live status for step events.",
    });
    return { success: true, jobId: result.run.id, reused: result.reused };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
