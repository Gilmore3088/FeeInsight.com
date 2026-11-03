import { accountHeadingAbove, explicitAccountHeading } from "./lineup";
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
 * The page's own row for a monthly fee at this price, never a sentence form, whose own name is the monthly fee:
 * the name before the price ("Monthly maintenance fee | $10.00"); a line that opens on the price, every other
 * cell of which names the monthly fee ("$10 or $0 | Monthly Fee | $0", a product table with its columns swapped);
 * or a line of prices only right under the name ("Monthly Fee" / "$10 or $0", Trumark FCU's Momentum Checking,
 * live 117986). A line naming another product before its price ("Safe Deposit Box 3x5 | $10.00 | Monthly Fee",
 * "Online Bill Pay | $5.95 | Monthly fee") is that product's row, whatever a later cell says (review of #2976).
 */
function monthlyFeeRow(lines: readonly string[], index: number, skip: number, amount: number): boolean {
  const line = lines[index];
  if (index === skip || accountlessMonthlyExcerpt(line)) return false;
  const price = amountsIn(line).find((match) => match.value === amount);
  if (!price) return false;
  const before = line.slice(0, price.start).replace(/[\s|:–—-]+$/, "").trim();
  if (before) return monthlyFeeName(before) || monthlyFeeName(before.split("|").pop()?.trim() ?? "");
  if (line.includes("|")) {
    const named = line.split("|").map((cell) => cell.trim()).filter((cell) => cell && !PRICES_ONLY.test(cell));
    return named.length > 0 && named.every(monthlyFeeName);
  }
  return PRICES_ONLY.test(line) && index > 0 && index - 1 !== skip && monthlyFeeName(lines[index - 1].replace(/[\s:]+$/, ""));
}

/** The account a row belongs to: its own first cell when that titles an account ("Basic Savings | ..."), else the heading above it. */
function rowAccount(text: string, line: string): string | null {
  const first = line.includes("|") ? line.split("|")[0].trim() : "";
  if (first && !first.includes("$") && !monthlyFeeName(first)) {
    const own = explicitAccountHeading(first);
    if (own) return own;
  }
  return accountHeadingAbove(text, line);
}

const sameAccount = (a: string | null, b: string | null): boolean =>
  a == null || b == null || a.replace(/\s+/g, " ").toLowerCase() === b.replace(/\s+/g, " ").toLowerCase();

/**
 * The first such row that sits under the sentence's own account (review of #2976): a row another account's heading
 * or first cell owns ("Basic Savings | Monthly maintenance fee | $10.00" against a bullet under "Rewards
 * Checking") is that account's fee and never stands for the sentence. When either account is unknown, the row stands.
 */
function monthlyFeeRowLine(text: string, lines: readonly string[], skip: number, amount: number): string | null {
  const sentenceAccount = skip >= 0 ? accountHeadingAbove(text, lines[skip]) : null;
  for (let index = 0; index < lines.length; index++) {
    if (!monthlyFeeRow(lines, index, skip, amount)) continue;
    if (sameAccount(sentenceAccount, rowAccount(text, lines[index]))) return lines[index];
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
    const row = monthlyFeeRowLine(text, lines, at, candidate.amount);
    if (row) return { hold: false, row };
  }
  if (at > 0 && explicitAccountHeading(lines[at - 1])) return { hold: false, row: null };
  return { hold: true, reason };
}
