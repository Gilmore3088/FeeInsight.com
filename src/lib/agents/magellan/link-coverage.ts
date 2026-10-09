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

const ERROR_PAGE_PATH = /(^|[/_.-])(page-?not-?found|not-?found|404)([/_.?#-]|$)/i;

/**
 * True when the address is the site's own error page ("/page-not-found", "/404/",
 * ".../wcErrors/404.html"): a link a crawler saved after a redirect, never a fee schedule.
 */
export function isErrorPageLink(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return ERROR_PAGE_PATH.test(decodeURIComponent(new URL(url).pathname));
  } catch {
    return false;
  }
}

/** Folders where banks post articles, blog posts and news, not their fee schedule. */
const ARTICLE_PATH = /\/(blogs?|articles?|news|newsroom|insights?|press-releases?|stories|learning-center|education-center)\//i;
/**
 * A path segment that names a fee document even inside such a folder
 * ("/articles/schedule-of-fees/", "/education-center/service-fees"), with at most one
 * word before it ("consumer-fee-schedule"), or a PDF. A headline that merely ends in
 * "overdraft-service-fees" is not one.
 */
const FEE_DOCUMENT_NAME =
  /((^|\/)([a-z0-9]+-)?(fee-?schedule|schedule-?of-?(fees|charges|service-charges)|service-?fees|fees-?and-?charges|disclosures?|truth-?in-?savings)([/.?#-]|$)|\.pdf($|\?))/i;
/** The same tests for SQL, on the lowercased link. */
export const ARTICLE_LINK_SQL = "/(blogs?|articles?|news|newsroom|insights?|press-releases?|stories|learning-center|education-center)/";
export const FEE_DOCUMENT_NAME_SQL =
  "(/([a-z0-9]+-)?(fee-?schedule|schedule-?of-?(fees|charges|service-charges)|service-?fees|fees-?and-?charges|disclosures?|truth-?in-?savings)([/.?#-]|$)|\\.pdf($|\\?))";

/**
 * Hosts that are never a bank's own fee schedule: a government site (a city's HSA agreement
 * stood as Bell Bank's link, a CFPB card agreement as Barclays'), a broker's disclosures and
 * car-price sites (8 Oct 2026). Matched on the link's host, lowercased.
 */
const OTHER_SITE_HOST = /(\.gov$|(^|\.)(lpl|nadaguides|jdpower|kbb)\.com$)/;
/** The same test for SQL, on the lowercased link. */
export const OTHER_SITE_LINK_SQL = "^[a-z]+://([^/?#]*\\.)?([a-z0-9-]+\\.gov|lpl\\.com|nadaguides\\.com|jdpower\\.com|kbb\\.com)([:/?#]|$)";

/**
 * True when the link is on a site that never holds a bank's own fee schedule. A bank whose own
 * website is on such a host (GSA FCU on gsafcu.gsa.gov) keeps its link.
 */
export function isOtherSiteLink(url: string | null | undefined, website?: string | null): boolean {
  if (!url) return false;
  if (website && onBankDomain(url, website)) return false;
  try {
    return OTHER_SITE_HOST.test(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * True when the address is an article, blog post, news item or press release: a page
 * about fees in general ("common checking account fees to avoid", Space Coast CU; a 2021
 * Chase press release), whose amounts are national figures or old news, never the bank's
 * own schedule. A fee document filed in such a folder ("/articles/schedule-of-fees/",
 * MTC Federal CU) is not one.
 */
export function isArticleLink(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const path = decodeURIComponent(parsed.pathname + parsed.search);
    return ARTICLE_PATH.test(path) && !FEE_DOCUMENT_NAME.test(path);
  } catch {
    return false;
  }
}

/** A deposit product with its own disclosure: CDs, share certificates, time deposits. */
const SINGLE_PRODUCT = /(^|[/_.\s-])(cds?|certificates?(-of-deposit)?|share-?certificates?|time-?deposits?)([/_.?#\s-]|$)/i;
/** The disclosure such a product comes with. */
const PRODUCT_DISCLOSURE = /(truth[-_\s]?in[-_\s]?savings|(^|[/_.\s-])tisa?([/_.?#\s-]|$)|disclosure)/i;
/** A name that says the document is the bank's fee schedule after all. */
const FEE_SCHEDULE_NAME = /(fee-?schedule|feeschedule|schedule-?of-?(fees|charges|service-charges)|fees-?and-?charges|service-?charges)/i;
/** The same tests for SQL, on the lowercased link. */
export const SINGLE_PRODUCT_SQL = "(^|[/_. -])(cds?|certificates?(-of-deposit)?|share-?certificates?|time-?deposits?)([/_.?# -]|$)";
export const PRODUCT_DISCLOSURE_SQL = "(truth[-_ ]?in[-_ ]?savings|(^|[/_. -])tisa?([/_.?# -]|$)|disclosure)";
export const FEE_SCHEDULE_NAME_SQL = "(fee-?schedule|feeschedule|schedule-?of-?(fees|charges|service-charges)|fees-?and-?charges|service-?charges)";

/**
 * True when the address is the disclosure for one deposit product: a CD, share
 * certificate or time deposit truth-in-savings sheet ("truth-in-savings-12-month-time-
 * deposit-disclosure", Five Rivers; "TIS-CD-5.1.2025.pdf", RBFCU). Those state a rate
 * and an early-withdrawal penalty, never the bank's account fee schedule. A link whose
 * name also says fee schedule ("/certificates-of-deposit/schedule-of-fees.html") is
 * not one.
 */
export function isSingleProductDisclosureLink(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const path = decodeURIComponent(parsed.pathname + parsed.search);
    return SINGLE_PRODUCT.test(path) && PRODUCT_DISCLOSURE.test(path) && !FEE_SCHEDULE_NAME.test(path);
  } catch {
    return false;
  }
}

/**
 * Country domains of places whose banks share US banks' names (SouthEast Bank's link led
 * to southeastbank.com.bd, 7 Oct 2026). US territories (.pr, .gu, .vi, .as, .mp) and
 * .us are not on the list. A link on the bank's own website's host is never foreign
 * (Natbank, N.A. publishes from nbc.ca).
 */
const FOREIGN_TLD = /\.(bd|in|pk|lk|np|ca|uk|au|nz|ie|sg|hk|cn|tw|jp|kr|ph|my|id|th|vn|ng|ke|gh|za|ae|sa|qa|kw|bh|om|eg|mx|br|ar|cl|pe|co\.[a-z]{2}|de|fr|es|it|nl|be|ch|at|se|no|dk|fi|pl|pt|gr|tr|ru)$/;

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** True when the link sits on another country's domain that is not the bank's own website. */
export function isForeignHostLink(url: string | null | undefined, websiteUrl?: string | null): boolean {
  const host = hostOf(url);
  if (!host || !FOREIGN_TLD.test(host)) return false;
  const own = hostOf(websiteUrl);
  return !(own && (host === own || host.endsWith(`.${own}`) || own.endsWith(`.${host}`)));
}

/** Amounts in another country's money ("Tk 500", "BDT 1,000", "Rs. 250", "£5", "€10"). */
const FOREIGN_CURRENCY = /(?:\b(?:bdt|tk|taka|inr|rs|rupees?|pkr|lkr|npr|gbp|eur|cad|aud|nzd|sgd|hkd|php|ngn|naira|kes|ghs|zar|aed|sar|mxn|cny|rmb|yuan|jpy|yen)\b\.?\s?[\d,]+|[£€¥₹৳₱₦]\s?[\d,]+|\b[\d,]+(?:\.\d+)?\s?(?:bdt|tk|taka|inr|rupees?|pkr|gbp|eur|cad|aud)\b)/gi;
/** A country's central bank or regulator, named only on that country's schedules. */
const FOREIGN_REGULATOR = /\b(bangladesh bank|reserve bank of india|state bank of pakistan|central bank of sri lanka|nepal rastra bank|bank of canada|financial conduct authority|prudential regulation authority|monetary authority of singapore|hong kong monetary authority|bangko sentral|central bank of nigeria|reserve bank of australia|vat|value added tax|excise duty)\b/i;
const US_DOLLAR = /\$\s?\d/g;

/**
 * True when a page's text reads as another country's fee schedule: its amounts are mostly
 * in another currency, or it names a foreign central bank or VAT alongside foreign
 * amounts. Citi's link on 7 Oct 2026 was Citi Bangladesh's schedule on citigroup.com, so
 * the address alone does not catch every case.
 */
export function looksForeignSchedule(text: string | null | undefined): boolean {
  if (!text) return false;
  const foreign = text.match(FOREIGN_CURRENCY)?.length ?? 0;
  if (foreign === 0) return false;
  const dollars = text.match(US_DOLLAR)?.length ?? 0;
  if (foreign >= 3 && foreign > dollars) return true;
  return foreign >= 2 && FOREIGN_REGULATOR.test(text) && foreign * 2 > dollars;
}

/** `urlNamesFeePage` (learning/fee-page.ts) for SQL, on the lowercased link. */
export const FEE_PAGE_NAME_SQL =
  "(fee-?schedule|schedule-of-(fees|charges)|fee-?disclosure|service-charges|pricing|(^|[/_-])fees?([/_.-]|$))";

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
