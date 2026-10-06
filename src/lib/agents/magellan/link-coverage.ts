/**
 * Is the bank's stored page really its consumer fee schedule? One shared rule for every
 * Magellan finder, in TypeScript for checking a page and in SQL for picking banks.
 *
 * A link is not finished when:
 *   - it is a business-only schedule ("Business-Account-Fee-Schedule.pdf"), whose fees are
 *     not the consumer's (First National Bank Alaska's only link, Oct 6);
 *   - none of the bank's current texts prices an overdraft or NSF item (a product page, a
 *     press release, one account's summary: Wells Fargo, JPMorgan Chase, TD on Oct 6);
 *   - its text sends the reader to another document for the amounts ("Please refer to the
 *     Terms and Conditions of your Consumer Deposit Account Agreement", Banner Bank);
 *   - the document we hold is dated three or more years ago in its own address
 *     (".../files/2019-05/2019-05-15.pdf", Enterprise Bank & Trust on Oct 6), so its prices
 *     are likely out of date.
 * Such a bank keeps its link and its live fees; Magellan keeps searching for the consumer
 * schedule or deposit agreement beside it (companion search, paid schedule search).
 */

/** Words in a link's path that name a business-only schedule... */
const BUSINESS_WORDS = /(business|commercial|corporate|treasury)/i;
/** ...unless it also names consumers. */
const CONSUMER_WORDS = /(personal|consumer|individual|retail|household)/i;

/** The same address test for SQL, on the link's path (host removed). */
export const BUSINESS_PATH_SQL = "(business|commercial|corporate|treasury)";
export const CONSUMER_PATH_SQL = "(personal|consumer|individual|retail|household)";

/** True when the link's address names a business-only schedule or page. */
export function isBusinessOnlyLink(url: string): boolean {
  let path: string;
  try {
    const parsed = new URL(url);
    path = decodeURIComponent(parsed.pathname + parsed.search);
  } catch {
    return false;
  }
  return BUSINESS_WORDS.test(path) && !CONSUMER_WORDS.test(path);
}

/**
 * True when a page's own text is a business-only schedule: its opening names a business
 * or commercial schedule and nothing in it mentions personal or consumer accounts.
 */
export function isBusinessOnlyText(text: string): boolean {
  const opening = text.slice(0, 600);
  if (!/\b(business|commercial)\b[^\n]{0,60}\b(fees?|schedule|charges|accounts?)\b/i.test(opening)) return false;
  return !/\b(personal|consumer|individual)\b/i.test(text);
}

/**
 * An overdraft or NSF line with its price: the word, then a dollar amount of $10 or more
 * on the same line within 80 characters, where the words between do not make the amount a
 * threshold or a limit ("overdrawn by $50 or less", "maximum of $250", "transfers $20").
 */
const OVERDRAFT_PRICE =
  /\b(overdraft|overdrafts|overdrawn|nsf|non-?sufficient|insufficient funds|courtesy pay|bounce|paid items?|returned items?)\b(?:(?!\b(?:by|under|less|more|over|exceeds?|exceeding|up to|cushion|balances?|limit|threshold|maximum|max|waived?|advances?|transfers?|typically|around|occurs?)\b)[^$\n]){0,80}\$ ?[1-9][0-9]/i;
/** The same test for Postgres (in its regex, \m and \M mark the start and end of a word). */
export const OVERDRAFT_PRICE_SQL =
  "\\m(overdraft|overdrafts|overdrawn|nsf|non-?sufficient|insufficient funds|courtesy pay|bounce|paid items?|returned items?)\\M((?!\\m(by|under|less|more|over|exceeds?|exceeding|up to|cushion|balances?|limit|threshold|maximum|max|waived?|advances?|transfers?|typically|around|occurs?)\\M)[^$\\n]){0,80}\\$ ?[1-9][0-9]";

export function hasOverdraftPrice(text: string): boolean {
  return OVERDRAFT_PRICE.test(text);
}

/** A sentence that sends the reader to another document for terms or amounts. */
const REFERS_ELSEWHERE =
  /\b(refer to|see|described in|disclosed in|found in|outlined in|listed in|provided in)\b[^.]{0,160}\b(account agreement|deposit agreement|terms and conditions|truth in savings|account disclosures?|fee schedule|schedule of fees|account pages?|product pages?)\b/i;
export const REFERS_ELSEWHERE_SQL =
  "\\m(refer to|see|described in|disclosed in|found in|outlined in|listed in|provided in)\\M[^.]{0,160}(account agreement|deposit agreement|terms and conditions|truth in savings|account disclosure|fee schedule|schedule of fees|account page|product page)";

export function refersElsewhere(text: string): boolean {
  return REFERS_ELSEWHERE.test(text);
}

/** A document dated this many years back or more, by the year in its address, is stale. */
export const STALE_DOCUMENT_YEARS = 3;
/** The year in a document's address: a path segment or file name starting 19xx/20xx. */
const DOCUMENT_YEAR = /\/((?:19|20)\d{2})[-/_.]/;
/** The same pattern for Postgres substring(); the year is its one capture group. */
export const DOCUMENT_YEAR_SQL = "/((?:19|20)[0-9]{2})[-/_.]";

/** True when the document's address carries a year at least STALE_DOCUMENT_YEARS back. */
export function isStaleDatedLink(url: string, now: Date = new Date()): boolean {
  const match = DOCUMENT_YEAR.exec(url);
  if (!match) return false;
  return Number(match[1]) <= now.getUTCFullYear() - STALE_DOCUMENT_YEARS;
}

/** Assets (thousands, as call reports) at which a bank is one buyers check first: $10B. */
export const LARGE_BANK_ASSETS = 10_000_000;
