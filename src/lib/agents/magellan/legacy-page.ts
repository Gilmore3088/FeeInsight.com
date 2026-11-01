/**
 * A legacy or discontinued account page, refused before capture (#2070). A bank keeps a page or a PDF
 * for accounts it no longer opens ("Legacy Accounts Fee Schedule", "/discontinued-products.pdf",
 * "Accounts No Longer Offered"), for the customers who still hold them. Its prices are not what a new
 * customer pays. Before this, Magellan took such a page like any fee page, Knox read it, and its fees
 * were caught only after extraction (the shared check's `discontinuedRow`, Hamilton's hand takedowns),
 * if at all: a fee under the page's own title is not under a section heading the shared check sees.
 *
 * Magellan now refuses the page before it is stored, with verdict `legacy_page`:
 *   - by its address or link words (`legacyAddress`, `legacyLinkWords`): the discovery address check
 *     (`find-validate.ts`) and the companion finder's link check (`second-document.ts`);
 *   - by its opening (`legacyOpening`): one of its first two lines is a title that names legacy,
 *     discontinued, grandfathered or retired accounts or products, or accounts no longer offered, as
 *     the fee-page check reads every HTML page and PDF (`openingRejection`).
 * A schedule that only has a legacy section further down is kept: Knox flags that table before it reads
 * (`knox/discontinued-tables.ts`). "Retired Military Accounts", "Retirement Accounts" (an IRA), "Legacy
 * Bank", a singular "Legacy Checking Account" (a current product) and a bare "no longer available"
 * are never a legacy page. Pure.
 */

const ACCOUNT_KIND = "(?:(?:checking|savings|deposit|personal|consumer|share|money market)\\s+)?";
/**
 * "Discontinued Checking Product", "Grandfathered Account Types": these words always mean an account
 * the bank no longer opens, singular or plural.
 */
const DISCONTINUED_NAME = new RegExp(`\\b(?:discontinued|grandfathered)\\s+${ACCOUNT_KIND}(?:accounts?|account types?|products?|plans?)\\b`, "i");
/**
 * "Legacy Accounts", "Legacy Checking Accounts", "Retired Products": "legacy" and "retired" name a
 * page of old accounts only in the plural. A singular "Legacy Checking Account" is often a current
 * product (a 50+ account), and a bank named Legacy has a "legacy-account-agreement" (#2070 review).
 * A singular one is legacy only beside "no longer offered" (`NO_LONGER_OFFERED_NAME`).
 */
const PLURAL_LEGACY_NAME = new RegExp(`\\b(?:legacy|retired)\\s+${ACCOUNT_KIND}(?:accounts|account types|products|plans)\\b`, "i");
const LEGACY_NAMES = [DISCONTINUED_NAME, PLURAL_LEGACY_NAME];
/** "Accounts No Longer Offered", "Legacy Checking Account - no longer offered", "Previously Offered Products". */
const NO_LONGER_OFFERED_NAME = /\b(?:accounts?|account types?|products?)\s*[-–—:(,]?\s*(?:that (?:are|is)\s+|we\s+|(?:is|are)\s+)?no longer (?:offered|available)\b|\bpreviously offered (?:accounts?|account types?|products?)\b/i;

/** Pure: link words or an address's words that name a legacy or discontinued account page. */
export function legacyLinkWords(text: string): boolean {
  return LEGACY_NAMES.some((name) => name.test(text)) || NO_LONGER_OFFERED_NAME.test(text);
}

/** Pure: the address's path names a legacy or discontinued account page ("/legacy-accounts-fee-schedule.pdf"). */
export function legacyAddress(url: string): boolean {
  let path = url;
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {
    // keep the raw address
  }
  return legacyLinkWords(path.toLowerCase().replace(/[-_/.+]+/g, " "));
}

/** A title line: short, no price, not a sentence. */
const TITLE_MAX = 120;
const PRICE = /\$\s*\d|\d\.\d{2}\b/;

/** Pure: the page's own title (one of its first two lines) names it a legacy or discontinued account page. */
export function legacyOpening(text: string | null | undefined): boolean {
  if (!text) return false;
  const head = text.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 2);
  return head.some((line) => {
    if (line.length > TITLE_MAX || PRICE.test(line) || /[.!?]$/.test(line)) return false;
    const title = line.replace(/^[#*\s]+/, "");
    // The title opens with the legacy words, or with "Fee Schedule" for them ("Fee Schedule - Legacy Accounts").
    const start = title.replace(/^(?:(?:schedule of )?fees?(?: schedule)?(?: and charges)?|fee and service schedule|disclosures?)\s*(?:for|[-–—:|])?\s*/i, "");
    return [...LEGACY_NAMES, NO_LONGER_OFFERED_NAME].some((name) => name.exec(start)?.index === 0);
  });
}
