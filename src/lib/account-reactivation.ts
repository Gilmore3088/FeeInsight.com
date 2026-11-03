/**
 * Knox v166 / guard v106 (re-read backlog dry run, Nov 2): reactivating an account is the dormant
 * account fee, never the early closure fee. Midwest Heritage Bank (institution 1839, doc 25885) prints
 * "Account Reactivation (check or savings closed for less than 3 months) ... $10.00/occurrence"; its
 * "closed for less than 3 months" matched Knox's short-window closure pattern before the dormant rule,
 * whose pattern only read "reactivation fee", so the read was filed as early closure. Live (Nov 2,
 * read-only): "Reactivate Closed Account Fee $5 | Allowed within 6 months of closure" (64514) stood
 * as early closure the same way.
 *
 * A name counts when "reactivat…" comes before any closing word, and it is not one price for a
 * reactivation or a closure ("Reactivate/Close Draft Account (within 1 year) | $25", 153083, and
 * "Reactivation Fee/Close Account", "Reactivation and Closure fee", "Reactivation Fee - Close Account"
 * stay early closure) nor a card's reactivation. "Closed Account Reactivation Fee" is a
 * reactivation. ("Re-activation" stays unmatched: the dormant type does not read that spelling, so a
 * match would fail early closure with nowhere to go.)
 */
export const ACCOUNT_REACTIVATION_NAME =
  /^(?:\bclosed\s+(?:[a-z]+\s+)?accounts?\b|(?!\bclos)[^|])*?(?<!\bcards?\s)\breactivat[a-z]*\b(?!\s*(?:fees?\s*)?(?:\/|\bor\b|&|\band\b|[-–—])\s*clos)/i;

/** True when the name's subject is reactivating an account. Pure. */
export function accountReactivationName(name: string | null | undefined): boolean {
  return Boolean(name) && ACCOUNT_REACTIVATION_NAME.test(name ?? "");
}
