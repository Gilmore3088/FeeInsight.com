import { limitGuardVerdict, LIMIT_GUARD_CHECK } from "@/lib/agents/hamilton/limit-guard";
import { traceLiveFee, type InstitutionText, type LiveFeeRow } from "@/lib/agents/hamilton/source-check";

/**
 * Deming's offline replay: run the deployed rule on a case's frozen input and say whether it
 * still catches the mistake. Pure, so the same call runs in CI on the committed fixture and
 * on prod in the daily `deming-regression` step.
 *
 * Only checks with a pure rule can be replayed. A check that needs the live database (the
 * category guard compares a fee with the rest of the bank's schedule) has no replayer yet, so
 * its cases stay `candidate` instead of passing a test that never ran.
 */

export const SOURCE_CHECK_NAME = "hamilton.source_check";

export interface LimitGuardCaseInput {
  kind: "limit_guard";
  canonical_fee_key: string;
  fee_name: string | null;
  amount: number | null;
  conditions: string | null;
}

export interface SourceCheckCaseInput {
  kind: "source_check";
  fee: Pick<LiveFeeRow, "fee_published_id" | "lineage_ref" | "fee_raw_id" | "institution_id" | "source" | "source_document_id" | "canonical_fee_key" | "fee_name" | "amount" | "amount_kind" | "rate_percent">;
  texts: InstitutionText[];
}

export type CaseInput = LimitGuardCaseInput | SourceCheckCaseInput;

export interface ReplayVerdict {
  /** The deployed rule still refuses the fee. */
  caught: boolean;
  /** The rule's own words: its reason code when caught, why it passed otherwise. */
  verdict: string;
}

/** Checks Deming can replay offline. */
export const REPLAYABLE_CHECKS: readonly string[] = [LIMIT_GUARD_CHECK, SOURCE_CHECK_NAME];

export function isReplayable(checkName: string | null | undefined): boolean {
  return checkName != null && REPLAYABLE_CHECKS.includes(checkName);
}

/** Replays one case; null when the input has no replayer. */
export function replayCase(input: CaseInput): ReplayVerdict | null {
  if (input.kind === "limit_guard") {
    const verdict = limitGuardVerdict(input);
    return verdict ? { caught: true, verdict: verdict.code } : { caught: false, verdict: "passes_limit_guard" };
  }
  if (input.kind === "source_check") {
    if (input.texts.length === 0) return { caught: false, verdict: "no_stored_text" };
    const verdict = traceLiveFee(input.fee as LiveFeeRow, input.texts);
    return verdict.kind === "untraceable"
      ? { caught: true, verdict: verdict.reason }
      : { caught: false, verdict: verdict.kind };
  }
  return null;
}
