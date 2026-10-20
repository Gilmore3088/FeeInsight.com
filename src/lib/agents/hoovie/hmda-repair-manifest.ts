import { createHash } from "node:crypto";
import reviewedManifest from "../../../../docs/project/evidence/2026-10-19-hmda-rerun-manifest.json";

/** Reproduce the reviewed v1 hash protocol, including JSON timestamp precision. */
export function stableHmdaJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
}

export function hashHmdaJson(value: unknown): string {
  return createHash("sha256").update(stableHmdaJson(value)).digest("hex");
}

function freezeReview<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeReview(child);
    Object.freeze(value);
  }
  return value;
}

/** Server-owned review scope. HTTP callers cannot supply or enlarge a manifest. */
export const HMDA_REPAIR_MANIFEST = freezeReview(reviewedManifest);
export const HMDA_REPAIR_MANIFEST_DIGEST = hashHmdaJson(HMDA_REPAIR_MANIFEST);
