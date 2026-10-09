/**
 * Deming's severity scale for a fee mistake (Agentic OS PRD 7.4).
 *
 *   critical  materially wrong amount, another bank's document, consumer/business scope
 *             confusion, or a figure that is not a fee at all (a limit, a threshold, an
 *             article's average). A live critical error goes through the takedown path; a
 *             new one blocks the release that would cause it.
 *   major     a real fee filed under the wrong category, or a stale copy kept live.
 *   minor     wording or metadata that does not change what a reader would quote.
 *   info      not a mistake in the fee itself (a fee outside the top 50, a restore event).
 *
 * The scale reads the check that caught the mistake and its reason code. An unknown check is
 * `major` until someone places it, so a new check never reads as harmless by default.
 */

export type Severity = "critical" | "major" | "minor" | "info";

export const SEVERITY_ORDER: readonly Severity[] = ["critical", "major", "minor", "info"];

/** Checks whose confirmed catch always means the published figure was not this bank's fee. */
const CRITICAL_CHECKS: ReadonlySet<string> = new Set([
  "hamilton.limit_guard",
  "hamilton.business_schedule",
  "hamilton.other_bank_document",
  "hamilton.unconfirmed_document_host",
  "hamilton.article_page",
  "hamilton.product_page",
]);

const MAJOR_CHECKS: ReadonlySet<string> = new Set([
  "hamilton.category_guard",
  "hamilton.current_copy",
  "hamilton.cross_page_conflict",
]);

const INFO_CHECKS: ReadonlySet<string> = new Set([
  "hamilton.taxonomy_fold",
  "hamilton.rules_recheck_restore",
  "hamilton.frequency_fill",
]);

/** Source-check reasons: the figure is on the page but is not this fee's price. */
const SOURCE_CHECK_CRITICAL = new Set([
  "amount_not_the_fee",
  "amount_is_a_threshold",
  "priced_per_amount",
  "name_not_in_text",
  "no_source_text",
]);

/** Eval-verdict reasons for a figure that is not the fee (`hamilton/eval-verdicts.ts` prefixes). */
const EVAL_VERDICT_CRITICAL = /^(?:eval_critical|not_a_fee|price_in_name|wrong_amount|wrong_payer)$/;

/** The bare reason code: "limit_as_fee:source_states_limit: the source ..." -> "limit_as_fee". */
export function reasonCode(reason: string | null | undefined): string {
  const text = (reason ?? "").trim();
  if (!text) return "unknown";
  return text.split(/[:\s]/, 1)[0] || "unknown";
}

export function severityFor(checkName: string | null | undefined, reason: string | null | undefined): Severity {
  const check = (checkName ?? "").trim();
  const code = reasonCode(reason);
  if (check === "hamilton.source_check") {
    if (code === "tiered_fee" || code === "category_not_in_text") return "major";
    return SOURCE_CHECK_CRITICAL.has(code) ? "critical" : "major";
  }
  if (check === "hamilton.eval_verdict") return EVAL_VERDICT_CRITICAL.test(code) ? "critical" : "major";
  if (CRITICAL_CHECKS.has(check)) return "critical";
  if (MAJOR_CHECKS.has(check)) return "major";
  if (INFO_CHECKS.has(check)) return "info";
  return "major";
}

/** Highest severity first, for sorting a list of cases or issues. */
export function compareSeverity(a: Severity, b: Severity): number {
  return SEVERITY_ORDER.indexOf(a) - SEVERITY_ORDER.indexOf(b);
}
