import { limitGuardVerdict, LIMIT_GUARD_CHECK } from "@/lib/agents/hamilton/limit-guard";
import { traceLiveFee, type InstitutionText, type LiveFeeRow } from "@/lib/agents/hamilton/source-check";
import { CATEGORY_GUARD_CHECK } from "@/lib/agents/hamilton/category-guard";
import { checkFeeCategory } from "@/lib/fee-category-guard";
import { BUSINESS_SCHEDULE_CHECK, readsAsBusinessSchedule } from "@/lib/agents/hamilton/business-schedule";
import { darwinAudience } from "@/lib/agents/darwin/audience";

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
 *
 * Audience (#2064, target 0 consumer/business mix-ups): a confirmed business-schedule takedown is
 * a business fee that was shown as a consumer one. It replays against today's audience rules:
 * Darwin's audience decision from the fee's name and document address (`darwinAudience`, no page
 * text) and, when Darwin leaves it unknown, Hamilton's business-schedule read
 * (`readsAsBusinessSchedule`). Caught means today's rules still keep it off consumer pages: Darwin
 * calls it business, or the read calls it business. A Darwin read of consumer or both lets it
 * through, since the business-schedule read only judges unknown fees. A business-only footnote
 * needs the page, so its case stays `candidate`. An old `unreplayable` snapshot has no document
 * address; the replay passes the case's document's address (`context.documentUrl`).
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

/** A business-schedule takedown: a business fee shown as a consumer one, with its document's address. */
export interface AudienceCaseInput {
  kind: "audience";
  canonical_fee_key: string;
  fee_name: string | null;
  amount: number | null;
  conditions: string | null;
  document_url: string | null;
}

/** A takedown's snapshot of the fee's own fields, frozen before its check had a replayer. */
export interface FeeFieldsCaseInput {
  kind: "unreplayable";
  canonical_fee_key: string | null;
  fee_name: string | null;
  amount: number | null;
  conditions: string | null;
}

export type CaseInput = LimitGuardCaseInput | SourceCheckCaseInput | CategoryGuardCaseInput | AudienceCaseInput | FeeFieldsCaseInput;

export interface ReplayVerdict {
  /** The deployed rule still refuses the fee. */
  caught: boolean;
  /** The rule's own words: its reason code when caught, why it passed otherwise. */
  verdict: string;
}

/** Checks a fee-fields snapshot replays by name (#2064). */
export const FIELD_REPLAY_CHECKS: readonly string[] = [LIMIT_GUARD_CHECK, CATEGORY_GUARD_CHECK, BUSINESS_SCHEDULE_CHECK];

/** Checks Deming can replay offline. */
export const REPLAYABLE_CHECKS: readonly string[] = [LIMIT_GUARD_CHECK, SOURCE_CHECK_NAME, CATEGORY_GUARD_CHECK, BUSINESS_SCHEDULE_CHECK];

/** Today's audience rules on a business fee once shown as a consumer one (#2064). */
export function replayAudience(input: { fee_name: string | null; amount: number | null; document_url: string | null }): ReplayVerdict {
  const darwin = darwinAudience({ fee_audience: null, source_url: input.document_url, fee_name: input.fee_name ?? "" }, input.amount, null);
  if (darwin?.feeAudience === "business") return { caught: true, verdict: "darwin_reads_business" };
  if (darwin) return { caught: false, verdict: `darwin_reads_${darwin.feeAudience}` };
  return readsAsBusinessSchedule(input.fee_name, input.document_url)
    ? { caught: true, verdict: "business_schedule_read" }
    : { caught: false, verdict: "passes_audience_rules" };
}

function replayCategoryGuard(input: { canonical_fee_key: string | null; fee_name: string | null; amount: number | null; conditions: string | null }): ReplayVerdict {
  const verdict = checkFeeCategory(input.canonical_fee_key, input.fee_name, { amount: input.amount, conditions: input.conditions });
  return verdict.ok ? { caught: false, verdict: "passes_category_guard" } : { caught: true, verdict: verdict.code };
}

/**
 * Replays one case; null when the input has no replayer. An `unreplayable` snapshot needs the
 * check that caught it (`checkName`, the case's `check_name`).
 */
export function replayCase(input: CaseInput, checkName?: string | null, context: { documentUrl?: string | null } = {}): ReplayVerdict | null {
  if (input.kind === "limit_guard") {
    const verdict = limitGuardVerdict(input);
    return verdict ? { caught: true, verdict: verdict.code } : { caught: false, verdict: "passes_limit_guard" };
  }
  if (input.kind === "category_guard") return replayCategoryGuard(input);
  if (input.kind === "audience") return replayAudience(input);
  if (input.kind === "unreplayable") {
    if (checkName === CATEGORY_GUARD_CHECK) return replayCategoryGuard(input);
    if (checkName === BUSINESS_SCHEDULE_CHECK) return replayAudience({ ...input, document_url: context.documentUrl ?? null });
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
