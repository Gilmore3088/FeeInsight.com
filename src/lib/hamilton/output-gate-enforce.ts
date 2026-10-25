/**
 * The one output gate, enforced (#1077, V5 plan T4): one switch that lets `gateAnswer`'s verdict
 * decide on every surface its shadow covers, beside the checks each surface already runs. Pure:
 * no reads, no writes.
 *
 * The switch, `HAMILTON_ANSWER_GATE_ENFORCE`, is off unless set to exactly "true", "1" or "on"
 * (the pattern of `HAMILTON_GATE_REPAIR`, output-gate-repair.ts). While it is off no surface calls
 * anything here on its request path, so what a reader gets is unchanged; the shadow still runs.
 *
 * With it on, each surface asks `enforcedOutcome` what the unified verdict allows:
 * - `held` (or a gate that threw, which fails closed): the surface's own held or withheld reply;
 * - `ready_partial`: shown in part only where the surface already shows partial answers, else held;
 * - `validated`: today's behaviour, today's checks included.
 * Enforcement only adds holds. It never shows what today's checks hold, and an untraced figure is
 * always critical in the gate (James, 2026-10-15), so an answer with one is never shown.
 */

import { gateAnswer, type GateInput, type GateVerdict } from "./output-gate";

/** The environment variable that lets the one output gate decide. Off by default. */
export const ANSWER_GATE_ENFORCE_SWITCH = "HAMILTON_ANSWER_GATE_ENFORCE" as const;

/** True only when `HAMILTON_ANSWER_GATE_ENFORCE` is exactly "true", "1" or "on" (case and spaces aside). */
export function isAnswerGateEnforced(env: Record<string, string | undefined> = process.env): boolean {
  const value = (env[ANSWER_GATE_ENFORCE_SWITCH] || "").trim().toLowerCase();
  return value === "true" || value === "1" || value === "on";
}

/** The `unmatched` line a report section carries when the enforced gate holds it (generateVerifiedSection). */
export const SECTION_GATE_HELD = "a statement that did not pass Hamilton's checks";

/** What the unified verdict allows a surface to do. */
export type EnforcedOutcome = "validated" | "partial" | "held";

/** The gate's verdict, or null when it threw. Never throws. */
export function tryGateAnswer(input: GateInput): GateVerdict | null {
  try {
    return gateAnswer(input);
  } catch (error) {
    console.error("[hamilton] the enforced output gate could not run; the answer is held", error instanceof Error ? error.name : "error");
    return null;
  }
}

/** The outcome for a verdict: a gate that threw holds, and a partial holds where the surface shows no partial answers. */
export function enforcedOutcome(verdict: GateVerdict | null, supportsPartial: boolean): EnforcedOutcome {
  if (!verdict || verdict.status === "held") return "held";
  if (verdict.status === "ready_partial") return supportsPartial ? "partial" : "held";
  return "validated";
}

/** One line per failure for a held reply: a left-out sentence is named by its reason, never quoted. */
export function enforcedProblems(verdict: GateVerdict | null): string[] {
  if (!verdict) return ["Hamilton's checks could not run on this answer."];
  return verdict.failures.map((f) => (f.source === "binding" ? `Left out (${f.code}).` : f.message));
}

/** Today's decision on a streamed written answer, as the route makes it (analyzeAnswerDecision). */
export interface StreamedDecision {
  held: boolean;
  shownText?: string;
}

/**
 * The streamed written answer's decision with the gate enforced. Today's hold stands; the gate's
 * hold is added. A `ready_partial` verdict, where the path shows partial answers, is shown only
 * when every failure is a sentence the binding left out: today's view already cuts exactly those,
 * and the start binding, the final metadata and the saved row already mark them left out. A
 * partial verdict that cuts any other sentence (a cause, advice, an internal name, house wording)
 * is held: the stream's binding and save would still carry that sentence as supported (#1077 T4
 * review). A validated verdict keeps today's decision.
 */
export function enforceStreamedDecision(verdict: GateVerdict | null, today: StreamedDecision, supportsPartial: boolean): StreamedDecision {
  if (today.held) return { held: true };
  const outcome = enforcedOutcome(verdict, supportsPartial);
  if (outcome === "held") return { held: true };
  if (outcome === "validated") return today;
  return verdict!.failures.every((f) => f.source === "binding") ? today : { held: true };
}
