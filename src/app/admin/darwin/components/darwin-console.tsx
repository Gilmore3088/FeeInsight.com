"use client";

import { useEffect, useState, useCallback } from "react";
import {
  BatchRunner,
  type BatchSizeOption,
} from "@/components/agent-console/batch-runner";
import { JobLaunchReceipt } from "@/components/agent-console/job-launch-receipt";
import { triggerAgentRunExecution } from "@/lib/agents/client-execution";
import { CircuitBanner } from "@/components/agent-console/circuit-banner";
import { BudgetGauge } from "./budget-gauge";
import { fetchDarwinStatus, runDarwinRepair } from "../actions";
import type { DarwinStatus } from "../types";

type QueuedJob = {
  id: number;
  limit: number;
  reused: boolean;
};

/**
 * Darwin's controls: its counters, and a button that queues one verify step. The decision
 * stream, its reasoning drawer and the re-classify and circuit-reset buttons were removed in
 * #1115 step 4: they read tables nothing writes (`agent_events`, `classification_cache`) or
 * called stub actions that did nothing. Darwin's steps are on the Log card below and in Atlas.
 */
export function DarwinConsole({ initialStatus }: { initialStatus: DarwinStatus }) {
  const [status, setStatus] = useState<DarwinStatus>(initialStatus);
  const [running, setRunning] = useState(false);
  const [queuedJob, setQueuedJob] = useState<QueuedJob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try { setStatus(await fetchDarwinStatus()); } catch {}
  }, []);

  const start = useCallback(async (size: BatchSizeOption, chain: number) => {
    setRunning(true);
    setQueuedJob(null);
    setError(null);
    try {
      const result = await runDarwinRepair(size, chain);
      if (!result.success) {
        setError(result.error ?? "Darwin verify run could not be queued");
      } else if (typeof result.jobId === "number") {
        setQueuedJob({ id: result.jobId, limit: result.limit ?? size * chain, reused: Boolean(result.reused) });
        window.dispatchEvent(new CustomEvent("atlas:started", {
          detail: {
            runId: result.jobId,
            title: "Darwin verify run",
            label: "Darwin verify",
            agent: "darwin",
            reused: result.reused,
            startedAt: new Date().toISOString(),
          },
        }));
        triggerAgentRunExecution(result.jobId);
      }
    } finally {
      setRunning(false);
      await refreshStatus();
    }
  }, [refreshStatus]);

  useEffect(() => {
    const id = setInterval(refreshStatus, 10_000);
    return () => clearInterval(id);
  }, [refreshStatus]);

  const disabledReason = status.circuit.halted
    ? status.circuit.reason
      ? `Circuit halted: ${status.circuit.reason}`
      : "Circuit halted"
    : undefined;

  return (
    <div className="space-y-4">
      <CircuitBanner status={status} />
      <BudgetGauge status={status} />
      <BatchRunner
        onStart={start}
        disabled={running || Boolean(disabledReason)}
        busy={running}
        disabledReason={disabledReason}
        title="Verify Knox rows"
        description="Queue one Darwin verify step, as a state lane runs it. One step reads at most 500 rows; it writes verified rows and decisions."
        actionLabel="Start verify run"
        unitLabel="rows"
      />
      {queuedJob && (
        <JobLaunchReceipt
          jobId={queuedJob.id}
          title="Darwin verify"
          owner="darwin"
          command={`Darwin verify step: up to ${queuedJob.limit.toLocaleString("en-US")} rows`}
          scope={`${queuedJob.limit.toLocaleString("en-US")} rows · one step`}
          reused={queuedJob.reused}
          detail="Darwin created a visible verify run. The agentic runner attaches step events as the step executes."
        />
      )}
      {error && <p role="alert" className="text-xs text-red-700 dark:text-red-400">{error}</p>}
    </div>
  );
}
