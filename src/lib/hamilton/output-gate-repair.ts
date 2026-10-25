/**
 * Bounded repair and partial answers over the one output gate (#1077, claim contract step 5;
 * design 2026-10-25, section 2.3).
 *
 * `runGatedAnswer` gates a draft and, when the draft is not `validated`, the verdict is
 * `repairable` and the caller allows one more provider call, asks for ONE rewrite with the
 * failures fed back (as the memo's loop, memo.ts, and the report's figure regeneration,
 * generate.ts, already do). It then keeps the better of the two verdicts. Never a second repair.
 *
 * `gatedAnswerView` is what a reader would be shown for a verdict: the whole text when
 * `validated`, the supported sentences when `ready_partial` (cut sentences and the binding's
 * left-out sentences removed, correction lines first, a lead line), nothing when `held`.
 *
 * Everything that changes what a reader is shown, or adds a provider call, sits behind one
 * switch, `HAMILTON_GATE_REPAIR`, off unless set to "true", "1" or "on". While it is off,
 * callers keep today's gates and make no repair call. Untraced figures stay critical
 * (James, 2026-10-15; answer-gate.ts): an answer that still has one after repair is held.
 */

import type { GateFailure, GateStatus, GateVerdict } from "./output-gate";
import { withoutSentences } from "./written-answer-binding";

/** The environment variable that turns repair and partial answers on. Off by default. */
export const GATE_REPAIR_SWITCH = "HAMILTON_GATE_REPAIR" as const;

/** True only when `HAMILTON_GATE_REPAIR` is exactly "true", "1" or "on". */
export function isGateRepairEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const value = (env[GATE_REPAIR_SWITCH] || "").trim().toLowerCase();
  return value === "true" || value === "1" || value === "on";
}

/** The lead above a partial answer: some sentences were left out. */
export const PARTIAL_ANSWER_LEAD = "Part of this answer was left out because it did not pass Hamilton's checks.";

/** At most this many failure lines are fed back, each cut to this many characters. */
const FEEDBACK_MAX_LINES = 12;
const FEEDBACK_MAX_CHARS = 300;

const STATUS_RANK: Record<GateStatus, number> = { validated: 0, ready_partial: 1, held: 2 };

/** True when `next` is strictly better than `current` by the design's status table (fewer failures breaks a tie). */
export function isBetterVerdict(next: GateVerdict, current: GateVerdict): boolean {
  const a = STATUS_RANK[next.status];
  const b = STATUS_RANK[current.status];
  if (a !== b) return a < b;
  return next.status !== "held" && next.failures.length < current.failures.length;
}

function feedbackLine(failure: GateFailure): string {
  const message = failure.message.replace(/\s+/g, " ").trim();
  const text = message.length > FEEDBACK_MAX_CHARS ? `${message.slice(0, FEEDBACK_MAX_CHARS - 1)}…` : message;
  return failure.source === "binding" ? `Left out (${failure.code}): "${text}"` : text;
}

/** The repair instruction: the gate's own failure lines, nothing from any test case. */
export function repairFeedback(verdict: GateVerdict): string {
  const lines = [...new Set(verdict.failures.filter((f) => f.code !== "nothing_left").map(feedbackLine))].slice(0, FEEDBACK_MAX_LINES);
  const corrections = verdict.corrections.length
    ? `\n\nThe records correct the question. State these corrections instead of the question's figures:\n- ${verdict.corrections.join("\n- ")}`
    : "";
  return "Your last answer did not pass Hamilton's evidence checks. Rewrite the whole answer from the same tool results, " +
    "in the same sections. Fix each problem below; keep every sentence that has no problem as written. " +
    "Use only figures that appear in the tool results, do not recommend raising or lowering a fee, and do not say why a figure moved " +
    "unless the tool results state the cause.\n- " + lines.join("\n- ") + corrections;
}

export type RepairOutcome =
  /** The first draft was validated. */
  | "not_needed"
  /** The verdict needs fresh reads, not a rewrite (`repairable` false). */
  | "not_repairable"
  /** The switch is off, or the caller's budget or quota allows no more calls. */
  | "not_allowed"
  /** The rewrite was made and its verdict is the better one. */
  | "used"
  /** The rewrite was made but was no better, so the first draft stands. */
  | "kept_first"
  /** The rewrite call failed (a provider or budget stop included); the first draft stands. */
  | "failed";

export interface GatedAnswer<T extends { text: string }> {
  draft: T;
  verdict: GateVerdict;
  /** The first draft's verdict, kept for the record. */
  first: GateVerdict;
  /** Provider calls this asked for: 0, or 1 when a rewrite was attempted (a call the budget refused included). */
  repairCalls: 0 | 1;
  repair: RepairOutcome;
  error?: string;
}

export interface RunGatedAnswerInput<T extends { text: string }> {
  /** The first draft, already written (its provider call is the caller's). */
  draft: T;
  gate: (draft: T) => GateVerdict;
  /** Writes the one rewrite. Called at most once. */
  repair: (feedback: string, draft: T, verdict: GateVerdict) => Promise<T>;
  /** Whether one more provider call is allowed: the switch, then the budget and quota. Checked only when a repair would run. */
  allowRepair: () => boolean | Promise<boolean>;
}

/** Gate, repair once when allowed, keep the better verdict (design 2.3). Never throws for a failed rewrite. */
export async function runGatedAnswer<T extends { text: string }>(input: RunGatedAnswerInput<T>): Promise<GatedAnswer<T>> {
  const first = input.gate(input.draft);
  const kept = (repair: RepairOutcome, extra: Partial<GatedAnswer<T>> = {}): GatedAnswer<T> =>
    ({ draft: input.draft, verdict: first, first, repairCalls: 0, repair, ...extra });
  if (first.status === "validated") return kept("not_needed");
  if (!first.repairable) return kept("not_repairable");
  let allowed = false;
  try { allowed = await input.allowRepair(); } catch { allowed = false; }
  if (!allowed) return kept("not_allowed");
  let rewritten: T;
  try {
    rewritten = await input.repair(repairFeedback(first), input.draft, first);
  } catch (error) {
    return kept("failed", { repairCalls: 1, error: error instanceof Error ? error.message : String(error) });
  }
  const second = input.gate(rewritten);
  if (isBetterVerdict(second, first)) return { draft: rewritten, verdict: second, first, repairCalls: 1, repair: "used" };
  return kept("kept_first", { repairCalls: 1 });
}

export interface GatedAnswerView {
  status: GateStatus;
  /** The text a reader is shown; null when the answer is held. */
  text: string | null;
  /** The lead above a partial answer; null when nothing was cut. */
  lead: string | null;
  /** Correction lines for the question's premises, shown first. */
  corrections: string[];
  /** Sentences left out of the view. */
  leftOut: number;
}

/** What a reader is shown for a verdict (design 2.3's table). */
export function gatedAnswerView(text: string, verdict: GateVerdict): GatedAnswerView {
  if (verdict.status === "held") return { status: "held", text: null, lead: null, corrections: [], leftOut: 0 };
  const cut = new Set([
    ...verdict.failures.flatMap((f) => f.sentences ?? []),
    ...(verdict.binding?.omitted ?? []).map((o) => o.text),
  ].map((s) => s.trim()).filter(Boolean));
  const shown = withoutSentences(text, cut);
  return {
    status: verdict.status,
    text: shown,
    lead: verdict.status === "ready_partial" && cut.size > 0 ? PARTIAL_ANSWER_LEAD : null,
    corrections: verdict.corrections,
    leftOut: cut.size,
  };
}
