/**
 * Hamilton task faults (#1921, V5 item O1): one classification of what went wrong with a paid
 * call, and one bounded retry policy for it.
 *
 * Each fault ends the step with a recorded failure (its kind is saved on the run's step and
 * event), and the retry policy decides whether the same step is tried again:
 * - a provider error (5xx, 429, a dropped connection) and a timeout are retried once;
 * - malformed output (an empty reply, a reply that is not the shape asked for) is retried once;
 * - a reply too large to read (over a response byte limit) is never retried: the same request
 *   would grow the same reply, and pay for it again;
 * - an unfinished reply (stopped at its token limit, refused), a usage or billing limit at the
 *   provider, a budget cap and the provider stop are never retried: trying again cannot help,
 *   and each try would be another charge.
 *
 * The HTTP layer (`withRawProviderResponseOperation`) already makes its own two transport
 * retries inside one call; this policy is per step, on top of that, and never resets.
 * Retries are idempotent because a step that finished is saved first and never run again
 * (src/lib/hamilton/report-run.ts).
 */

import { EmergencyStopActiveError } from "@/lib/automation-control";
import { IncompleteProviderResponseError, ProviderResponseBudgetError } from "@/lib/ai-response-budget";
import { ProviderBudgetBlockedError } from "@/lib/api-hardening/budget";
import { isProviderLimitError } from "@/lib/ai-provider";
import { HAMILTON_PAUSED_MESSAGE } from "./provider-paused";
import { HamiltonTaskBudgetError } from "./task-budget";

export type HamiltonFaultKind =
  | "provider_error"
  | "timeout"
  | "malformed_output"
  | "too_large"
  | "incomplete"
  | "provider_paused"
  | "budget"
  | "stopped"
  | "cancelled"
  | "unknown";

/** Retries allowed after the first try, per fault kind. Bounded: never more than one. */
export const HAMILTON_RETRY_POLICY: Readonly<Record<HamiltonFaultKind, number>> = Object.freeze({
  provider_error: 1,
  timeout: 1,
  malformed_output: 1,
  too_large: 0,
  incomplete: 0,
  provider_paused: 0,
  budget: 0,
  stopped: 0,
  cancelled: 0,
  unknown: 0,
});

/** The reply came back but is not usable: empty, or not the shape asked for. */
export class MalformedProviderOutputError extends Error {
  constructor(message: string, readonly preview?: string) {
    super(message);
    this.name = "MalformedProviderOutputError";
  }
}

export interface HamiltonFault {
  kind: HamiltonFaultKind;
  retryable: boolean;
  /** Plain words for the reader; never names an internal step or agent. */
  readerMessage: string;
  /** For the run ledger. */
  detail: string;
}

function chain(error: unknown): unknown[] {
  const seen: unknown[] = [];
  let current = error;
  for (let depth = 0; depth < 8 && current && !seen.includes(current); depth++) {
    seen.push(current);
    current = current instanceof Error ? current.cause : undefined;
  }
  return seen;
}

function statusOf(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const record = error as { status?: unknown; statusCode?: unknown };
  const status = typeof record.status === "number" ? record.status : record.statusCode;
  return typeof status === "number" ? status : null;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function classifyHamiltonFault(error: unknown): HamiltonFault {
  const links = chain(error);
  const detail = message(error).slice(0, 500);
  const fault = (kind: HamiltonFaultKind, readerMessage: string): HamiltonFault =>
    ({ kind, retryable: HAMILTON_RETRY_POLICY[kind] > 0, readerMessage, detail });
  const budget = links.find((link): link is HamiltonTaskBudgetError => link instanceof HamiltonTaskBudgetError);
  if (budget) return fault("budget", budget.message);
  if (links.some((link) => link instanceof EmergencyStopActiveError)) return fault("stopped", HAMILTON_PAUSED_MESSAGE);
  if (links.some((link) => link instanceof ProviderBudgetBlockedError || (link instanceof Error && link.name === "ProviderCircuitOpenError"))) {
    return fault("budget", HAMILTON_PAUSED_MESSAGE);
  }
  if (links.some((link) => isProviderLimitError(link))) return fault("provider_paused", HAMILTON_PAUSED_MESSAGE);
  const responseBudget = links.find((link): link is ProviderResponseBudgetError => link instanceof ProviderResponseBudgetError);
  if (responseBudget) {
    if (responseBudget.reason === "cancelled") return fault("cancelled", responseBudget.message);
    if (responseBudget.reason === "deadline" || responseBudget.reason === "idle") return fault("timeout", responseBudget.message);
    return fault("too_large", "Hamilton's reply was too long to use. Please try a narrower question.");
  }
  if (links.some((link) => link instanceof IncompleteProviderResponseError)) {
    return fault("incomplete", "Hamilton's reply could not finish. Please try again or ask a smaller question.");
  }
  if (links.some((link) => link instanceof MalformedProviderOutputError || link instanceof SyntaxError)) {
    return fault("malformed_output", "Hamilton's reply was not usable. Please try again in a minute.");
  }
  if (links.some((link) => link instanceof Error && (link.name === "APIConnectionTimeoutError" || link.name === "TimeoutError" || /timed? ?out/i.test(link.message)))) {
    return fault("timeout", "Hamilton took too long to answer. Please try again in a minute.");
  }
  if (links.some((link) => link instanceof Error && link.name === "AbortError")) {
    return fault("cancelled", "The request was cancelled. You can try again.");
  }
  const status = links.map(statusOf).find((value) => value !== null) ?? null;
  if (status !== null && (status === 408 || status === 409 || status === 429 || status >= 500)) {
    return fault("provider_error", "Hamilton's writer could not be reached. Please try again in a minute.");
  }
  if (links.some((link) => link instanceof Error && (link.name === "APIConnectionError" || /ECONNRESET|ETIMEDOUT|fetch failed|socket hang up|overloaded/i.test(link.message)))) {
    return fault("provider_error", "Hamilton's writer could not be reached. Please try again in a minute.");
  }
  return fault("unknown", "Hamilton could not finish this just now. Please try again in a minute.");
}

export interface RetryOutcome<T> {
  ok: boolean;
  value?: T;
  fault?: HamiltonFault;
  /** Every try, including the first, with its fault when it failed. */
  attempts: Array<{ attempt: number; fault: HamiltonFaultKind | null }>;
}

/**
 * Run one step under the retry policy: the first try, then at most the retries its fault
 * allows. Never throws; the outcome carries the last fault.
 */
export async function runWithHamiltonRetry<T>(
  step: (attempt: number) => Promise<T>,
  policy: Readonly<Record<HamiltonFaultKind, number>> = HAMILTON_RETRY_POLICY,
): Promise<RetryOutcome<T>> {
  const attempts: RetryOutcome<T>["attempts"] = [];
  for (let attempt = 1; ; attempt++) {
    try {
      const value = await step(attempt);
      attempts.push({ attempt, fault: null });
      return { ok: true, value, attempts };
    } catch (error) {
      const fault = classifyHamiltonFault(error);
      attempts.push({ attempt, fault: fault.kind });
      if (attempt > policy[fault.kind]) return { ok: false, fault, attempts };
    }
  }
}
