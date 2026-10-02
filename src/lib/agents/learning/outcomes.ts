/**
 * Typed attempt outcomes. Every attempt an agent makes ends in exactly one of these;
 * free-text-only failures are not allowed. Keep this list in sync with the
 * `pipeline_attempts_outcome_check` constraint (a test enforces it).
 */

export const ATTEMPT_STAGES = ["discover", "fetch", "read", "extract", "verify", "publish"] as const;
export type AttemptStage = (typeof ATTEMPT_STAGES)[number];

export const ATTEMPT_OUTCOMES = [
  "ok",
  "ok_partial",
  "unchanged",
  "invalid_url",
  "http_403",
  "http_404",
  "http_410",
  "http_429",
  "http_5xx",
  "http_other",
  "timeout",
  "network_error",
  "too_large",
  "blocked_bot",
  "js_required",
  "scanned_pdf",
  "empty",
  "parse_error",
  "unsupported_format",
  "wrong_document",
  "no_candidates",
  "low_yield",
  "evidence_mismatch",
  "budget_blocked",
] as const;
export type AttemptOutcome = (typeof ATTEMPT_OUTCOMES)[number];

/** Outcomes that count as a success for strategy statistics. */
const SUCCESS_OUTCOMES = new Set<AttemptOutcome>(["ok", "ok_partial", "unchanged", "low_yield"]);

/**
 * Outcomes that will repeat for the same input and the same strategy version.
 * Once recorded, that (stage, strategy, version, fingerprint) is never retried:
 * only new content or a new strategy version earns another attempt.
 * Transient outcomes (timeouts, 429, 5xx, network errors) are retried normally.
 */
const PERMANENT_FOR_INPUT = new Set<AttemptOutcome>([
  "too_large",
  "js_required",
  "scanned_pdf",
  "empty",
  "parse_error",
  "unsupported_format",
  "wrong_document",
  "no_candidates",
]);

export function isSuccessOutcome(outcome: AttemptOutcome): boolean {
  return SUCCESS_OUTCOMES.has(outcome);
}

export function isPermanentForInput(outcome: AttemptOutcome): boolean {
  return PERMANENT_FOR_INPUT.has(outcome);
}

export const PERMANENT_OUTCOMES: AttemptOutcome[] = ATTEMPT_OUTCOMES.filter((outcome) => PERMANENT_FOR_INPUT.has(outcome));

function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name} ${error.message}`;
  return String(error ?? "");
}

/** A typed outcome for a failed HTTP request: an HTTP status, or the thrown error. */
export function classifyFetchFailure(status: number | null, error?: unknown): AttemptOutcome {
  if (status == null || status === 0) {
    return /abort|timed? ?out|timeout/i.test(errorText(error)) ? "timeout" : "network_error";
  }
  if (status === 401 || status === 403) return "http_403";
  if (status === 404) return "http_404";
  if (status === 410) return "http_410";
  if (status === 429) return "http_429";
  if (status >= 500) return "http_5xx";
  return "http_other";
}

/** Counts outcomes for a step's detail: `{ ok: 3, unchanged: 22, http_404: 1 }`. */
export function countOutcomes(outcomes: Array<AttemptOutcome | null | undefined>): Partial<Record<AttemptOutcome, number>> {
  const counts: Partial<Record<AttemptOutcome, number>> = {};
  for (const outcome of outcomes) {
    if (outcome) counts[outcome] = (counts[outcome] ?? 0) + 1;
  }
  return counts;
}
