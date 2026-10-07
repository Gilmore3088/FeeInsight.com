import { withinAmountEnvelope } from "@/lib/agents/darwin/envelopes";
import { checkFeeCategory } from "@/lib/fee-category-guard";
import { MAX_REASONABLE_FEE_AMOUNT, nameFrom, usableName } from "@/lib/agents/knox/rules";

/**
 * Layout helpers shared by Knox's pass 2 specialists (`table-rows.ts`, `families.ts`).
 * Pure. The pass 1 line rules read one line at a time; these helpers let the
 * specialists pair a name with a price across lines and inside a PDF flattened to one
 * long line, without loosening what counts as a fee.
 */

/** Words that qualify a price right after it: "$5 per item", "$3/month", "$10 each". */
export const QUALIFIER =
  /^\s*(?:\/\s*[a-z.]+(?:\s+[a-z]+)?|(?:per|each|a|an)\s+(?:[a-z]+(?:\/[a-z]+)?)(?:\s+(?:item|check|request|transfer|wire|card|copy|page|day|month|year))?|each|monthly|annually|daily|one-time(?: fee)?|\(each\))?\s*[*+†‡¹²³⁴⁵⁶⁷⁸⁹]*/i;

/** A price or an explicit free word at the start of a line. */
export const LEADING_VALUE = /^\(?\s*(\$\s*\d[\d,]*(?:\.\d{1,2})?|free|none|no charge|n\/c)(?![\w])\)?/i;

/** Explicit free words read as a $0 price. */
export const ZERO_WORD = /^(?:free|none|no charge|n\/c)$/i;

/** Agreement prose, not a fee name: addressed to the reader or written as a rule. */
const PROSE = /\b(you|your|we|will|may|must|shall|would|could|should)\b/i;
const LEADERS = /(?:\.\s?){3,}|…+|_{3,}|…+/g;
const MAX_NAME_WORDS = 14;

/** A cleaned fee name, or null when the text reads as prose or is too long to be one. */
export function cleanFeeName(raw: string): string | null {
  let name = nameFrom(raw.replace(LEADERS, " "))
    // A footnote digit glued to a word ("Excessive transaction fee5"), not a box size ("10X10").
    .replace(/([a-z]{3,}|\))\d{1,2}$/i, "$1")
    .replace(/[=*+†‡¹²³⁴⁵⁶⁷⁸⁹]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (name.split(" ").length > MAX_NAME_WORDS) {
    const tail = name.split(/[.;:!?]\s+/).pop() ?? name;
    name = tail.trim();
  }
  if (name.split(" ").length > MAX_NAME_WORDS || PROSE.test(name) || !usableName(name)) return null;
  return name;
}

/**
 * A run of ALL-CAPS words glued in front of a mixed-case name in flattened text
 * ("SHARE DRAFT - CHECKING Checking Account Monthly Fee") is a section heading.
 */
export function splitCapsHeading(name: string): { heading: string | null; name: string } {
  // Two or more long capitalized words: "SHARE DRAFT", not an acronym pair like "ATM PIN".
  const runs = [...name.matchAll(/(?:\b[A-Z][A-Z0-9&/'()-]*\s+(?:-\s+)?){2,}(?=[A-Z][a-z])/g)].filter(
    (run) => (run[0].match(/\b[A-Z]{4,}/g) ?? []).length >= 2,
  );
  const last = runs.at(-1);
  if (!last) return { heading: null, name };
  const end = (last.index ?? 0) + last[0].length;
  return { heading: last[0].replace(/[\s-]+$/, "").trim(), name: name.slice(end).trim() };
}

const TITLE_CONNECTORS = new Set(["of", "and", "or", "on", "for", "to", "the", "a", "&", "-", "–", "/"]);

/**
 * The Title Case phrase that ends a name, when lowercase words of an earlier clause sit
 * in front of it: in flattened text "if account closed within 30 days Account
 * Reconciliation" is the end of one fee's terms and the start of the next fee's name.
 * Returns null when the whole name is one title (or there is no title at the end).
 */
export function titleTail(name: string): string | null {
  const words = name.split(" ");
  let start = words.length;
  while (start > 0) {
    const word = words[start - 1];
    const lead = word.replace(/^[^A-Za-z0-9]+/, "");
    if (lead === "" || /^[A-Z0-9]/.test(lead) || TITLE_CONNECTORS.has(word.toLowerCase())) start -= 1;
    else break;
  }
  while (start < words.length && TITLE_CONNECTORS.has(words[start].toLowerCase())) start += 1;
  if (start === 0 || words.length - start < 2) return null;
  return words.slice(start).join(" ");
}

/**
 * A line between a fee name and its price that only qualifies the name: "(for each
 * overdraft item paid)", "(up to $1,000)", "If checks are not on order (10 maximum)".
 * The name above it still names the price below it.
 */
export function qualifiesName(line: string): boolean {
  return line.length <= 120 && !LEADING_VALUE.test(line) && (/^\(.*\)$/.test(line) || /^(?:if|when|for each|per)\b/i.test(line));
}

/** A cell that only qualifies a price or belongs to the row beside it: "Per Item", "/Item", "each", "N/C", "APY of .00%". */
const UNIT_CELL =
  /^(?:\/\s*[a-z.]+|per\s+[\w/ -]{1,30}|each|ea\.?|monthly|annual(?:ly)?|fee|amount|charge|n\/c|free|none|no charge|[^a-z]*|apy\b.*)$/i;
/** A unit or list marker glued to the front of a name: "/Item Cashier's Check", "per year Duplicate Key", "b. NSF". */
// The previous row's bare price also leads a name in one-line schedules ("100.00 Overdraft (items paid)").
const LEADING_FRAGMENT = /^(?:(?:\/\s*[A-Za-z.]+|per\s+[a-z/]+(?:\s+[a-z]+)?|each|ea\.)\s+(?=[A-Z“"(•●▪■◦➢►▸])|[a-z]\.\s+(?=[A-Z])|\d{1,2}[.)]\s+(?=[A-Z])|\$?\d[\d,]*\.\d{2}\s+(?=[A-Z]))/;

/** Trailing stops and separators, except the stop of an abbreviation ("Outside U.S."). */
function trimEnd(name: string): string {
  let result = name;
  while (/[\s:;,\-–|/.]$/.test(result) && !/(?:^|[^A-Za-z])[A-Za-z]\.$/.test(result)) result = result.slice(0, -1);
  return result;
}

/**
 * The fee name a reader sees: table separators, dot leaders, bullets and the unit or
 * list-marker fragments of neighbouring cells removed. Category, price and the excerpt
 * (the evidence) are untouched. Returns the input when tidying would leave no usable name.
 */
export function tidyFeeName(raw: string): string {
  let cells = raw
    .replace(LEADERS, " ")
    .replace(/::/g, ":")
    .split(/\s+\|\s+|\s*\|\s*/)
    .map((cell) => cell.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  // A unit cell at either end is the price's qualifier or the next row's, not the name.
  // So is the end of the previous row's sentence ("than 22 years. | Out-of-Network ATMs",
  // "Use your Checking Account for ... | Money Order").
  const notAName = (cell: string) => UNIT_CELL.test(cell) || /^[a-z]/.test(cell) || PROSE.test(cell) || /\.$/.test(cell);
  while (cells.length > 1 && notAName(cells[0])) cells = cells.slice(1);
  while (cells.length > 1 && UNIT_CELL.test(cells[cells.length - 1])) cells = cells.slice(0, -1);
  let name = cells.map((cell) => trimEnd(cell.replace(/[\s:]+$/, ""))).join(": ");
  // Bullets and unit fragments can stack ("/transfer ● Drill lock on box").
  for (let pass = 0; pass < 3; pass += 1) {
    name = name.replace(LEADING_FRAGMENT, "").replace(/^[\s•●▪■◦➢►▸–—\-*·:;,)\]]+/u, "");
  }
  name = name
    .replace(/\(\s*\)/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[\s:;,\-–|/]+$/, "")
    .trim();
  name = trimEnd(name);
  // "(Money Order)" alone is the name in parentheses.
  const wrapped = name.match(/^\(([^()]+)\)$/);
  if (wrapped) name = wrapped[1].trim();
  return usableName(name) ? name : raw.trim();
}

/** A short title line: a section heading such as "Wire Transfers". */
export function looksLikeHeading(line: string, maxWords = 6): boolean {
  const words = line.split(/\s+/).filter(Boolean);
  return words.length >= 1 && words.length <= maxWords && /[a-z]/i.test(line) && !/[.!?]$/.test(line) && !PROSE.test(line) && !line.includes("$");
}

/**
 * A row name that only makes sense under its section heading: a direction, a unit or
 * a customer type ("Incoming Domestic" under "Wire Transfers", "Per Item" under
 * "Overdraft Fees") or a column label ("Fee Rush Card Fee | Amount $50"). Only such
 * names borrow the heading, so a heading never lends its category to an unrelated fee
 * below it.
 */
const COMPOSABLE_WORDS = new Set(
  (
    "domestic international foreign intl incoming outgoing in out per each item items presentment occurrence " +
    "transfer transfers wire request paid returned unpaid consumer business personal member members non " +
    "nonmember customer first additional subsequent thereafter day month fee fees amount charge charges cost price " +
    // "Cash withdrawals - Within U.S. / U.S. territories" under "ATM fees – At non-Wells Fargo ATMs".
    "cash withdrawal withdrawals within outside territories " +
    // "Business accounts only" under "Non-Sufficient Funds (NSF)".
    "account accounts only"
  ).split(" "),
);

export function composableTail(name: string): boolean {
  // Single letters are the pieces of an abbreviation ("U.S."), not words.
  const words = name.toLowerCase().split(/[\s\-–:,()&/.*]+/).filter((word) => word.length > 1);
  return words.length > 0 && words.length <= 5 && words.every((word) => COMPOSABLE_WORDS.has(word) || /^\d+(st|nd|rd|th)?$/.test(word));
}

/** Categories whose price is itself a cap ("Overdraft daily maximum | $150"). */
const CAP_CATEGORIES = new Set(["od_daily_cap", "nsf_daily_cap"]);
/** A fee for going past a limit, which is a real price ("Over Limit Fee", "Regulation D Transfer Limit Violation"). */
const PAST_A_LIMIT = /\b(?:over|above|exceed\w*|excess\w*|violat\w*|beyond)\b/i;
/** A name that ends on a limit ("Zelle transfer limit", "Mobile Deposit Checks are limited to", "Cash Advance Fee (maximum"). */
const ENDS_ON_LIMIT =
  /\b(?:limit(?:s|ed)?(?:\s+(?:is|are|to|of))?|(?:daily|transfer|withdrawal|deposit)\s+max(?:imum)?|max(?:imum)?\s+(?:card\s+)?load|reloadable up to \d+ times)\s*[:.]?\s*(?:\((?:per|daily|each|for)\b[^)]*\)?)?\s*$|\(\s*(?:daily\s+)?limit\b[^)]*\)?\s*$|\(\s*maximum\s*$/i;
const FEE_WORD = /\b(?:fees?|charges?)\b/i;

/**
 * v28: a price the name says is a limit is not a fee: "If you use ... Zelle, the limit is
 * $2,500", "Mobile Deposit (daily limit) $50", "No Bounce Courtesy Pay Limit $600". A cap
 * category keeps its cap, and a fee for going past a limit keeps its price.
 */
export function namesALimit(feeName: string, canonicalKey: string): boolean {
  if (PAST_A_LIMIT.test(feeName) || !ENDS_ON_LIMIT.test(feeName.trim())) return false;
  // "Overdraft daily maximum | $150" caps fees; "Courtesy Pay Limit | $600" caps the overdraft.
  return !CAP_CATEGORIES.has(canonicalKey) || (/\blimit(?:s|ed)?\b(?![\s\S]*\bmax)/i.test(feeName) && !FEE_WORD.test(feeName));
}

/**
 * A pass 2 specialist emits a fee only when Darwin's own checks would accept it: the
 * name supports the category (the category guard) and the amount sits inside the
 * category's plausible range. Pass 1 keeps its older behavior and lets Darwin judge.
 */
export function passesDarwinChecks(canonicalKey: string, feeName: string, amount: number): boolean {
  if (!checkFeeCategory(canonicalKey, feeName).ok) return false;
  if (amount === 0) return true;
  return amount > 0 && amount <= MAX_REASONABLE_FEE_AMOUNT && withinAmountEnvelope(canonicalKey, amount);
}
