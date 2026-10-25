/**
 * A fee named only "Monthly Service Fee" belongs to the account whose heading sits above it
 * ("Chase Total Checking®" / "Monthly Service Fee* | $15"). Five of those at one bank read as
 * one fee five times. The heading is the nearest short line above the fee that names an account
 * and prints no price, found before any line that names another account's monthly fee.
 */

/** Names that say only which kind of fee it is, never whose account. */
export const GENERIC_ACCOUNT_FEE_NAME =
  /^\s*(?:monthly\s+)?(?:service|maintenance|account maintenance)\s+(?:fee|charge)s?\s*\*?\s*:?\s*$|^\s*monthly\s+(?:fee|charge)\s*\*?\s*:?\s*$|^\s*minimum\s+balance\s+(?:fee|charge)\s*\*?\s*:?\s*$/i;

const ACCOUNT_WORDS = /\b(checking|savings|money market|share draft|share account|shares|club|certificate|ira|account|cd)\b/i;
/** A line naming a monthly fee belongs to the block above: the heading search stops there. */
const MONTHLY_FEE_LINE = /\b(monthly|maintenance|service)\s+(fee|charge)/i;
const PRICE = /\$\s?\.?\d/;
/** "Interest" naming the account itself: "Interest Checking", "Super NOW Interest Checking", "Interest Bearing Account". */
const INTEREST_ACCOUNT = /(?<!\b(?:earns?|get|pay)\s+)\binterest(?=\s+(?:bearing\s+)?(?:checking|savings|money market|share draft|account)\b)/gi;
/** Lines a heading search looks up before giving up. */
const HEADING_LOOKBACK = 8;
const HEADING_MAX_CHARS = 60;
/**
 * #1917: where a word of two or more lowercase letters runs straight into a capital. A web page's
 * breadcrumb or menu links print with no space between them ("HomePersonal BankingAccountsPersonal
 * Checking", "Account DetailsFGB Debit Cards"); a brand has one such join at most ("BankOn",
 * "SmartChoice"), and "InControl" or "eChecking" have none by this count.
 */
const FUSED_JOIN = /(?<=[a-z]{2})(?=[A-Z])/g;
/** A breadcrumb's root fused onto the section after it ("HomePersonal", "HomeBorrow"); never "HomeTown". */
const FUSED_HOME_ROOT =
  /^Home(?=(?:Personal|Business|Commercial|Banking|Accounts?|Deposits?|Borrow|Loans?|Lending|Products|Services|Rates|Disclosures|About|Resources|Save|Spend|Member|Online|Consumer|Small)(?:[A-Z\s]|$))/;
/** The words of a line with its fused links split apart ("BankingAccountsPersonal" -> "Banking Accounts Personal"). */
function unfused(text: string): string {
  return text.replace(FUSED_JOIN, " ");
}
/** True when a line is links run together, not one account's name: two fused joins, or a fused "Home" root. */
export function isFusedNavigation(line: string): boolean {
  const text = line.replace(/\s+/g, " ").trim();
  return (text.match(FUSED_JOIN)?.length ?? 0) >= 2 || FUSED_HOME_ROOT.test(text);
}

/** The account a heading line names, tidied ("Chase Private Client CheckingSM 6" -> "Chase Private Client Checking"). */
export function accountHeading(line: string): string | null {
  let text = line.replace(/\s+/g, " ").replace(/^[#•\-–*\s]+/, "").trim();
  // "Commercial Regular Checking | Charges/Fees": a heading cell beside a column label.
  const labeled = text.match(/^(.+?)\s*\|\s*(?:charges\/fees|fees?|charges?|details)\s*$/i);
  if (labeled) text = labeled[1];
  if (!text || text.includes("|") || PRICE.test(text) || text.length > HEADING_MAX_CHARS || isFusedNavigation(text)) return null;
  text = text
    .replace(/(?<=[a-z])(?:SM|TM)\b/g, "")
    .replace(/[®™℠*]/g, "")
    .replace(/\s+\d{1,2}$/, "")
    .replace(/(?<=[a-z])\d{1,2}$/, "")
    .replace(/\s+(?:account\s+)?(?:fees?\s+(?:and|&)\s+charges?|fees?|charges?|fee schedule)\s*:?\s*$/i, "")
    .replace(/[:\-–]\s*$/, "")
    .trim();
  if (!ACCOUNT_WORDS.test(text) || /\d{2,}/.test(text) || /[.!?]$/.test(text)) return null;
  // "Interest Checking" and "Interest Bearing Account" are accounts; "interest" anywhere else is
  // a sentence about the rate.
  // Words are read with fused links split apart (#1917): "DetailsFGB" holds "Details".
  const words = unfused(text);
  if (/\b(fee|charge|minimum|balance|deposit|interest|open|opening|require|waive|statement)\b/i.test(words.replace(INTEREST_ACCOUNT, ""))) return null;
  // Page furniture and group headings name no one account: "Compare Personal Checking", "Learn
  // more about Advantage Checking", "Account Details", "Money Market Accounts".
  if (/\b(compare|comparison|learn|more|overview|details?|info|explore|gift|access|banking|app|mobile|see|section|qualification|benefits?|features?|requirements?|accounts|options|types|our|your|you|find|right|why|how|what|disclosures?|information|rates?|truth|greater|less|than|over|under|is|are|available|from|and|choose|type|services?|charges?|kit|switch|qualified|holders?|with|essentials|for|the|all|higher|earn(ings)?|security|solution|makes|life|simple|that)\b|[&:/,>»›]/i.test(words)) return null;
  // A heading starts with a capital or a digit-free brand ("legacy Checking" is a sentence's tail).
  if (/^[a-z]/.test(text)) return null;
  // The heading must name more than the kind of account ("Account" alone says nothing new).
  // A number ("Club 2 Checking") names one, and so does "Money Market Checking" beside plain checking.
  // A rate ("Checking 1%") names nothing.
  if (!text.replace(new RegExp(ACCOUNT_WORDS.source, "gi"), "").replace(/\d*\.?\d+\s*%/g, "").replace(/[^A-Za-z0-9]/g, "") && !/^money market checking$/i.test(text)) return null;
  if (/[…]|\.{3}/.test(text)) return null;
  return text.split(/\s+/).length <= 7 ? titleCase(text) : null;
}

/**
 * ALL-CAPS words of five letters or more read in title case ("CLASSIC CHECKING" -> "Classic
 * Checking"); short ones ("IRA", "NOW", "MMSA") stay. A name in all caps reads in title case.
 */
function titleCase(text: string): string {
  if (text === text.toUpperCase() && /[A-Z]{3}/.test(text) && !/[a-z]/.test(text) && text.split(/\s+/).length > 1 && !ACCOUNT_WORDS.test(text)) {
    return text.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
  }
  return text.replace(/\b[A-Z]{5,}\b/g, (word) => word[0] + word.slice(1).toLowerCase());
}

/** A table header row whose cells name two accounts or more. */
function comparisonHeader(line: string): boolean {
  if (!line.includes("|")) return false;
  return line.split("|").filter((cell) => accountHeading(cell) !== null).length >= 2;
}

/** The account heading above line `index`, or null when none sits in the fee's own block. */
export function accountHeadingAbove(lines: string[], index: number): string | null {
  let looked = 0;
  for (let i = index - 1; i >= 0 && looked < HEADING_LOOKBACK; i -= 1) {
    const line = lines[i].trim();
    if (!line) continue;
    looked += 1;
    if (MONTHLY_FEE_LINE.test(line)) return null;
    // #1917: a comparison table's header row ("Secure Checking | Secure Checking Plus | Senior
    // Checking") gives each price its column's account; a line above the table (the page title,
    // a breadcrumb) names none of them.
    if (comparisonHeader(line)) return null;
    const heading = accountHeading(line);
    if (heading) return heading;
  }
  return null;
}

/** The account heading above the line holding `excerpt` in `text`, when exactly one line holds it. */
export function accountHeadingForExcerpt(text: string | null | undefined, excerpt: string | null | undefined): string | null {
  if (!text || !excerpt) return null;
  const needle = excerpt.replace(/\s+/g, " ").trim();
  if (needle.length < 8) return null;
  const lines = text.split("\n");
  const holding = lines.flatMap((line, index) => (line.replace(/\s+/g, " ").includes(needle) ? [index] : []));
  return holding.length === 1 ? accountHeadingAbove(lines, holding[0]) : null;
}

/** "Monthly Service Fee*" under "Chase Total Checking" -> "Chase Total Checking Monthly Service Fee". */
export function withAccountName(name: string, heading: string): string {
  return `${heading} ${titleCase(name.replace(/[*:]+\s*$/, "").trim())}`;
}
