/**
 * Which monitor signals a Pro reader may see. Knox and Darwin raise "needs review"
 * signals when a bank's fees need a second look inside the pipeline; that is
 * housekeeping for the operator, not market news for a customer (#1114), so the
 * Pro feed, the home feed and their counts leave these types out. Pure and
 * client-safe.
 */

export const INTERNAL_REVIEW_SIGNAL_TYPES: readonly string[] = [
  "darwin_verification_needs_review",
  "knox_extraction_needs_review",
];

export function isCustomerSignal(signalType: string): boolean {
  return !INTERNAL_REVIEW_SIGNAL_TYPES.includes(signalType);
}
