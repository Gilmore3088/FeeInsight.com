import type { ExtractedFeeCandidate } from "./rules";

/**
 * Knox v178 (backlog dry run 9): a monthly maintenance read from a sentence that speaks of an account's fee
 * without being its price list is held for review with its category (`eligibility`), never filed as a bare
 * monthly fee. Pure; one definition for Knox (`specialists.ts`) and Darwin's live re-check
 * (`darwin/accountless-monthly-check.ts`, which reads the stored excerpt).
 *
 * - A reward bullet ("Waived $5.00 monthly maintenance fee", Educational Community Alliance FCU text 26750,
 *   under "Earn the following additional rewards by meeting all the qualifications") is a perk of an account's
 *   rewards, not its price.
 * - A "Your $12 monthly maintenance fee is waived for the first two statement cycles ..." sentence (U.S. Bank
 *   text 39773, a customer resources page) speaks to a customer of an account the page does not name there.
 *
 * Not held: any other monthly fee the lineup gives no account on a product page. Holding those (the dry run's
 * Millersburg "$4 Monthly Service Charge", text 33080) would also hold the page's own fee on single-product
 * pages whose menus title other accounts: on the harness (rb to rb9) 8 reads that reproduce a live fee
 * (Byline Bank's money market "$25 monthly fee", Elkhorn Valley Bank's savings charges, First Interstate's
 * "$15 service charge") and 6 new reads of the same kind.
 */
const MONEY = String.raw`\$\s?\d[\d,]*(?:\.\d{1,2})?`;
const MONTHLY_FEE_WORDS = String.raw`monthly\s+(?:maintenance|service)\s+(?:fees?|charges?)`;
export const ACCOUNTLESS_MONTHLY_REWARD_BULLET = new RegExp(String.raw`^\W*(?:waived|no|free)\s+${MONEY}\s+${MONTHLY_FEE_WORDS}\W*$`, "i");
export const ACCOUNTLESS_MONTHLY_YOUR_SENTENCE = new RegExp(String.raw`^\W*your\s+${MONEY}\s+${MONTHLY_FEE_WORDS}\b`, "i");

export type AccountlessMonthlyReason = "reward_bullet" | "your_fee_sentence";

/** The excerpt's sentence form, when it is one of the two (see the module note). */
export function accountlessMonthlyExcerpt(excerpt: string | null | undefined): AccountlessMonthlyReason | null {
  const line = (excerpt ?? "").trim();
  if (ACCOUNTLESS_MONTHLY_REWARD_BULLET.test(line)) return "reward_bullet";
  if (ACCOUNTLESS_MONTHLY_YOUR_SENTENCE.test(line)) return "your_fee_sentence";
  return null;
}

export function accountlessMonthlyReason(candidate: Pick<ExtractedFeeCandidate, "canonicalHint" | "excerpt">): AccountlessMonthlyReason | null {
  return candidate.canonicalHint === "monthly_maintenance" ? accountlessMonthlyExcerpt(candidate.excerpt) : null;
}
