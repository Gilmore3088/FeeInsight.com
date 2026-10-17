import { formatFeeAmount } from "@/lib/format";

/**
 * How a quoted account fee is avoided, in the schedule's own terms, or null when the stored row
 * does not say. Only a stated balance becomes a phrase: the balance comes from the row's
 * min_balance_to_avoid, and the kind of balance ("average daily", "minimum daily") is named only
 * when the schedule's own waiver text or line uses those words. Nothing here is inferred.
 */
export interface WaiverInput {
  minBalanceToAvoid?: number | null;
  waiverText?: string | null;
  sourceLine?: string | null;
}

const BALANCE_KINDS: Array<[RegExp, string]> = [
  [/average daily (?:ledger |collected )?balance/i, "average daily balance"],
  [/minimum daily balance/i, "minimum daily balance"],
  [/average (?:monthly |statement )?balance/i, "average balance"],
  [/minimum balance/i, "minimum balance"],
];

/** "waived with an average daily balance of $1,500 or more", or null. */
export function waiverPhrase(input: WaiverInput): string | null {
  const balance = input.minBalanceToAvoid;
  if (balance == null || !Number.isFinite(balance) || balance <= 0) return null;
  const words = [input.waiverText ?? "", input.sourceLine ?? ""].join(" ");
  const kind = BALANCE_KINDS.find(([pattern]) => pattern.test(words))?.[1] ?? "balance";
  return `waived with ${/^[aeiou]/i.test(kind) ? "an" : "a"} ${kind} of ${formatFeeAmount(balance)} or more`;
}
