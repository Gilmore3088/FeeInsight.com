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

export const CD_IRA_REASON = "CD/IRA fee";
export const CARD_INACTIVITY_REASON = "Card inactivity fee";

/**
 * "CD/IRA fee" when the fee belongs to a CD or IRA and its category does not measure one;
 * "Card inactivity fee" when an account-dormancy row is a card's inactivity charge, by its name or
 * by the schedule line it was read from; else null.
 */
export function notComparableReason(
  category: string | null | undefined,
  feeName: string | null | undefined,
  accountProduct: string | null | undefined,
  sourceLine?: string | null,
): string | null {
  if (!category) return null;
  if (ACCOUNT_DORMANCY_CATEGORIES.has(category)) {
    const named = [feeName ?? "", accountProduct ?? ""].join(" ");
    if (CARD_NAME.test(named) || CARD_LINE.test(sourceLine ?? "")) return CARD_INACTIVITY_REASON;
  }
  if (CD_IRA_CATEGORIES.has(category)) return null;
  const text = [feeName ?? "", accountProduct ?? ""].join(" ");
  return CD_IRA_TOKEN.test(text) || CD_IRA_WORDS.test(text) ? CD_IRA_REASON : null;
}
