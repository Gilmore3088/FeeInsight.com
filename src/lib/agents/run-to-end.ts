import { executeAgentRun, type AgentRunExecutionResult } from "@/lib/agents/run-store";

type Execute = typeof executeAgentRun;

export interface RunToEndResult {
  result: AgentRunExecutionResult;
  /** Steps executed across every pass. */
  executedSteps: number;
  /** True when the run still has queued steps: a pause, the deadline, or the pass limit held them. */
  leftQueued: boolean;
}

/**
 * Runs a run's steps in passes of `executeAgentRun`'s ten-step ceiling until it ends, makes no
 * progress, or the deadline would be passed, so a run longer than ten steps never strands its
 * tail silently (#1579). Steps that cannot finish by `deadlineAt` stay queued for the tick.
 */
export async function executeAgentRunToEnd(
  runId: number,
  { deadlineAt, maxPasses = 3, execute = executeAgentRun }: { deadlineAt?: number; maxPasses?: number; execute?: Execute } = {},
): Promise<RunToEndResult> {
  let executedSteps = 0;
  let result: AgentRunExecutionResult | null = null;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    result = await execute(runId, { maxSteps: 10, deadlineAt, alwaysRunFirstStep: pass === 0 });
    executedSteps += result.executedSteps;
    if (result.terminal || result.executedSteps === 0) break;
  }
  const last = result as AgentRunExecutionResult;
  return { result: { ...last, executedSteps }, executedSteps, leftQueued: !last.terminal };
}
