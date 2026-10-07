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
  /\b(refer to|see|described in|disclosed in|found in|outlined in|listed in|provided in)\b[^.]{0,160}\b(account agreement|deposit agreement|terms and conditions|truth in savings|account disclosures?|fee schedule|schedule of fees|schedule of (?:service )?charges|account pages?|product pages?)\b/i;
export const REFERS_ELSEWHERE_SQL =
  "\\m(refer to|see|described in|disclosed in|found in|outlined in|listed in|provided in)\\M[^.]{0,160}(account agreement|deposit agreement|terms and conditions|truth in savings|account disclosure|fee schedule|schedule of fees|schedule of charges|schedule of service charges|account page|product page)";

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

/** Same address test as `looksLikeProductPage` (find-validate.ts), for SQL: an account or product page... */
export const PRODUCT_LINK_SQL =
  "^https?://[^/]+/[^?#]*(checking|savings|accounts?([/._?-]|$)|money-?market|certificates?|personal-banking|business-banking|deposit-products?|share-accounts?)";
/** ...unless its address names a fee document. */
export const FEE_NAMED_LINK_SQL = "(fee|schedule|charge|disclos|truth|pricing|\\.pdf($|\\?))";

/** Assets (thousands, as call reports) at which a bank is one buyers check first: $10B. */
export const LARGE_BANK_ASSETS = 10_000_000;

/** Fewer live fee categories than this and the catalog hides the bank (the 3-fee rule). */
export const HIDDEN_BELOW_CATEGORIES = 3;

/** The host of a bank's website, without "www.". */
export function websiteHost(website: string): string | null {
  for (const candidate of [website.trim(), `https://${website.trim()}`]) {
    try {
      const url = new URL(candidate);
      if (url.protocol === "http:" || url.protocol === "https:") return url.hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      continue;
    }
  }
  return null;
}

/** The domain's name part: "citigroup" for www.citigroup.com, "chase" for secure.chase.com. */
function domainName(host: string): string {
  const labels = host.split(".");
  return labels.length >= 2 ? labels[labels.length - 2] : host;
}

const CORPORATE_SUFFIX = /^-?(group|corp|corporation|bancorp|bancshares|financial|holdings|inc|bank|banking|online|direct)$/;

/**
 * The bank's own domain: its website host, a subdomain of it, or its corporate domain.
 * Large banks publish their schedules on the parent company's site (Citi's consumer
 * "Schedule of Charges" is on citigroup.com while its website is citi.com), so a domain
 * named the website's name (4+ letters) plus a corporate word counts too. Only those
 * words: "citizensbank" is not Citi's.
 */
export function onBankDomain(url: string, website: string): boolean {
  const host = websiteHost(website);
  if (!host) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const candidate = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (candidate === host || candidate.endsWith(`.${host}`)) return true;
    const bank = domainName(host);
    const other = domainName(candidate);
    return bank.length >= 4 && other.startsWith(bank) && CORPORATE_SUFFIX.test(other.slice(bank.length));
  } catch {
    return false;
  }
}
