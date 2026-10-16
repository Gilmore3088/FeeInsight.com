/**
 * Saved outputs made before a fee changed (H03-T09, #978). A saved answer, report or briefing
 * keeps the figures it showed when it was made: nothing here rewrites one, and a file already
 * downloaded cannot change. What changes is the notice beside it: when a fee for the saved
 * output's institution was corrected, reversed, held or released after it was saved, the reader
 * is told so and offered a fresh answer from current data.
 *
 * Saved outputs keep no fee ids, so the match is the institution the output is about. An output
 * that used this institution only as a peer is not found (that needs the output to record the
 * fees it read). Pure: no database imports. The reader is `src/lib/data-store/fee-correction-audit.ts`.
 */

export type FeeChangeKind = "correct" | "reverse" | "hold" | "release";

export interface FeeChangeSince {
  kind: FeeChangeKind;
  at: string;
}

export interface SavedOutputNotice {
  /** Plain text for the reader. Never names a fee value or a pipeline step. */
  text: string;
  latestAt: string;
  count: number;
}

/** Saved outputs about one institution made before an operator's change. Null when the table could not be read. */
export interface AffectedSavedOutputs {
  analyses: number | null;
  reports: number | null;
  briefings: number | null;
}

const PHRASE: Record<FeeChangeKind, [string, string]> = {
  correct: ["fee corrected", "fees corrected"],
  reverse: ["correction reversed", "corrections reversed"],
  hold: ["fee taken out for review", "fees taken out for review"],
  release: ["fee returned after review", "fees returned after review"],
};

/** "Oct 16, 2026", in UTC so the server and the reader agree. */
export function noticeDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
}

function time(iso: string): number {
  const at = new Date(iso).getTime();
  return Number.isFinite(at) ? at : NaN;
}

/**
 * The notice for a saved output, or null when no fee for its institution changed after it was
 * saved. Changes at or before `savedAt` are ignored. Pure.
 */
export function savedOutputNotice(changes: FeeChangeSince[], savedAt: string, noun = "answer"): SavedOutputNotice | null {
  const saved = time(savedAt);
  if (!Number.isFinite(saved)) return null;
  const after = changes.filter((change) => time(change.at) > saved);
  if (after.length === 0) return null;
  const latestAt = after.reduce((newest, change) => (time(change.at) > time(newest) ? change.at : newest), after[0].at);
  const counts = new Map<FeeChangeKind, number>();
  for (const change of after) counts.set(change.kind, (counts.get(change.kind) ?? 0) + 1);
  const parts = (["correct", "reverse", "hold", "release"] as const)
    .filter((kind) => counts.has(kind))
    .map((kind) => {
      const n = counts.get(kind) ?? 0;
      return `${n} ${PHRASE[kind][n === 1 ? 0 : 1]}`;
    });
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  const when = after.length === 1 ? ` on ${noticeDate(latestAt)}` : `, the latest on ${noticeDate(latestAt)}`;
  return {
    text:
      `This institution's fee data changed after this ${noun} was saved: ${list}${when}. ` +
      `This ${noun} still shows the figures from when it was saved.`,
    latestAt,
    count: after.length,
  };
}

/** "3 saved answers, 1 report" for the admin audit view; "none" or "unknown" otherwise. Pure. */
export function affectedSavedOutputsLabel(outputs: AffectedSavedOutputs | null): string {
  if (!outputs) return "unknown";
  const parts: string[] = [];
  const add = (n: number | null, one: string, many: string) => {
    if (n != null && n > 0) parts.push(`${n} ${n === 1 ? one : many}`);
  };
  add(outputs.analyses, "saved answer", "saved answers");
  add(outputs.reports, "report", "reports");
  add(outputs.briefings, "briefing", "briefings");
  const unknown = [outputs.analyses, outputs.reports, outputs.briefings].some((n) => n == null);
  if (parts.length === 0) return unknown ? "unknown" : "none";
  return unknown ? `${parts.join(", ")} (some unreadable)` : parts.join(", ");
}
