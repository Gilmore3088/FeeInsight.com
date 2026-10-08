/**
 * Which CFPB complaints count as fee complaints. One definition shared by the Magellan CFPB step
 * (what it stores) and every reader (district, national, institution and benchmark figures).
 *
 * The step stores, per institution and year (institution_complaint_records):
 * - product '<product>' / issue '_total': complaints per CFPB product.
 * - product '_all' / issue '<issue>': complaints per issue across all products.
 * - product FEE_PRODUCTS_KEY / issue '<issue>': issues within the deposit and card products only.
 * - product FEE_SUB_ISSUES_KEY / issue '<issue> :: <sub-issue>': the same, split by sub-issue, when
 *   CFPB returns sub-issue buckets.
 *
 * "Managing an account" is mostly deposits, withdrawals and errors, so it is not a fee complaint.
 * Only its "Fee problem" sub-issue is, and only when sub-issues were loaded.
 */

export const FEE_PRODUCTS_KEY = "_fee_products";
export const FEE_SUB_ISSUES_KEY = "_fee_products_sub";
export const SUB_ISSUE_SEPARATOR = " :: ";

/** Deposit and card products, current and pre-2017 CFPB names. */
export const FEE_PRODUCTS = [
  "Checking or savings account",
  "Bank account or service",
  "Credit card",
  "Credit card or prepaid card",
  "Prepaid card",
] as const;

/** Issues that are about a fee in every product they appear under. */
export const FEE_ISSUES = [
  "Problem caused by your funds being low",
  "Problems caused by my funds being low",
  "Fees or interest",
  "Unexpected or other fees",
  "Fees",
  "Late fee",
  "Other fee",
  "Overlimit fee",
  "Balance transfer fee",
  "Cash advance fee",
] as const;

/** Sub-issues that are fee complaints under an issue that otherwise is not. */
export const FEE_SUB_ISSUES = [`Managing an account${SUB_ISSUE_SEPARATOR}Fee problem`] as const;

export function subIssueKey(issue: string, subIssue: string): string {
  return `${issue}${SUB_ISSUE_SEPARATOR}${subIssue}`;
}

export function isFeeIssue(issue: string): boolean {
  return (FEE_ISSUES as readonly string[]).includes(issue);
}

export function isFeeSubIssue(issueAndSubIssue: string): boolean {
  return (FEE_SUB_ISSUES as readonly string[]).includes(issueAndSubIssue);
}
