"use server";

import { requireAuth } from "@/lib/auth";
import { assertAtlasDispatchReady } from "@/lib/agents/dispatch-readiness";
import { DARWIN_VERIFY_MAX_LIMIT } from "@/lib/agents/darwin/verify";
import { startAgentRun } from "@/lib/agents/run-store";
import type { AgentRunStepDefinition } from "@/lib/agents/types";
import { getExecutionBackendStatus } from "@/lib/execution-backend";
import { getAgentSpendToday } from "@/lib/data-store/console-spend";
import { getDarwinLedgerStatus } from "@/lib/data-store/darwin-status";
import type { DarwinStatus } from "./types";

export async function fetchDarwinStatus(): Promise<DarwinStatus> {
  await requireAuth("operate");
  const backend = getExecutionBackendStatus();
  const [ledger, spend] = await Promise.all([
    getDarwinLedgerStatus().catch((error) => {
      console.error("Darwin ledger status failed", error);
      return null;
    }),
    getAgentSpendToday("darwin"),
  ]);
  return {
    pending: ledger?.unverified ?? null,
    today_promoted: ledger?.verifiedToday ?? null,
    today_cost_usd: spend?.todayUsd ?? null,
    circuit: { halted: !backend.enabled, reason: backend.enabled ? null : backend.detail },
    last_step: ledger?.lastStep
      ? { run_id: ledger.lastStep.runId, status: ledger.lastStep.status, at: ledger.lastStep.at }
      : null,
    as_of: ledger?.readAt ?? spend?.readAt ?? null,
  };
}

/**
 * Queues one Darwin verify step for up to `size × batches` rows, capped at one step's limit
 * (`DARWIN_VERIFY_MAX_LIMIT`). It runs the same step a state lane runs, so it writes what that step
 * writes: verified rows and their decisions, and the held-fee passes after it (#1115). It used to
 * queue "classify" and "verify", which run the same code, plus Knox's retired review step.
 */
export async function runDarwinRepair(
  size: number,
  batches: number,
): Promise<{ success: boolean; jobId?: number; reused?: boolean; limit?: number; error?: string }> {
  const user = await requireAuth("trigger_jobs");
  if (![100, 500, 1000].includes(size) || !Number.isInteger(batches) || batches < 1 || batches > 20) {
    return { success: false, error: "Invalid verify run request" };
  }
  const limit = Math.min(size * batches, DARWIN_VERIFY_MAX_LIMIT);
  try {
    const steps: AgentRunStepDefinition[] = [
      {
        key: "verify",
        agent: "darwin",
        title: "Verify Knox rows due for a decision",
        input: { verify_limit: limit },
      },
    ];
    await assertAtlasDispatchReady(steps.map((step) => step.key));
    const result = await startAgentRun({
      agent: "darwin",
      kind: "workflow_lane",
      title: "Darwin verify run",
      params: { size, batches, verify_limit: limit, source: "admin.darwin_repair" },
      triggeredBy: user.username,
      triggerSource: "admin",
      idempotencyKey: "darwin:classification-repair",
      steps,
      summary: "Darwin verify run accepted. Watch Atlas live status for step events.",
    });
    return { success: true, jobId: result.run.id, reused: result.reused, limit };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
