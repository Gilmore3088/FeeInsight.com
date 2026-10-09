import { withinAmountEnvelope } from "@/lib/agents/darwin/envelopes";
import { checkFeeCategory } from "@/lib/fee-category-guard";
import { MAX_REASONABLE_FEE_AMOUNT, nameFrom, stripFootnoteMarks, usableName } from "@/lib/agents/knox/rules";

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
  // v42: a long name that ends in a note keeps its title, not the note's last clause
  // ("Overdraft Fee - each debit or check presentment paid (Consumer Accts: 5 max total OD
  // or Returned Item fees daily)", BankIowa).
  const noteless = name.replace(/\s*\([^()]*\)?$/, "").trim();
  if (name.split(" ").length > MAX_NAME_WORDS && noteless !== name && noteless.split(" ").length <= MAX_NAME_WORDS && usableName(noteless)) {
    name = noteless;
  }
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

/** A connector left at the end of a name where the sentence ran on into the price. */
const MAX_TITLE_WORDS = 8;
const DANGLING_END = /(?:\s+(?:a|an)\s+(?:fee|charge))?\s+(?:of|for|at|is|to|and|or|with|by|a|an|the)$/i;

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
    // A footnote number left behind once the dot leaders are gone ("Check Cashing Fee1. . . $5").
    .map((cell) => stripFootnoteMarks(cell.replace(/\s+/g, " ").trim()))
    .filter(Boolean);
  // A unit cell at either end is the price's qualifier or the next row's, not the name.
  // So is the end of the previous row's sentence ("than 22 years. | Out-of-Network ATMs",
  // "Use your Checking Account for ... | Money Order").
  const notAName = (cell: string) => UNIT_CELL.test(cell) || /^[a-z]/.test(cell) || PROSE.test(cell) || /\.$/.test(cell);
  while (cells.length > 1 && notAName(cells[0])) cells = cells.slice(1);
  while (cells.length > 1 && UNIT_CELL.test(cells[cells.length - 1])) cells = cells.slice(0, -1);
  // A "None"/"Free" cell between names is the previous row's price: the name starts after it
  // ("Monthly service fee | None | Bill payment- same day ACH").
  const lastValue = cells.findLastIndex((cell, index) => index < cells.length - 1 && ZERO_WORD.test(cell));
  if (lastValue >= 0) cells = cells.slice(lastValue + 1);
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
  // v46: "Normal bank fees and charges, including returned item charge/overdraft item charge of"
  // (Origin Bank): after a general "fees and charges", the fee is what the sentence lists after
  // "including". "NSF for each presentment, including if the same item is presented" keeps its name.
  const listed = name.match(/\b(?:fees|charges)(?:\s+and\s+(?:fees|charges))?,\s+including\s+(.+)$/i)?.[1];
  // A name at the 120-character cap may end mid-word, so it keeps its words.
  if (listed && raw.trim().length < 120 && listed.split(" ").length <= MAX_TITLE_WORDS) name = `${listed.charAt(0).toUpperCase()}${listed.slice(1)}`;
  // The words that led into the price ("Replacement Card Fee of", "ATM Fee for",
  // "Debit Card Replacement A fee of") and an article in front ("A minimum balance fee").
  // A sentence keeps its ending: "required to avoid a minimum balance fee of" is how the
  // category guard tells a fee sentence from a balance requirement.
  if (name.split(" ").length <= MAX_TITLE_WORDS) {
    for (let pass = 0; pass < 2; pass += 1) name = trimEnd(name.replace(DANGLING_END, ""));
  }
  name = name.replace(/^(?:A|An|The)\s+(?=[a-z])([a-z])/, (_, first: string) => first.toUpperCase());
  // "(Money Order)" alone is the name in parentheses.
  const wrapped = name.match(/^\(([^()]+)\)$/);
  if (wrapped) name = wrapped[1].trim();
  return usableName(name) ? name : raw.trim();
}

/**
 * Two shapes a PDF's columns leave in a name, fixed without changing its words otherwise:
 * - a parenthesis the line break cut off ("Early Account Closure (by Extraco – no",
 *   "Consumer, Inactivity Fee (Notification sent at 10"): the name ends before the first
 *   unclosed "(", or loses a lone opening "(" when nothing comes before it;
 * - a word printed twice where a row label meets its cell ("Account Research Research",
 *   "MORTGAGE Mortgage Fax Fee", "Monthly Fee Fee is waived if ..."): an ALL-CAPS heading
 *   word is dropped, a description after the repeat ("is waived ...") is dropped, and
 *   otherwise the repeat is read once ("Personal Loan Loan Application Fee").
 * Returns the input when the result would not be a usable name.
 */
export function repairNameShape(raw: string): string {
  let name = raw.replace(/\s+/g, " ").trim();
  const open: number[] = [];
  for (let index = 0; index < name.length; index += 1) {
    if (name[index] === "(") open.push(index);
    else if (name[index] === ")") open.pop();
  }
  if (open.length > 0) {
    const cut = open[0];
    name = cut === 0 ? name.slice(1).trim() : name.slice(0, cut).replace(/[\s,;:\-–—]+$/u, "").trim();
  }
  // The other cut: a ")" whose "(" was on the line above ("Bill Payment Service)").
  let depth = 0;
  let unmatched = "";
  for (const char of name) {
    if (char === "(") depth += 1;
    else if (char === ")") {
      if (depth === 0) continue;
      depth -= 1;
    }
    unmatched += char;
  }
  if (unmatched !== name) name = unmatched.replace(/[\s,;:\-–—]+$/u, "").trim();
  const doubled = name.match(/\b([A-Za-z][A-Za-z'’]{2,})\s+(\1)\b/i);
  if (doubled && doubled.index !== undefined) {
    const [whole, first, second] = doubled;
    const start = doubled.index;
    const after = name.slice(start + whole.length);
    if (first === first.toUpperCase() && second !== second.toUpperCase()) {
      name = (name.slice(0, start) + name.slice(start + first.length)).trim();
    } else if (/^\s+[a-z]/.test(after)) {
      name = name.slice(0, start + first.length).trim();
    } else {
      name = (name.slice(0, start + first.length) + after).trim();
    }
  }
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
    "account accounts only " +
    // "Service assisted" and "Online" under "Stop Payments".
    "online service assisted branch series " +
    // v34: "Per transaction" beside "Overdraft Fee - Items Paid" (Banc of California).
    "transaction transactions"
  ).split(" "),
);

/** What a stop payment row is placed on ("Online per check", "Per ACH payment"); only a stop payment heading lends to these. */
export const STOP_PAYMENT_ITEM_WORDS = new Set(["check", "checks", "ach", "payment", "payments", "draft", "drafts"]);

export function composableTail(name: string, also: ReadonlySet<string> = new Set()): boolean {
  // Single letters are the pieces of an abbreviation ("U.S."), not words.
  const words = name.toLowerCase().split(/[\s\-–:,()&/.*]+/).filter((word) => word.length > 1);
  return words.length > 0 && words.length <= 5 && words.every((word) => COMPOSABLE_WORDS.has(word) || also.has(word) || /^\d+(st|nd|rd|th)?$/.test(word));
}

/** Categories whose price is itself a cap ("Overdraft daily maximum | $150"). */
const CAP_CATEGORIES = new Set(["od_daily_cap", "nsf_daily_cap"]);
/** A fee for going past a limit, which is a real price ("Over Limit Fee", "Regulation D Transfer Limit Violation"). */
const PAST_A_LIMIT = /\b(?:over|above|exceed\w*|excess\w*|violat\w*|beyond)\b/i;
/** A name that ends on a limit ("Zelle transfer limit", "Mobile Deposit Checks are limited to", "Cash Advance Fee (maximum", v30: "the limit will increase to", "Daily ATM Limits ($/#)"). */
const ENDS_ON_LIMIT =
  /\b(?:limit(?:s|ed)?(?:\s+(?:is|are|to|of|will\s+(?:increase|be\s+(?:increased|raised))\s+to))?|(?:daily|transfer|withdrawal|deposit)\s+max(?:imum)?|max(?:imum)?\s+(?:card\s+)?load|reloadable up to \d+ times)\s*[:.]?\s*(?:\((?:(?:per|daily|each|for)\b|\$\s*\/)[^)]*\)?)?\s*$|\(\s*maximum\s*$/i;
/** A trailing note that names a limit ("Zelle (Daily Limits)"); a fee's own note ("Mobile Deposit Fee (daily limits apply)") does not count. */
const LIMIT_NOTE = /\(\s*(?:daily\s+|transaction\s+)?limits?\b[^)]*\)?\s*$/i;
const FEE_WORD = /\b(?:fees?|charges?)\b/i;
/** v31: a cap on what the bank pays back ("The maximum rebate per 12-month cycle | $240") is never a fee. */
const REBATE_CAP = /\bmax(?:imum)?\s+(?:\w+\s+)?(?:rebates?|refunds?|reimbursements?)\b/i;

/**
 * v28: a price the name says is a limit is not a fee: "If you use ... Zelle, the limit is
 * $2,500", "Mobile Deposit (daily limit) $50", "No Bounce Courtesy Pay Limit $600". A cap
 * category keeps its cap, and a fee for going past a limit keeps its price.
 */
/**
 * v32: a figure from a worked example ("Example: Assume you establish a bill pay payment ...
 * in the amount of $100", "For example, if you have 1 overdraft ...", "example results in
 * total Overdraft Transfer Fees of $18") is not a price. Hamilton's limit guard uses the same
 * test on live fees (`WORKED_EXAMPLE_PG` is its Postgres form).
 */
export const WORKED_EXAMPLE = /^\W*(?:for\s+)?(?:example|e\.g\.|assume|suppose|illustration|hypothetical)\b|\bexample results?\b/i;
export const WORKED_EXAMPLE_PG = String.raw`^\W*(for\s+)?(example|e\.g\.|assume|suppose|illustration|hypothetical)\M|\mexample results?\M`;

export function namesAWorkedExample(feeName: string): boolean {
  return WORKED_EXAMPLE.test(feeName.trim());
}

/**
 * v32: a figure that follows a comparison or "on" at the end of the name is what the fee is
 * measured against, not its price: "if your Available Balance ... is at least | $0" (U.S. Bank's
 * waiver rule), "the $34 Overdraft Fee on | the $60 gasoline transaction" (Chase's worked
 * example). Only fires when the text has the name's last words right before that same figure,
 * so "$5 service charge if balance falls below $300" still reads $5.
 */
const MEASURED_AGAINST_TAIL = /(?:\bat\s+(?:least|most)|\bno\s+(?:more|less)\s+than|\b(?:more|less|greater|fewer)\s+than|\bexceeds?|\bexceeding|\bbelow|\babove|\bunder|\bover|\bon)\s*$/i;

function amountPattern(amount: number): string {
  const [whole, cents] = amount.toFixed(2).split(".");
  const grouped = Number(whole).toLocaleString("en-US").replace(/,/g, ",?");
  return cents === "00" ? `${grouped}(?:\\.00)?` : `${grouped}\\.${cents}`;
}

export function readsAMeasuredAmount(text: string, feeName: string, amount: number): boolean {
  const name = feeName.trim();
  if (!MEASURED_AGAINST_TAIL.test(name)) return false;
  const lastWords = name.split(/\s+/).slice(-6).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  return new RegExp(`${lastWords}\\s*(?:the\\s+)?\\$\\s*${amountPattern(amount)}(?![\\d.,]*\\d)`, "i").test(text);
}

export function namesALimit(feeName: string, canonicalKey: string): boolean {
  const name = feeName.trim();
  if (REBATE_CAP.test(name)) return true;
  const limitNote = LIMIT_NOTE.test(name) && !FEE_WORD.test(name.replace(LIMIT_NOTE, ""));
  if (PAST_A_LIMIT.test(name) || !(ENDS_ON_LIMIT.test(name) || limitNote)) return false;
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
