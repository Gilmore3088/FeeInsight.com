/**
 * Whether a published fee measures what its category's median measures. A CD early-withdrawal
 * fee or an IRA closing fee filed under a checking-account category (early account closure, say)
 * is a different product's price: it keeps its row on the institution's page but is never placed
 * above, inside or below that category's median. Pure, so client components can use it.
 */

/** Categories whose median is built from CD or IRA fees, where such a fee is the expected product. */
const CD_IRA_CATEGORIES: ReadonlySet<string> = new Set(["ira_termination", "ira_administration"]);

const CD_IRA_TOKEN = /\b(?:CDs?|IRAs?)\b/;
const CD_IRA_WORDS = /certificates? of deposit|share certificates?|individual retirement|retirement account|time deposit/i;

/**
 * Categories that price a deposit account left unused. A card's own inactivity fee (a debit card
 * not swiped for six months, a prepaid or gift card that sits unused) is filed under them too, but
 * it is a card's price, not the account's, so it is never placed against their median.
 */
const ACCOUNT_DORMANCY_CATEGORIES: ReadonlySet<string> = new Set(["dormant_account"]);

const CARD_NAME = /\bcards?\b/i;
/** The schedule line says the charge falls on the card itself: "the card will be charged $5.00". */
const CARD_LINE = /\bthe card (?:will be|is) charged\b|\bcard balance\b/i;

/**
 * Categories that price a safe deposit box's rent. Drilling a box open, replacing a key, a refundable key
 * deposit and paying the rent late are filed under them too, but they are service charges with their
 * own prices ($250 to drill against a $30 to $65 rent), so they are never placed against the rent's
 * median or range. The taxonomy keeps them in the category; only the comparison leaves them out.
 */
/**
 * A safe deposit row whose name says it is a service charge, not the rent. "Lock Box Rental" and
 * "Lock Box Annual Fee" are rents, so "lock" counts only when "box" does not follow it (#1816).
 */
const SAFE_DEPOSIT_SERVICE = /\bdrill|\bkeys?\b|\block(?:s|ed|out)?\b(?!\s*box)|\blate\b|\bpast due\b|\bforced?\b/i;
/**
 * The same rule as a Postgres `~*` pattern, for the statistics row filter (fee-stats.ts
 * statsRowFilter), so every median leaves out the rows the institution page does. Postgres marks
 * word edges with \m and \M (\b is a backspace there). Kept in step by fee-comparability.test.ts.
 */
export const SAFE_DEPOSIT_SERVICE_SQL =
  "\\mdrill|\\mkeys?\\M|\\mlock(s|ed|out)?\\M(?!\\s*box)|\\mlate\\M|\\mpast due\\M|\\mforced?\\M";
export const SAFE_DEPOSIT_CATEGORY = "safe_deposit_box";
const SAFE_DEPOSIT_RENT_CATEGORIES: ReadonlySet<string> = new Set([SAFE_DEPOSIT_CATEGORY]);

export const CD_IRA_REASON = "CD/IRA fee";
export const CARD_INACTIVITY_REASON = "Card inactivity fee";
export const SAFE_DEPOSIT_SERVICE_REASON = "Box drilling or key fee";

/**
 * Words every rule below needs to see in the fee's name, account or schedule line, case ignored.
 * A fee whose text holds none of them is always comparable, so a market read can fetch the text
 * only for rows that match (fee-index.ts getComparableMarketIndex) and still apply this rule to
 * exactly the rows the institution's own side does. Plain alternation, valid in JavaScript and as
 * a Postgres `~*` pattern. Every word a rule tests must appear here as a substring.
 */
export const COMPARABILITY_SCREEN = "cd|ira|certificate|retirement|time deposit|card|drill|key|lock|late|past due|force";
const SCREEN = new RegExp(COMPARABILITY_SCREEN, "i");

/**
 * "CD/IRA fee" when the fee belongs to a CD or IRA and its category does not measure one;
 * "Card inactivity fee" when an account-dormancy row is a card's inactivity charge, by its name or
 * by the schedule line it was read from; "Box drilling or key fee" when a safe deposit row is a
 * service charge rather than the box's rent; else null.
 */
export function notComparableReason(
  category: string | null | undefined,
  feeName: string | null | undefined,
  accountProduct: string | null | undefined,
  sourceLine?: string | null,
): string | null {
  if (!category) return null;
  if (!SCREEN.test([feeName ?? "", accountProduct ?? "", sourceLine ?? ""].join(" "))) return null;
  if (SAFE_DEPOSIT_RENT_CATEGORIES.has(category) && SAFE_DEPOSIT_SERVICE.test(feeName ?? "")) {
    return SAFE_DEPOSIT_SERVICE_REASON;
  }
  if (ACCOUNT_DORMANCY_CATEGORIES.has(category)) {
    // The account's product name is left out: a "card" there names the account, not the fee.
    if (CARD_NAME.test(feeName ?? "") || CARD_LINE.test(sourceLine ?? "")) return CARD_INACTIVITY_REASON;
  }
  if (CD_IRA_CATEGORIES.has(category)) return null;
  const text = [feeName ?? "", accountProduct ?? ""].join(" ");
  return CD_IRA_TOKEN.test(text) || CD_IRA_WORDS.test(text) ? CD_IRA_REASON : null;
}
