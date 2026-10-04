"use server";

import { revalidatePath, updateTag } from "next/cache";
import { requireAuth } from "@/lib/auth";
import {
  ADMIN_ATLAS_COMMAND_CENTER_CACHE_TAG,
  ADMIN_ATLAS_STATE_LANE_DISPATCH_CACHE_TAG,
} from "@/lib/admin-dashboard-cache";
import {
  engageEmergencyStop,
  recordBillingResolved,
  recordEmergencyStopOutcome,
  resumeAutomation,
  setPipelineEnabled,
} from "@/lib/automation-control";
import { assertAtlasDispatchReady } from "@/lib/agents/dispatch-readiness";
import { cancelAgentRun, cancelAllActiveAgentRuns, startAgentRun } from "@/lib/agents/run-store";
import { scheduleDueStateLaneRuns, startStateLaneRun } from "@/lib/agents/state-lane-scheduler";
import type { AgentRunStepDefinition, AdminAgent } from "@/lib/agents/types";

export type AtlasWorkflowId =
  | "enhance"
  | "discover"
  | "fetch"
  | "read"
  | "extract"
  | "classify"
  | "publish"
  | "review"
  | "public-discovery";

const FULL_CYCLE_STEPS: AgentRunStepDefinition[] = [
  {
    key: "enhance",
    agent: "atlas",
    title: "Refresh institution source attributes",
  },
  {
    key: "discover",
    agent: "magellan",
    title: "Find and verify missing fee schedule URLs",
  },
  {
    key: "fetch",
    agent: "magellan",
    title: "Fetch source fee documents",
  },
  {
    key: "read",
    agent: "rosetta",
    title: "Read PDFs, HTML, and OCR candidates",
  },
  {
    key: "extract",
    agent: "knox",
    title: "Extract fee observations from normalized text",
  },
  {
    key: "classify",
    agent: "darwin",
    title: "Verify fee observations",
  },
  {
    key: "review",
    agent: "knox",
    title: "Escalate anomaly-only human exceptions",
  },
  {
    key: "publish",
    agent: "hamilton",
    title: "Publish clean fee intelligence for product reads",
  },
  {
    key: "public-discovery",
    agent: "magellan",
    title: "Inventory and check public discovery pages",
    input: { public_discovery_limit: 20 },
  },
  {
    key: "public-cluster",
    agent: "darwin",
    title: "Cluster public discovery findings",
  },
  {
    key: "public-diagnose",
    agent: "hamilton",
    title: "Summarize public discovery diagnosis",
  },
];

function refreshAtlasDashboard(): void {
  updateTag(ADMIN_ATLAS_COMMAND_CENTER_CACHE_TAG);
  updateTag(ADMIN_ATLAS_STATE_LANE_DISPATCH_CACHE_TAG);
  revalidatePath("/admin");
}

export async function stopAllAutomation(reason: string): Promise<{
  success: boolean;
  cancelled?: number;
  requested?: number;
  cancellationFailures?: Array<{ runId: number; error: string }>;
  error?: string;
}> {
  const user = await requireAuth("cancel_jobs");
  try {
    // The operator emergency stop halts everything: paid provider calls (global
    // control) and deterministic pipeline work (pipeline control).
    await engageEmergencyStop(user.username, reason);
    await setPipelineEnabled(user.username, false, reason);
    const cancellations = await cancelAllActiveAgentRuns(user.username);
    await recordEmergencyStopOutcome(user.username, cancellations);
    refreshAtlasDashboard();
    return {
      success: true,
      cancelled: cancellations.cancelled,
      requested: cancellations.requested,
      cancellationFailures: cancellations.failed,
    };
  } catch (error) {
    refreshAtlasDashboard();
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function resumeAllAutomation(reason: string): Promise<{
  success: boolean;
  error?: string;
}> {
  const user = await requireAuth("trigger_jobs");
  try {
    await resumeAutomation(user.username, reason);
    await setPipelineEnabled(user.username, true, reason);
    refreshAtlasDashboard();
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Pause or resume deterministic pipeline steps without touching the provider stop. */
export async function setPipelinePaused(paused: boolean, reason: string): Promise<{
  success: boolean;
  error?: string;
}> {
  const user = await requireAuth(paused ? "cancel_jobs" : "trigger_jobs");
  try {
    await setPipelineEnabled(user.username, !paused, reason);
    refreshAtlasDashboard();
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Operator attestation that provider billing is fixed; clears the credit circuit. */
export async function markProviderBillingResolved(reason: string): Promise<{
  success: boolean;
  error?: string;
}> {
  const user = await requireAuth("trigger_jobs");
  try {
    await recordBillingResolved(user.username, reason);
    refreshAtlasDashboard();
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function runAtlasCycle(): Promise<{
  success: boolean;
  runId?: number;
  reused?: boolean;
  error?: string;
}> {
  const user = await requireAuth("trigger_jobs");
  try {
    await assertAtlasDispatchReady();
    const result = await startAgentRun({
      agent: "atlas",
      kind: "workflow",
      title: "Atlas full data cycle",
      params: {
        limit: 100,
        requested_concurrency: 4,
        source: "admin.start_atlas",
      },
      triggeredBy: user.username,
      triggerSource: "admin",
      idempotencyKey: "atlas:full-cycle",
      steps: FULL_CYCLE_STEPS,
      summary: "Agentic run accepted. Watch Atlas live status for step events.",
    });
    refreshAtlasDashboard();
    return { success: true, runId: result.run.id, reused: result.reused };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

const WORKFLOW_JOBS: Record<AtlasWorkflowId, {
  title: string;
  agent: AdminAgent;
  idempotencyKey: string;
  steps: AgentRunStepDefinition[];
}> = {
  enhance: {
    title: "Enhance institution data",
    agent: "atlas",
    idempotencyKey: "atlas:quick-enhance",
    steps: [
      {
        key: "enhance",
        agent: "atlas",
        title: "Refresh institution source attributes",
      },
    ],
  },
  discover: {
    title: "Find missing fee URLs",
    agent: "magellan",
    idempotencyKey: "magellan:quick-discover",
    steps: [
      {
        key: "discover",
        agent: "magellan",
        title: "Find and verify missing fee schedule URLs",
      },
    ],
  },
  fetch: {
    title: "Fetch source documents",
    agent: "magellan",
    idempotencyKey: "magellan:quick-fetch-sources",
    steps: [
      {
        key: "fetch",
        agent: "magellan",
        title: "Fetch source fee documents",
        input: { limit: 500, skip_with_fees: true },
      },
    ],
  },
  read: {
    title: "Read source documents",
    agent: "rosetta",
    idempotencyKey: "rosetta:quick-read-sources",
    steps: [
      {
        key: "read",
        agent: "rosetta",
        title: "Read PDFs, HTML, and OCR candidates",
        input: { limit: 50 },
      },
    ],
  },
  extract: {
    title: "Extract raw fee observations",
    agent: "knox",
    idempotencyKey: "knox:quick-extract-raw-fees",
    steps: [
      {
        key: "extract",
        agent: "knox",
        title: "Extract fee observations from normalized text",
        input: { limit: 500 },
      },
    ],
  },
  classify: {
    title: "Verify raw fees",
    agent: "darwin",
    idempotencyKey: "darwin:quick-classify",
    steps: [
      {
        key: "classify",
        agent: "darwin",
        title: "Verify staged fee observations",
        input: { batch_size: 500, batches: 1 },
      },
    ],
  },
  publish: {
    title: "Publish verified fee intelligence",
    agent: "hamilton",
    idempotencyKey: "hamilton:quick-publish",
    steps: [
      {
        key: "publish",
        agent: "hamilton",
        title: "Publish clean fee intelligence",
        input: { limit: 500 },
      },
    ],
  },
  review: {
    title: "Review exceptions",
    agent: "knox",
    idempotencyKey: "knox:quick-decision-review",
    steps: [
      {
        key: "review",
        agent: "knox",
        title: "Summarize anomaly-only Knox decisions",
      },
    ],
  },
  "public-discovery": {
    title: "Audit public discovery pages",
    agent: "atlas",
    idempotencyKey: "atlas:quick-public-discovery",
    steps: [
      {
        key: "public-discovery",
        agent: "magellan",
        title: "Inventory and check public discovery routes",
        input: { public_discovery_limit: 20 },
      },
      {
        key: "public-cluster",
        agent: "darwin",
        title: "Cluster public discovery findings",
      },
      {
        key: "public-diagnose",
        agent: "hamilton",
        title: "Summarize public discovery diagnosis",
      },
    ],
  },
};

export async function runAtlasWorkflow(workflowId: AtlasWorkflowId): Promise<{
  success: boolean;
  runId?: number;
  title?: string;
  reused?: boolean;
  error?: string;
}> {
  const user = await requireAuth("trigger_jobs");
  const workflow = WORKFLOW_JOBS[workflowId];
  if (!workflow) return { success: false, error: "Unknown Atlas workflow" };

  try {
    await assertAtlasDispatchReady();
    const result = await startAgentRun({
      agent: workflow.agent,
      kind: "workflow_lane",
      title: workflow.title,
      params: {
        workflow_id: workflowId,
        source: "admin.workflow_launcher",
      },
      triggeredBy: user.username,
      triggerSource: "admin",
      idempotencyKey: workflow.idempotencyKey,
      steps: workflow.steps,
      summary: "Agentic run accepted. Watch Atlas live status for step events.",
    });
    refreshAtlasDashboard();
    return {
      success: true,
      runId: result.run.id,
      title: workflow.title,
      reused: result.reused,
    };
  } catch (error) {
    refreshAtlasDashboard();
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function runAtlasDueStateLanes(limit = 2): Promise<{
  success: boolean;
  selected?: number;
  scheduled?: number;
  reused?: number;
  runs?: Array<{ stateCode: string; runId: number; status: string; reused: boolean }>;
  failed?: Array<{ stateCode: string; error: string }>;
  error?: string;
}> {
  const user = await requireAuth("trigger_jobs");
  const safeLimit = Math.min(Math.max(Math.floor(Number(limit) || 2), 1), 10);

  try {
    await assertAtlasDispatchReady();
    const result = await scheduleDueStateLaneRuns({
      limit: safeLimit,
      triggeredBy: user.username,
    });
    refreshAtlasDashboard();
    revalidatePath("/admin/states");
    return {
      success: true,
      selected: result.selected,
      scheduled: result.scheduled,
      reused: result.reused,
      runs: result.results.map((run) => ({
        stateCode: run.stateCode,
        runId: run.runId,
        status: run.status,
        reused: run.reused,
      })),
      failed: result.failed,
    };
  } catch (error) {
    refreshAtlasDashboard();
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function runAtlasStateLane(stateCode: string): Promise<{
  success: boolean;
  stateCode?: string;
  runId?: number;
  status?: string;
  reused?: boolean;
  error?: string;
}> {
  const user = await requireAuth("trigger_jobs");

  try {
    await assertAtlasDispatchReady();
    const result = await startStateLaneRun({
      stateCode,
      triggeredBy: user.username,
      triggerSource: "admin",
      source: "admin.state_lane",
    });
    refreshAtlasDashboard();
    revalidatePath("/admin/states");
    revalidatePath(`/admin/states/${result.stateCode}`);
    return {
      success: true,
      stateCode: result.stateCode,
      runId: result.run.id,
      status: result.run.status,
      reused: result.reused,
    };
  } catch (error) {
    refreshAtlasDashboard();
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function cancelAtlasRun(runId: number): Promise<{
  success: boolean;
  error?: string;
}> {
  const user = await requireAuth("cancel_jobs");
  const result = await cancelAgentRun(runId, user.username);
  refreshAtlasDashboard();
  return result;
}

export async function resumeAtlasCycle(runId: number): Promise<{
  success: boolean;
  runId?: number;
  reused?: boolean;
  error?: string;
}> {
  const user = await requireAuth("trigger_jobs");
  if (!Number.isInteger(runId) || runId < 1) {
    return { success: false, error: "Invalid Atlas pipeline run" };
  }

  try {
    await assertAtlasDispatchReady();
    const result = await startAgentRun({
      agent: "atlas",
      kind: "manual_repair",
      title: `Atlas repair for prior pipeline run #${runId}`,
      params: {
        pipeline_run_id: runId,
        source: "admin.resume_pipeline_run",
      },
      triggeredBy: user.username,
      triggerSource: "admin",
      idempotencyKey: `atlas:resume:${runId}`,
      steps: FULL_CYCLE_STEPS,
      summary: "Agentic repair run accepted. Watch Atlas live status for step events.",
    });
    refreshAtlasDashboard();
    return { success: true, runId: result.run.id, reused: result.reused };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Hamilton category-guard repair (issue #51): roll back live catalog rows whose own
 * name or amount contradicts the category they were filed under. Run the dry run first;
 * its step detail lists counts by category and sample rows.
 */
export async function runCategoryGuardRepair(dryRun: boolean): Promise<{
  success: boolean;
  runId?: number;
  title?: string;
  reused?: boolean;
  error?: string;
}> {
  const user = await requireAuth("trigger_jobs");
  const title = dryRun
    ? "Category guard dry run: find misfiled catalog fees"
    : "Category guard repair: roll back misfiled catalog fees";

  try {
    await assertAtlasDispatchReady();
    const result = await startAgentRun({
      agent: "hamilton",
      kind: dryRun ? "dry_run" : "manual_repair",
      title,
      params: { source: "admin.category_guard_repair" },
      triggeredBy: user.username,
      triggerSource: "admin",
      idempotencyKey: dryRun ? "hamilton:category-guard-dry-run" : "hamilton:category-guard-repair",
      steps: [
        {
          key: "category-guard",
          agent: "hamilton",
          title: dryRun
            ? "Find live fees filed under the wrong category"
            : "Roll back live fees filed under the wrong category",
        },
      ],
      summary: "Agentic run accepted. Watch Atlas live status for step events.",
    });
    refreshAtlasDashboard();
    return { success: true, runId: result.run.id, title, reused: result.reused };
  } catch (error) {
    refreshAtlasDashboard();
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
