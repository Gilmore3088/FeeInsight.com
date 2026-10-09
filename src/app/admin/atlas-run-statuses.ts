import type { AtlasStateLaneDispatchRow } from "@/lib/agents/state-lane-memory";

/**
 * The live status panel announces each fresh read of the run ledger with this event.
 * Panels built from a cached snapshot (the state-lane table) listen so a run the
 * ledger says has finished never stays "Running" beside it.
 */
export const ATLAS_RUN_STATUSES_EVENT = "atlas:run-statuses";

export interface AtlasRunStatusesDetail {
  generatedAt: string;
  runs: Array<{ id: number; status: string }>;
}

const ACTIVE = new Set(["queued", "running", "cancel_requested"]);

const TERMINAL_COPY: Record<string, string> = {
  completed: "Run completed",
  complete: "Run completed",
  failed: "Run failed",
  cancelled: "Run cancelled",
};

/**
 * A lane the snapshot shows as running, checked against the live run ledger. Returns
 * the finished run's status label when the ledger says that run is terminal, or null
 * when the snapshot still agrees with the ledger (or the ledger has not been read).
 */
export function finishedLaneRunLabel(
  row: Pick<AtlasStateLaneDispatchRow, "status" | "activeRunId">,
  liveStatuses: ReadonlyMap<number, string>,
): string | null {
  if (row.status !== "running" || row.activeRunId == null) return null;
  const live = liveStatuses.get(row.activeRunId);
  if (!live || ACTIVE.has(live)) return null;
  return TERMINAL_COPY[live] ?? `Run ${live.replace(/_/g, " ")}`;
}
