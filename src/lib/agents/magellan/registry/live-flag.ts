/**
 * Reads a tracker's *_TRACKER_LIVE switch. A value typed into the Vercel dashboard can carry
 * stray spaces, quotes or capitals ("True", " true", "\"true\""); each of those means on.
 * `flagState` says which case applied, without the value, so a run can record why it stayed
 * in shadow mode.
 */
export type LiveFlagState = "on" | "unset" | "not_true";

export function flagState(raw: string | undefined): LiveFlagState {
  if (raw === undefined || raw.trim() === "") return "unset";
  const value = raw.trim().replace(/^["']+|["']+$/g, "").trim().toLowerCase();
  return value === "true" ? "on" : "not_true";
}

export function flagOn(raw: string | undefined): boolean {
  return flagState(raw) === "on";
}
