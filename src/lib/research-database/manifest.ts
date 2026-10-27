import { parseReportManifest } from "@/lib/report-engine/reconcile";
import type { ResearchInputs } from "@/lib/data-store/research-database";
import type { ResearchSnapshot } from "./types";
import { researchHash, validateResearchSnapshot } from "./assemble";

export interface ResearchManifest {
  research_snapshot: ResearchSnapshot;
  research_inputs: ResearchInputs;
  research_verification: { verified: boolean; checkedAt: string; snapshotHash: string; kind: "frozen_input_replay" } | null;
}
export function readResearchManifest(value: unknown): ResearchManifest | null {
  const manifest = parseReportManifest(value);
  if (!manifest?.research_snapshot || !manifest.research_inputs) return null;
  return manifest as unknown as ResearchManifest;
}
export function researchReadyToPublish(value: unknown): boolean {
  try {
    const manifest = readResearchManifest(value);
    return !!manifest?.research_verification?.verified
      && manifest.research_verification.kind === "frozen_input_replay"
      && manifest.research_verification.snapshotHash === manifest.research_snapshot.snapshotHash
      && validateResearchSnapshot(manifest.research_snapshot, manifest.research_inputs)
      && manifest.research_snapshot.cells.some(c => c.value !== null);
  } catch { return false; }
}

/** Archived editions retain their original method and do not change when current statistics evolve. */
export function researchReadyToRead(value: unknown): boolean {
  try {
    const manifest = readResearchManifest(value);
    if (!manifest?.research_verification?.verified || manifest.research_verification.kind !== "frozen_input_replay") return false;
    const snapshot = manifest.research_snapshot;
    return manifest.research_verification.snapshotHash === snapshot.snapshotHash
      && researchHash({ ...snapshot, snapshotHash: undefined }) === snapshot.snapshotHash
      && researchHash(manifest.research_inputs) === snapshot.inputHash;
  } catch { return false; }
}
