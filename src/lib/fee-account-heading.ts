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
/** Lines a heading search looks up before giving up. */
const HEADING_LOOKBACK = 8;
const HEADING_MAX_CHARS = 60;

/** The account a heading line names, tidied ("Chase Private Client CheckingSM 6" -> "Chase Private Client Checking"). */
export function accountHeading(line: string): string | null {
  let text = line.replace(/\s+/g, " ").replace(/^[#•\-–*\s]+/, "").trim();
  // "Commercial Regular Checking | Charges/Fees": a heading cell beside a column label.
  const labeled = text.match(/^(.+?)\s*\|\s*(?:charges\/fees|fees?|charges?|details)\s*$/i);
  if (labeled) text = labeled[1];
  if (!text || text.includes("|") || PRICE.test(text) || text.length > HEADING_MAX_CHARS) return null;
  text = text
    .replace(/(?<=[a-z])(?:SM|TM)\b/g, "")
    .replace(/[®™℠*]/g, "")
    .replace(/\s+\d{1,2}$/, "")
    .replace(/(?<=[a-z])\d{1,2}$/, "")
    .replace(/\s+(?:account\s+)?(?:fees?\s+(?:and|&)\s+charges?|fees?|charges?|fee schedule)\s*:?\s*$/i, "")
    .replace(/[:\-–]\s*$/, "")
    .trim();
  if (!ACCOUNT_WORDS.test(text) || /\d{2,}/.test(text) || /[.!?]$/.test(text)) return null;
  if (/\b(fee|charge|minimum|balance|deposit|interest|open|opening|require|waive|statement)\b/i.test(text)) return null;
  // Page furniture and group headings name no one account: "Compare Personal Checking", "Learn
  // more about Advantage Checking", "Account Details", "Money Market Accounts".
  if (/\b(compare|comparison|learn|more|overview|details?|info|explore|gift|access|banking|app|mobile|see|section|qualification|benefits?|features?|requirements?|accounts|options|types|our|your|you|find|right|why|how|what|disclosures?|information|rates?|truth|greater|less|than|over|under|is|are|available|from|and|choose|type|services?|charges?|kit|switch|qualified|holders?|with|essentials|for|the|all|higher|earn(ings)?|security|solution|makes|life|simple|that)\b|[&:/,]/i.test(text)) return null;
  // A heading starts with a capital or a digit-free brand ("legacy Checking" is a sentence's tail).
  if (/^[a-z]/.test(text)) return null;
  // The heading must name more than the kind of account ("Account" alone says nothing new).
  if (!text.replace(new RegExp(ACCOUNT_WORDS.source, "gi"), "").replace(/[^A-Za-z]/g, "")) return null;
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

/** The account heading above line `index`, or null when none sits in the fee's own block. */
export function accountHeadingAbove(lines: string[], index: number): string | null {
  let looked = 0;
  for (let i = index - 1; i >= 0 && looked < HEADING_LOOKBACK; i -= 1) {
    const line = lines[i].trim();
    if (!line) continue;
    looked += 1;
    if (MONTHLY_FEE_LINE.test(line)) return null;
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
