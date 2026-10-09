import type { AgentRunStepSnapshot } from "@/lib/agents/types";

/** The title of the latest step that finished successfully, or null: a running or failed step is never "last completed". */
export function lastCompletedStepTitle(steps: Array<Pick<AgentRunStepSnapshot, "status" | "sequence" | "title">>): string | null {
  const done = steps
    .filter((step) => step.status === "completed")
    .sort((a, b) => b.sequence - a.sequence);
  return done[0]?.title ?? null;
}
