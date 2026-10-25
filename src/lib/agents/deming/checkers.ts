import { limitGuardVerdict, LIMIT_GUARD_CHECK } from "@/lib/agents/hamilton/limit-guard";
import { traceLiveFee, type InstitutionText, type LiveFeeRow } from "@/lib/agents/hamilton/source-check";
import { CATEGORY_GUARD_CHECK } from "@/lib/agents/hamilton/category-guard";
import { checkFeeCategory } from "@/lib/fee-category-guard";

/**
 * Deming's offline replay: run the deployed rule on a case's frozen input and say whether it
 * still catches the mistake. Pure, so the same call runs in CI on the committed fixture and
 * on prod in the daily `deming-regression` step.
 *
 * Only checks with a pure rule can be replayed. A check that needs the live database has no
 * replayer yet, so its cases stay `candidate` instead of passing a test that never ran.
 *
 * A takedown stored before its check had a replayer keeps its frozen input (never rewritten): the
 * `unreplayable` snapshot froze the fee's category, name, amount and conditions, which is all the
 * limit guard and the category guard read. Those cases replay by their check name
 * (`FIELD_REPLAY_CHECKS`, #2064). The
 * category guard also weighs the schedule's highest NSF price when Hamilton knew it; a snapshot
 * without it replays without it, so a catch that needed it stays `candidate`, never a false pass.
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

export interface CategoryGuardCaseInput {
  kind: "category_guard";
  canonical_fee_key: string;
  fee_name: string | null;
  amount: number | null;
  conditions: string | null;
}

/** A takedown's snapshot of the fee's own fields, frozen before its check had a replayer. */
export interface FeeFieldsCaseInput {
  kind: "unreplayable";
  canonical_fee_key: string | null;
  fee_name: string | null;
  amount: number | null;
  conditions: string | null;
}

export type CaseInput = LimitGuardCaseInput | SourceCheckCaseInput | CategoryGuardCaseInput | FeeFieldsCaseInput;

export interface ReplayVerdict {
  /** The deployed rule still refuses the fee. */
  caught: boolean;
  /** The rule's own words: its reason code when caught, why it passed otherwise. */
  verdict: string;
}

/** Checks a fee-fields snapshot replays by name (#2064). */
export const FIELD_REPLAY_CHECKS: readonly string[] = [LIMIT_GUARD_CHECK, CATEGORY_GUARD_CHECK];

/** Checks Deming can replay offline. */
export const REPLAYABLE_CHECKS: readonly string[] = [LIMIT_GUARD_CHECK, SOURCE_CHECK_NAME, CATEGORY_GUARD_CHECK];

function replayCategoryGuard(input: { canonical_fee_key: string | null; fee_name: string | null; amount: number | null; conditions: string | null }): ReplayVerdict {
  const verdict = checkFeeCategory(input.canonical_fee_key, input.fee_name, { amount: input.amount, conditions: input.conditions });
  return verdict.ok ? { caught: false, verdict: "passes_category_guard" } : { caught: true, verdict: verdict.code };
}

/**
 * Replays one case; null when the input has no replayer. An `unreplayable` snapshot needs the
 * check that caught it (`checkName`, the case's `check_name`).
 */
export function replayCase(input: CaseInput, checkName?: string | null): ReplayVerdict | null {
  if (input.kind === "limit_guard") {
    const verdict = limitGuardVerdict(input);
    return verdict ? { caught: true, verdict: verdict.code } : { caught: false, verdict: "passes_limit_guard" };
  }
  if (input.kind === "category_guard") return replayCategoryGuard(input);
  if (input.kind === "unreplayable") {
    if (checkName === CATEGORY_GUARD_CHECK) return replayCategoryGuard(input);
    if (checkName === LIMIT_GUARD_CHECK && input.canonical_fee_key) {
      const verdict = limitGuardVerdict({ canonical_fee_key: input.canonical_fee_key, fee_name: input.fee_name, amount: input.amount, conditions: input.conditions });
      return verdict ? { caught: true, verdict: verdict.code } : { caught: false, verdict: "passes_limit_guard" };
    }
    return null;
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
