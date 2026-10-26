/** James approved the dated staged rollout on October 26. Ordinary daily runs stay unchanged. */
export const STORAGE_ROLLOUT_SOURCE = "atlas.storage-rollout.2026-10-26";
export function storageRolloutAction(run: {
  agent: string; runKind: string; triggerSource: string; params: Record<string, unknown>;
}, stepInput: Record<string, unknown> = {}): "compact" | "export" | "rehearse" | "prune" | null {
  if (run.params.source !== STORAGE_ROLLOUT_SOURCE) return null;
  if (run.agent !== "atlas" || run.runKind !== "workflow" || run.triggerSource !== "admin") {
    throw new Error("Storage rollout requires an admin Atlas workflow");
  }
  const action = stepInput.storageAction ?? run.params.storageAction;
  if (action !== "compact" && action !== "export" && action !== "rehearse" && action !== "prune") throw new Error("Unsupported storage rollout action");
  return action;
}
