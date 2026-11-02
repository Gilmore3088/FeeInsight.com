/**
 * #1092: the fold's ATM heading read with note marks and other banks named in several words. Texas
 * key 2416 (Texas Bank and Trust) prints "TBT or Allpoint ATM: no fee", then "Non-TBT or
 * Non-Allpoint ATM1:" over "Balance inquiry: $0.75". Main's heading pattern
 * (`(\S+)\s+(?:atms?|machines?)\s*:`) does not see "ATM1:", because the footnote digit sits before
 * the colon, so the fold takes "Allpoint ATM:" above it as the bank's own ATM and gives a real
 * non-network ATM fee no home. The same pattern reads "Non TBT ATM:", "Non-Austin Bank ATM:" and
 * "Other Bank ATM:" as the bank's own, from their last word.
 *
 * Switched on, the heading read (`ownAtmSectionMarked`):
 * - sees a note mark on the ATM word: a footnote digit ("ATM1:", "ATMs1:"), superscripts ("ATM¹:"),
 *   asterisks, daggers and a bracketed note ("ATM (1):", "ATM (a):"). One digit only: "ATM10:" and
 *   "ATM1A:" are product codes, and "ATM1 Card:" is no heading;
 * - skips a marked heading whose word is a sentence's ("when you use an ATM*:"), so the heading
 *   above decides;
 * - reads a mark on the bank's name ("Regions¹ ATM:", "MoneyPass® ATM:") as that name;
 * - reads another bank in several words as another bank: "Non TBT ATM:", "Non-Austin Bank ATM:",
 *   "Other Bank ATM:", "Other Banks' ATMs:", "Other Financial Institution ATMs:", "Out of Area ATM:";
 *   a non-customer heading ("Non-Customer Regions ATM:") is not;
 * - reads "In Network ATM:" as the bank's own, as main reads "In-Network ATM:", and a negated heading
 *   ("Not In Network ATM:", "Non In-Network ATM:", "Not Our ATM:") as another network;
 * - reads a heading's leading words from its own line only (`foldContext` keeps the line breaks while
 *   the switch is on), and skips a marked heading whose word names no bank ("Debit Card ATM1:").
 *
 * Off (the default), the fold reads every heading as main does. The switch is read through
 * `footnotedAtmHeadingLive()`, so the lab, the switch gate and the dry run hold it on or off with
 * `withFootnotedAtmHeading` across every read on their path. Pure.
 */
export const FOOTNOTED_ATM_HEADING_LIVE: boolean = false;

let footnotedAtmHeadingOn = FOOTNOTED_ATM_HEADING_LIVE;

/** Whether the marked heading read is on: `FOOTNOTED_ATM_HEADING_LIVE`, unless `withFootnotedAtmHeading` holds it. */
export function footnotedAtmHeadingLive(): boolean {
  return footnotedAtmHeadingOn;
}

/** Runs `read` with the marked heading read on or off (the lab, the switch gate, the dry run, the answer keys). Synchronous reads only. */
export function withFootnotedAtmHeading<T>(on: boolean, read: () => T): T {
  const before = footnotedAtmHeadingOn;
  footnotedAtmHeadingOn = on;
  try {
    return read();
  } finally {
    footnotedAtmHeadingOn = before;
  }
}

/** A word before "ATM:" that makes it another bank's or network's machine. */
export const OTHER_ATM_WORD = /^(?:non\b|non-|foreign|other|out-of|outside|shared|network|surcharge|international|domestic|all\b|any\b)/i;
const OWN_ATM_WORD = /^(?:our|proprietary|in-network)$/i;
const NAMED_ATM_WORD = /^[A-Z][\w&'.]*$/;

/** Main's heading: one word, then the machine, then a colon. */
export const MAIN_ATM_HEADING = /(\S+)\s+(?:atms?|machines?)\s*:/gi;
/** A note mark on the machine word: one footnote digit, superscripts, asterisks, daggers or a bracketed note. */
const NOTE_MARK = String.raw`(?:[1-9](?![\dA-Za-z])|[¹²³⁴⁵⁶⁷⁸⁹⁰]{1,2}|\*{1,3}|[†‡]{1,2}|\s?\((?:[1-9]|[a-z]|\*{1,3}|[†‡])\))`;
const MARKED_ATM_HEADING = new RegExp(String.raw`(\S+)\s+(?:atms?|machines?)(${NOTE_MARK})?\s*:`, "gi");
/** A mark printed on the bank's own name ("Regions¹", "MoneyPass®"). */
const NAME_MARK = /[¹²³⁴⁵⁶⁷⁸⁹⁰*†‡®™]+$/;

/** Words before the heading's last word that name another bank: "Non TBT", "Non-Austin Bank", "Non First Federal". */
const NON_LEAD = /\bnon[- ](?!(?:sufficient|customers?|members?|clients?|account(?:\s?holders?)?|depositors?|cardholders?)\b)(?:[A-Za-z][\w&'’.-]*\s+){0,2}$/i;
/** "Other Bank", "Another Bank's", "Other Financial Institution", "Other Credit Union". */
const OTHER_LEAD = /\b(?:other|another|different)\s+(?:financial\s+|credit\s+)?$/i;
const BANK_WORD = /^(?:banks?|banks['’]|bank['’]s|institutions?|institutions['’]|institution['’]s|unions?|unions['’]|union['’]s)$/i;
/** "Out of Area ATM:", "Outside Network ATM:". */
const OUT_LEAD = /\b(?:out[- ]of|outside)\s+$/i;
/** "In Network ATM:", the bank's own network in two words. */
const IN_LEAD = /\bin\s+$/i;
/**
 * A heading led by a negation is never the bank's own: "Not In Network ATM:", "NOT IN NETWORK ATM:",
 * "ATMs not in network ATM:", "Non In-Network ATM:", "Not In-Network ATM:", "Not Our ATM:",
 * "Outside Network ATM:", "Out of Network ATM:", "Not a Regions ATM:", "Not at a Regions ATM:", "Not Owned by
 * Regions ATM:", "Foreign Regions ATM:", "Except Regions ATM:", "Without Regions ATM:".
 */
const NEGATED_LEAD = /\b(?:not|non|outside|out[- ]of|except|excluding|without|foreign)\b[\s-]*(?:(?:in|a|an|at|the|our|owned|operated|by)\b[\s-]*){0,3}$/i;
/** One word that negates the bank: "Nonproprietary ATM:", "NonRegions ATM:" (not "Nonsufficient", a customer or member). */
const NON_PREFIX_WORD = /^non(?!e$|sufficient|customer|member|client|account|depositor|cardholder)[a-z]/i;
/**
 * A capitalised word that names no bank ("Debit Card ATM1:", "Foreign Transaction Fees ATM*:"): under a
 * note mark it is no heading, so the heading above still decides, as main reads it.
 */
const GENERIC_WORD = /^(?:cards?|debit|credit|fees?|charges?|services?|transactions?|withdrawals?|inquir\w*|surcharges?|usage|access|deposits?|accounts?|atms?|machines?|terminals?|locations?|banking|cash)$/i;
/** Text before the heading's last word read for the words that lead it (never past its own line). */
const LEAD_CHARS = 48;

/** Main's read: the nearest one-word heading above, own when its word is the bank's. */
export function ownAtmSectionMain(before: string): boolean {
  const headings = [...before.matchAll(MAIN_ATM_HEADING)];
  const word = headings.at(-1)?.[1]?.replace(/^[^\w]+/, "");
  if (!word || OTHER_ATM_WORD.test(word)) return false;
  return OWN_ATM_WORD.test(word) || NAMED_ATM_WORD.test(word);
}

/** The switched-on read: as main, with note marks and other banks in several words. */
export function ownAtmSectionMarked(before: string): boolean {
  const headings = [...before.matchAll(MARKED_ATM_HEADING)];
  for (let at = headings.length - 1; at >= 0; at -= 1) {
    const heading = headings[at];
    const word = heading[1].replace(/^[^\w]+/, "").replace(NAME_MARK, "");
    const marked = heading[2] != null;
    // A marked "ATM*:" after a sentence's word ("when you use an ATM*:") or a word that names no bank
    // ("Debit Card ATM1:") is no heading.
    if (marked && /^[a-z]/.test(word) && !OTHER_ATM_WORD.test(word) && !OWN_ATM_WORD.test(word)) continue;
    if (marked && GENERIC_WORD.test(word)) continue;
    const headingAt = heading.index ?? 0;
    // The words that lead the heading, from its own line only ("Withdrawals at non-Regions ATMs" on the
    // line above "Regions ATM:" leads nothing).
    const lineStart = before.lastIndexOf("\n", headingAt - 1) + 1;
    const lead = before.slice(Math.max(lineStart, headingAt - LEAD_CHARS), headingAt);
    if (!word) return false;
    if (NEGATED_LEAD.test(lead)) return false;
    if (/^network$/i.test(word) && IN_LEAD.test(lead)) return true;
    if (OTHER_ATM_WORD.test(word) || NON_PREFIX_WORD.test(word)) return false;
    if (NON_LEAD.test(lead) || OUT_LEAD.test(lead)) return false;
    if (BANK_WORD.test(word) && OTHER_LEAD.test(lead)) return false;
    return OWN_ATM_WORD.test(word) || NAMED_ATM_WORD.test(word);
  }
  return false;
}
