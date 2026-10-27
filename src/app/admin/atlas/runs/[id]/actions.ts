"use server";

import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { assertAtlasDispatchReady } from "@/lib/agents/dispatch-readiness";
import { executeAgentRun, getAgentRun, getAgentRunEvents, getAgentRunSteps, startAgentRun } from "@/lib/agents/run-store";
import { STORAGE_COMPACTION_RETRY_OF, STORAGE_ROLLOUT_SOURCE, storageRolloutAction } from "@/lib/agents/hoovie/storage-rollout";
import { readArchiveRolloutProgress } from "@/lib/agents/hoovie/storage-rollout-progress";
import { sql } from "@/lib/data-store/connection";

/** One durable retry of the approved failed canary, through the normal production executor. */
export async function retryStorageCompaction(runId: number): Promise<void> {
  const user = await requireAuth("trigger_jobs");
  if (runId !== STORAGE_COMPACTION_RETRY_OF) throw new Error("Not the approved failed storage canary");
  const run = await getAgentRun(runId);
  if (!run || run.status !== "completed" || storageRolloutAction(run) !== "compact") {
    throw new Error("Not a completed approved compaction run");
  }
  const [steps, events] = await Promise.all([getAgentRunSteps(runId), getAgentRunEvents(runId, 50)]);
  const step = steps.length === 1 && steps[0].stepKey === "atlas-storage-retention" ? steps[0] : null;
  const finished = events.filter((event) => event.stepId === step?.id && event.eventType === "step.finished")
    .sort((a, b) => b.id - a.id)[0];
  const conversion = finished?.detail.storage_compaction as { live?: unknown; error?: unknown } | undefined;
  if (!step || finished?.status !== "completed" || conversion?.live !== true || typeof conversion.error !== "string" || !conversion.error) {
    throw new Error("No failed conversion receipt on the approved canary");
  }
  await assertAtlasDispatchReady(["atlas-storage-retention"]);
  const started = await startAgentRun({
    agent: "atlas", kind: "workflow", triggerSource: "admin", triggeredBy: user.username,
    title: "Approved storage rollout: retry first compaction canary",
    params: { source: STORAGE_ROLLOUT_SOURCE, storageAction: "compact", retryOfRunId: runId },
    idempotencyKey: `atlas:storage-compaction-canary-retry:${runId}:v1`, reuseTerminal: true,
    steps: [{ key: "atlas-storage-retention", agent: "atlas", title: "Retry approved bounded storage conversion" }],
  });
  await executeAgentRun(started.run.id, { maxSteps: 1, allowProviderSteps: false });
  redirect(`/admin/atlas/runs/${started.run.id}`);
}

/** Advance exactly one manifest-pinned archive stage. No request input can select a period. */
export async function advanceApprovedStorageRollout(): Promise<void> {
  const user = await requireAuth("trigger_jobs");
  await assertAtlasDispatchReady(["atlas-storage-retention"]);
  const next = await readArchiveRolloutProgress(sql);
  if (!next) redirect("/admin/atlas/runs/14469");
  const started = await startAgentRun({
    agent: "atlas", kind: "workflow", triggerSource: "admin", triggeredBy: user.username,
    title: `Approved storage rollout: ${next.action} ${next.source} ${next.period}`,
    params: { source: STORAGE_ROLLOUT_SOURCE, storageAction: next.action, storageSource: next.source, storagePeriod: next.period },
    idempotencyKey: `atlas:storage-rollout:${next.source}:${next.period}:${next.action}:v1`, reuseTerminal: true,
    steps: [{ key: "atlas-storage-retention", agent: "atlas", title: `${next.action} approved ${next.source} ${next.period} archive` }],
  });
  await executeAgentRun(started.run.id, { maxSteps: 1, allowProviderSteps: false });
  redirect(`/admin/atlas/runs/${started.run.id}`);
}
