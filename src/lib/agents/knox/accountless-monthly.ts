import { explicitAccountHeading } from "./lineup";
import { amountsIn, classifyFeeText, type ExtractedFeeCandidate } from "./rules";

/**
 * Knox v178 (backlog dry run 9): a monthly maintenance read from a sentence that speaks of an account's fee
 * without being its price list is held for review with its category (`eligibility`), never filed as a bare
 * monthly fee. Pure; one definition for Knox (`specialists.ts`) and Darwin's live re-check
 * (`darwin/section-misread-check.ts`, which reads the stored excerpt and the text Knox read).
 *
 * - A reward bullet ("Waived $5.00 monthly maintenance fee", Educational Community Alliance FCU text 26750,
 *   under "Earn the following additional rewards by meeting all the qualifications") is a perk of an account's
 *   rewards, not its price.
 * - A "Your $12 monthly maintenance fee is waived for the first two statement cycles ..." sentence (U.S. Bank
 *   text 39773, a customer resources page) speaks to a customer of an account the page does not name there.
 *
 * Judged on the page, never on the sentence alone (review of #2976):
 * - When another line prints the monthly fee at the same price as a row of its own ("Monthly maintenance fee |
 *   $10.00"), that row is the fee's line: the read is not held, and Knox reads it from the row
 *   (`accountlessMonthlyOnPage` returns the row), so the lineup takes the row's account.
 * - When the line right above the sentence is an account's own heading ("Premier Checking" / "Your $10 monthly
 *   service charge can be avoided with direct deposit."), the sentence speaks of that account and is read under
 *   it, not held.
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

const monthlyFeeName = (words: string): boolean =>
  !!words && words.split(/\s+/).length <= 8 && classifyFeeText(words) === "monthly_maintenance";
const PRICES_ONLY = /^(?:\s|\$\s?\d[\d,]*(?:\.\d{1,2})?|\bor\b|\/|[-–—])*$/i;

/**
 * The page's own row for a monthly fee at this price, never a sentence form: the name before the price
 * ("Monthly maintenance fee | $10.00"), a cell of the price's line naming it ("$10 or $0 | Monthly Fee | $0", a
 * product table with its columns swapped), or a line of prices only right under the name ("Monthly Fee" / "$10 or
 * $0", Trumark FCU's Momentum Checking, live 117986).
 */
function monthlyFeeRowLine(lines: readonly string[], skip: number, amount: number): string | null {
  for (let index = 0; index < lines.length; index++) {
    if (index === skip) continue;
    const line = lines[index];
    if (accountlessMonthlyExcerpt(line)) continue;
    const price = amountsIn(line).find((match) => match.value === amount);
    if (!price) continue;
    if (monthlyFeeName(line.slice(0, price.start).replace(/[\s|:–—-]+$/, "").trim())) return line;
    if (line.includes("|") && line.split("|").some((cell) => !cell.includes("$") && monthlyFeeName(cell.trim()))) return line;
    if (PRICES_ONLY.test(line) && index > 0 && index - 1 !== skip && monthlyFeeName(lines[index - 1].replace(/[\s:]+$/, ""))) return line;
  }
  return null;
}

export type AccountlessMonthlyVerdict =
  | { hold: true; reason: AccountlessMonthlyReason }
  | { hold: false; row: string | null };

/**
 * The page's verdict on a monthly maintenance read from one of the two sentence forms (see the module note):
 * null when the read is not one; held when no row of the page prints the fee at that price and no account
 * heading sits right above the sentence; otherwise not held, with the page's own row when there is one. Pure.
 */
export function accountlessMonthlyOnPage(
  text: string,
  candidate: Pick<ExtractedFeeCandidate, "canonicalHint" | "excerpt"> & { amount?: number | null },
): AccountlessMonthlyVerdict | null {
  const reason = accountlessMonthlyReason(candidate);
  if (!reason) return null;
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const probe = (candidate.excerpt ?? "").trim().slice(0, 40);
  const at = probe ? lines.findIndex((line) => line.includes(probe)) : -1;
  if (candidate.amount != null) {
    const row = monthlyFeeRowLine(lines, at, candidate.amount);
    if (row) return { hold: false, row };
  }
  if (at > 0 && explicitAccountHeading(lines[at - 1])) return { hold: false, row: null };
  return { hold: true, reason };
}
