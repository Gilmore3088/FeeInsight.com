import { CALL_PERIOD_PRUNE_MANIFEST } from "./call-period-prune";

/** James approved the dated staged rollout on October 26; archive actions remain manifest-scoped. */
export const STORAGE_ROLLOUT_SOURCE = "atlas.storage-rollout.2026-10-26";

/** The failed first canary is retried once; this is not a general historical batch launcher. */
export const STORAGE_COMPACTION_RETRY_OF = 13204;
/** Exact equality was independently checked after this completed production canary. */
export const STORAGE_VERIFIED_CANARY_RUN = 14469;
export type ArchiveRolloutAction = "export" | "rehearse" | "prune" | "verify";
export interface ArchiveRolloutState {
  source: string; period: string; rowCount: number; sha256: string;
  verified: boolean; rehearsed: boolean; pruned: boolean; accepted: boolean;
}

/** Finite progression over the already approved manifest; no future quarter is admitted. */
export function nextArchiveRolloutAction(files: readonly ArchiveRolloutState[]): { action: ArchiveRolloutAction; source: string; period: string } | null {
  for (const scope of CALL_PERIOD_PRUNE_MANIFEST) {
    const file = files.find((item) => item.source === scope.source && item.period === scope.period);
    const target = { source: scope.source, period: scope.period };
    if (!file) return { ...target, action: "export" };
    if (!file.verified || file.rowCount !== scope.archiveRows || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("Archive differs from the approved manifest or lacks verification");
    if (!file.rehearsed) return { ...target, action: "rehearse" };
    if (!file.pruned) return { ...target, action: "prune" };
    if (!file.accepted) return { ...target, action: "verify" };
  }
  return null;
}

export function storageRolloutTarget(params: Record<string, unknown>): { source: string; period: string } | undefined {
  if (params.storageSource == null && params.storagePeriod == null) return undefined;
  const target = CALL_PERIOD_PRUNE_MANIFEST.find((item) => item.source === params.storageSource && item.period === params.storagePeriod);
  if (!target || params.source !== STORAGE_ROLLOUT_SOURCE) throw new Error("Storage target is outside the approved manifest");
  return { source: target.source, period: target.period };
}
export function storageRolloutAction(run: {
  agent: string; runKind: string; triggerSource: string; params: Record<string, unknown>;
}, stepInput: Record<string, unknown> = {}): "compact" | "export" | "rehearse" | "prune" | "verify" | null {
  if (run.params.source !== STORAGE_ROLLOUT_SOURCE) return null;
  if (run.agent !== "atlas" || run.runKind !== "workflow" || run.triggerSource !== "admin") {
    throw new Error("Storage rollout requires an admin Atlas workflow");
  }
  const action = stepInput.storageAction ?? run.params.storageAction;
  if (action !== "compact" && action !== "export" && action !== "rehearse" && action !== "prune" && action !== "verify") throw new Error("Unsupported storage rollout action");
  return action;
}
