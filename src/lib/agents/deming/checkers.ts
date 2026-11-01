import { limitGuardVerdict, LIMIT_GUARD_CHECK } from "@/lib/agents/hamilton/limit-guard";
import { traceLiveFee, type InstitutionText, type LiveFeeRow } from "@/lib/agents/hamilton/source-check";
import { CATEGORY_GUARD_CHECK } from "@/lib/agents/hamilton/category-guard";
import { checkFeeCategory } from "@/lib/fee-category-guard";
import { BUSINESS_SCHEDULE_CHECK, footnoteMarksBusiness, readsAsBusinessSchedule } from "@/lib/agents/hamilton/business-schedule";
import { darwinAudience } from "@/lib/agents/darwin/audience";
import { FREE_READ_PREFIX, isProductPage, PRODUCT_PAGE_CHECK, productPageTakedownEnabled } from "@/lib/agents/hamilton/product-page";
import { ARTICLE_PAGE_CHECK, isArticlePage } from "@/lib/agents/hamilton/article-page";
import { NON_DEPOSIT_CHECK, nonDepositTakedownReason } from "@/lib/agents/darwin/non-deposit-document-check";
import { SAME_LINE_DUPLICATE_CHECK } from "@/lib/agents/hamilton/same-line-duplicates";
import { OPENING_SCAN_CHARS } from "@/lib/non-deposit-document";

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
 * a business fee that was shown as a consumer one. It replays against today's audience rules in
 * the pipeline's order (`replayAudience`): Darwin's audience decision with the document's stored
 * text, then, for a fee Darwin leaves unknown, Hamilton's business-schedule read. Caught means
 * today's rules still keep it off consumer pages. A Darwin read of consumer or both lets it
 * through, since the business-schedule read only judges unknown fees. The text is the case's
 * document's newest completed text (`context.documentText`, the one Darwin reads); without it
 * nothing is judged. An old `unreplayable` snapshot has no document address; the replay passes
 * the case's document's address (`context.documentUrl`).
 *
 * Wrong document (#2064): a confirmed product-page, article-page or non-deposit-document takedown
 * replays today's rule on its document's address (`context.documentUrl`, the case's
 * `source_documents` row, the address the live checks read): the product-page rule
 * (`isProductPage`, only Knox's free reads at $0, while its switch is on), the article-page rule
 * (`isArticlePage`) and Darwin's non-deposit rule (`nonDepositTakedownReason`, with the opening of
 * the document's newest stored text when there is one). Without the address nothing is judged. A
 * non-deposit fee the address alone passes is judged only with the text, since the v4 and v5 rules
 * read the document's opening. Another bank's document (`darwin.document_owner`,
 * `hamilton.unconfirmed_document_host`) has no pure rule: both read the institution directory and
 * websites in SQL, so their cases stay `candidate`.
 *
 * Duplicate (#2064): a confirmed same-line takedown (`hamilton.same_line_duplicate`) is caught
 * while the line it repeats, or the line that replaced that one, is still on the catalog
 * (`context.keptLinePresent`, read with Hamilton's own restore rule `sameLineReplacementSql`).
 * When that line is gone, Hamilton's restore brings the copy back on purpose: `kept_line_gone`.
 *
 * Missed fees have no replayer here: Knox's answer-key misses replay in their own daily run
 * (`deming/knox-misses.ts`, check `knox.answer_key_read`), which re-reads each bank's document with
 * today's free Knox team. Those cases freeze the answer key's line and price, not a published fee.
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
  /**
   * The address Darwin reads audience from: the raw row's `source_url` (Knox writes the text's own
   * address, falling back to the document's), which can differ from `document_url`. Absent on cases
   * frozen before it was kept; the document's address stands in, as Knox's fallback does.
   */
  darwin_url?: string | null;
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
export const FIELD_REPLAY_CHECKS: readonly string[] = [
  LIMIT_GUARD_CHECK, CATEGORY_GUARD_CHECK, BUSINESS_SCHEDULE_CHECK,
  PRODUCT_PAGE_CHECK, ARTICLE_PAGE_CHECK, NON_DEPOSIT_CHECK, SAME_LINE_DUPLICATE_CHECK,
];

/** Wrong-document checks, replayed on the case's document's address (#2064). */
export const WRONG_DOCUMENT_CHECKS: readonly string[] = [PRODUCT_PAGE_CHECK, ARTICLE_PAGE_CHECK, NON_DEPOSIT_CHECK];

/** Checks Deming can replay offline. */
export const REPLAYABLE_CHECKS: readonly string[] = [SOURCE_CHECK_NAME, ...FIELD_REPLAY_CHECKS];

/** What a replay may need beyond the frozen input, read by the daily step from the live tables. */
export interface ReplayContext {
  /** The case's document's address (`source_documents.document_url`). */
  documentUrl?: string | null;
  /** The raw row's own address, the one Darwin reads audience from. */
  darwinUrl?: string | null;
  /** The document's newest completed stored text. */
  documentText?: string | null;
  /** The case's document id (`eval_cases.source_document_id`). */
  sourceDocumentId?: number | null;
  /** A same-line case: whether the line it repeats, or that line's replacement, is on the catalog. */
  keptLinePresent?: boolean | null;
}

type FeeFields = { canonical_fee_key: string | null; fee_name: string | null; amount: number | null; conditions: string | null };

/**
 * Today's wrong-document rule on a confirmed takedown (#2064). Null when nothing can be judged: no
 * document address, or (non-deposit) an address that passes alone with no stored text to read the
 * opening from.
 */
export function replayWrongDocument(checkName: string, input: FeeFields, context: ReplayContext): ReplayVerdict | null {
  const url = context.documentUrl?.trim() || null;
  if (!url) return null;
  if (checkName === PRODUCT_PAGE_CHECK) {
    const caught = productPageTakedownEnabled() && input.amount === 0
      && (input.conditions ?? "").startsWith(FREE_READ_PREFIX) && isProductPage(url);
    return caught ? { caught: true, verdict: "product_page" } : { caught: false, verdict: "passes_product_page" };
  }
  if (checkName === ARTICLE_PAGE_CHECK) {
    return isArticlePage(url) ? { caught: true, verdict: "article_page" } : { caught: false, verdict: "passes_article_page" };
  }
  if (checkName === NON_DEPOSIT_CHECK) {
    if (context.sourceDocumentId == null) return null;
    const reason = nonDepositTakedownReason({
      documentUrl: url,
      sourceDocumentId: context.sourceDocumentId,
      canonicalFeeKey: input.canonical_fee_key,
      feeName: input.fee_name,
      documentOpening: context.documentText ? context.documentText.slice(0, OPENING_SCAN_CHARS) : null,
    });
    if (reason) return { caught: true, verdict: reason.split(":")[0] };
    return context.documentText ? { caught: false, verdict: "passes_non_deposit_document" } : null;
  }
  return null;
}

/** A same-line duplicate: caught while the line it repeats (or that line's replacement) is on the catalog. */
export function replayDuplicate(context: ReplayContext): ReplayVerdict | null {
  if (context.keptLinePresent == null) return null;
  return context.keptLinePresent ? { caught: true, verdict: "kept_line_live" } : { caught: false, verdict: "kept_line_gone" };
}

/**
 * Today's audience rules on a business fee once shown as a consumer one (#2064), in the pipeline's
 * order. Darwin decides first, with the document's stored text, as prospective verification does
 * (`darwinAudience` with the fee's own price clause), and with the address Darwin reads: the raw
 * row's `source_url` (`darwin_url`), not the document's. Only a fee Darwin leaves unknown reaches
 * Hamilton's business-schedule read: its name or document address (`readsAsBusinessSchedule`), or
 * a business-only footnote on its line (`footnoteMarksBusiness`). Null without the stored text:
 * Darwin's decision needs the page, so nothing is judged and the case keeps its status.
 */
export function replayAudience(
  input: { fee_name: string | null; amount: number | null; document_url: string | null; darwin_url?: string | null },
  text: string | null | undefined,
): ReplayVerdict | null {
  if (!text) return null;
  const name = input.fee_name ?? "";
  const darwin = darwinAudience({ fee_audience: null, source_url: input.darwin_url ?? input.document_url, fee_name: name }, input.amount, text, { ownPriceClause: true });
  if (darwin?.feeAudience === "business") return { caught: true, verdict: "darwin_reads_business" };
  if (darwin) return { caught: false, verdict: `darwin_reads_${darwin.feeAudience}` };
  if (readsAsBusinessSchedule(name, input.document_url)) return { caught: true, verdict: "business_schedule_read" };
  if (footnoteMarksBusiness(text, name)) return { caught: true, verdict: "business_only_footnote" };
  return { caught: false, verdict: "passes_audience_rules" };
}

function replayCategoryGuard(input: { canonical_fee_key: string | null; fee_name: string | null; amount: number | null; conditions: string | null }): ReplayVerdict {
  const verdict = checkFeeCategory(input.canonical_fee_key, input.fee_name, { amount: input.amount, conditions: input.conditions });
  return verdict.ok ? { caught: false, verdict: "passes_category_guard" } : { caught: true, verdict: verdict.code };
}

/**
 * Replays one case; null when the input has no replayer. An `unreplayable` snapshot needs the
 * check that caught it (`checkName`, the case's `check_name`).
 */
export function replayCase(
  input: CaseInput,
  checkName?: string | null,
  context: ReplayContext = {},
): ReplayVerdict | null {
  if (input.kind === "limit_guard") {
    const verdict = limitGuardVerdict(input);
    return verdict ? { caught: true, verdict: verdict.code } : { caught: false, verdict: "passes_limit_guard" };
  }
  if (input.kind === "category_guard") return replayCategoryGuard(input);
  if (input.kind === "audience") return replayAudience({ ...input, darwin_url: input.darwin_url ?? context.darwinUrl ?? null }, context.documentText);
  if (input.kind === "unreplayable") {
    if (checkName === CATEGORY_GUARD_CHECK) return replayCategoryGuard(input);
    if (checkName === BUSINESS_SCHEDULE_CHECK) return replayAudience({ ...input, document_url: context.documentUrl ?? null, darwin_url: context.darwinUrl ?? null }, context.documentText);
    if (checkName && WRONG_DOCUMENT_CHECKS.includes(checkName)) return replayWrongDocument(checkName, input, context);
    if (checkName === SAME_LINE_DUPLICATE_CHECK) return replayDuplicate(context);
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
