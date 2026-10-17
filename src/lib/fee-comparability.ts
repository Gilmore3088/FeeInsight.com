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

/** "CD/IRA fee" when the fee belongs to a CD or IRA and its category does not measure one; else null. */
export function notComparableReason(
  category: string | null | undefined,
  feeName: string | null | undefined,
  accountProduct: string | null | undefined,
): string | null {
  if (!category || CD_IRA_CATEGORIES.has(category)) return null;
  const text = [feeName ?? "", accountProduct ?? ""].join(" ");
  return CD_IRA_TOKEN.test(text) || CD_IRA_WORDS.test(text) ? "CD/IRA fee" : null;
}
