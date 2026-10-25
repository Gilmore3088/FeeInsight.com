/**
 * #1918: a checking account's own named fee ("MAX Checking Fee (per month)", "Jumpstart Checking
 * Account Fee"), the account's monthly fee. One pattern, read by Knox (it files the name as
 * monthly maintenance, `rules.ts`) and by the category guard (it admits the name under
 * monthly maintenance, `fee-category-guard.ts`), so the two can never drift apart.
 */

/**
 * Words that keep a name out: another fee ("Inactive Checking Fee", "Excess Transaction Checking
 * Fee", "Replacement", "Late", "Lost", "Bounce", "Withdrawal", "Deposit", "Counter", "Collection",
 * "Foreign", "Unclaimed"), an opening or setup charge ("New Checking Account Fee", "Opening",
 * "Account Opening Checking Fee", "Setup", "Re-open"), or a business account ("Corporate",
 * "Non-Profit", "Analysis", "Merchant", "Professional", "Ag", "Farm", "IOLTA", "Trust", "Estate").
 * Each is tested at the start of every word before "Checking".
 */
const OTHER_FEE_WORD = new RegExp(
  [
    // Another fee that names the checking account.
    String.raw`overdraft|nsf|inactiv\w*|dormant|clos\w*|statements?|paper|excess\w*|transactions?|items?`,
    String.raw`research|transfers?|wires?|atms?|debit|cards?|checks?|returned|stop|minimum|low|balance`,
    String.raw`refunds?|early|order\w*|printing|replac\w*|late|lost|bounc\w*|withdraw\w*|deposit\w*`,
    String.raw`counter|collect\w*|foreign|unclaimed|escheat\w*|garnish\w*|levy|levies|legal`,
    // An opening, setup or reopening charge ("Re-open" is one word to the name, so the hyphen is read).
    String.raw`re-?open\w*|open(?:ing|ed)?|new(?=\s+(?:checking|account)\b)|initial|set\W?up|setup`,
    // A business account's fee, never a consumer account's monthly fee.
    String.raw`business|commercial|corporate|non-?\s?profit|analysis|merchant|professional|ag|farm\w*`,
    String.raw`iolta|ioltas|trust|estates?`,
  ].join("|"),
);
const ACCOUNT_WORD = String.raw`(?!(?:${OTHER_FEE_WORD.source})\b)[A-Za-z][\w&'’.+-]*\s+`;
const CHECKING_FEE_WORDS = String.raw`checking(?:\s+account)?\s+(?:fee|charge)`;
const BY_THE_MONTH = String.raw`\s*\((?:per month|monthly|a month|each month)\)`;

/**
 * A whole name that is a checking account's own fee: one to four words naming the account, then
 * "Checking (Account) Fee|Charge", an optional "(per month)" and nothing else, with an optional
 * footnote number glued to the front. A bare "Checking Account Fee" is that fee only with
 * "(per month)": printed alone it can be an opening fee ("Checking Account Fee - $35.00*" beside the
 * "Checking Account Monthly Fee", doc 3842). A word that names another fee keeps the name out
 * (`OTHER_FEE_WORD`).
 */
export const CHECKING_ACCOUNT_FEE_NAME = new RegExp(
  String.raw`^\W*\d?\s*(?:(?:${ACCOUNT_WORD}){1,4}${CHECKING_FEE_WORDS}(?:${BY_THE_MONTH})?|(?:${ACCOUNT_WORD}){0,4}${CHECKING_FEE_WORDS}${BY_THE_MONTH})\W*$`,
  "i",
);

/**
 * A period that is not a month, or a charge per use: "per year", "annual", "per quarter",
 * "quarterly", "per item", "per debit", "/yr". Printed with a checking account's named fee, the
 * price is not the account's monthly fee.
 */
export const NON_MONTHLY_PERIOD =
  /\b(?:per|a|each|every)\s+(?:year|yr|annum|quarter|qtr|item|debit|check|transaction|withdrawal|deposit|day|week)s?\b|\/\s*(?:year|yr|quarter|qtr|item|debit|check|day|week)\b|\b(?:annual(?:ly)?|yearly|quarterly|semi-?annual(?:ly)?|weekly|daily)\b/i;

/** The name without a bracketed note, footnote marks and leaders, as the name rules read it. */
export function checkingNameCore(name: string): string {
  return name
    .replace(/\((?!\s*(?:per month|monthly|a month|each month)\s*\))[^()]*\)?/gi, " ")
    .replace(/[.…_]{2,}.*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The name, read as the name rules read it, is a checking account's own fee
 * (`CHECKING_ACCOUNT_FEE_NAME`), and nothing in it, a bracketed note included, prices it by a period
 * other than the month (`NON_MONTHLY_PERIOD`: "Gold Checking Fee (per year)").
 */
export function namedForCheckingAccount(feeName: string): boolean {
  return CHECKING_ACCOUNT_FEE_NAME.test(checkingNameCore(feeName)) && !NON_MONTHLY_PERIOD.test(feeName);
}
