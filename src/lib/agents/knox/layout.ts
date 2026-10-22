import { withinAmountEnvelope } from "@/lib/agents/darwin/envelopes";
import { checkFeeCategory } from "@/lib/fee-category-guard";
import { MAX_REASONABLE_FEE_AMOUNT, nameFrom, stripFootnoteMarks, usableName, VARIES_PRICE } from "@/lib/agents/knox/rules";

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
/**
 * v93 (#1828): a price stated in words at the end of a dot-leader row ("Reconveyance………… Actual
 * Cost", "Check Orders………… Prices Vary", "Incoming Wire....... Free"). The row is closed: its
 * name never runs into the next row's.
 */
export const LEADER_PRICE_WORDS =
  /[A-Za-z)]\s*(?:(?:\.\s?){2,}|…+)[\s.…]*(?:free|none|no charge|n\/c|n\/a|waived|included|varies|prices?\s+vary|fees?\s+may\s+vary|actual\s+cost|at\s+cost|cost(?:\s+incurred)?|call(?:\s+for\s+\w+)?)\s*\.?\s*$/i;
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
 * #1827: a fee name that says its price varies ("Mortgage satisfaction fee (varies)"), so a price-first
 * line below it ("$1,000.00 Mortgage modification", Citadel FCU) is the name after that price, not
 * this one's. A bare price below it is still its own ("Skip-A-Payment Fee (Varies with payment)" /
 * "$25.00").
 */
export function statesItsPriceVaries(name: string): boolean {
  return VARIES_PRICE.test(name);
}

/**
 * #1827: a name line that runs on ("Inactivity Fee - Savings Account per", "Overdraft Protection
 * Transfer (From"): a two-column page wrapped it, and the price below is still its own, whatever the
 * other column prints beside that price ("$5 | Cross-border transaction fee").
 */
export function runsOn(name: string): boolean {
  // A markdown table's rule row ("| --- | --- |") names nothing.
  if (!/[a-z]{2,}/i.test(name)) return false;
  const open = (name.match(/\(/g) ?? []).length > (name.match(/\)/g) ?? []).length;
  return open || /(?:(?:^|\s)(?:per|of|for|from|to|and|or|with|the|a|an|in|on|at|by|if|than|over|under)|[-–—&/,])\s*$/i.test(name.replace(/[\s|*]+$/, ""));
}

/** A word that opens a condition or a period after a price, never the next fee's name. */
// A period word opens a fee's own name when a capitalized word follows it ("Monthly Service Charge",
// "Annual Rental 3 x 5 Box"); alone or before lower-case words it is the price's period.
const CONDITION_OPENING = /^(?:per|each|every|a|an|one-time|waived?|max(?:imum)?|min(?:imum)?|if|unless|plus|up|after|when|with|for|or|and|to|of|on|in|at|by|the|fee|charge|varies)\b|^[/(]/i;
// Case-sensitive on the next word, so no /i: "Monthly Service Charge" is a name, "Monthly for paper
// statements" is a period.
const PERIOD_OPENING = /^(?:[Mm]onthly|[Aa]nnual(?:ly)?|[Yy]early|[Qq]uarterly|[Dd]aily|[Ww]eekly|MONTHLY|ANNUAL(?:LY)?|YEARLY|QUARTERLY|DAILY|WEEKLY)\b(?!\s+[A-Z])/;

/**
 * #1827: the fee a price-first row names: the words printed after the price on its own line or in a
 * later cell of its row ("| **$20** | Key Deposit |", "$1,000.00 Mortgage modification"). `rest` is
 * the line after the price and its qualifier. Only a capitalized name that does not open as a
 * condition or a period ("$5.00 per month", "| $25 | Waived for seniors |") and holds two letters
 * or more; else null, and the price keeps whatever name it had.
 */
export function nameAfterPrice(rest: string): string | null {
  const cell = rest
    .replace(/[*_`]+/g, " ")
    .split(/\s*\|\s*/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .find((part) => /[a-z]{2,}/i.test(part));
  if (!cell || !/^[A-Z]/.test(cell) || CONDITION_OPENING.test(cell) || PERIOD_OPENING.test(cell) || /\$\s*\d/.test(cell)) return null;
  const name = cleanFeeName(cell);
  return name && /[a-z]{2,}/i.test(name) ? name : null;
}

/**
 * #1827: a table row that opens with its price and names its fee after it ("| **$20** | Key Deposit |",
 * "$10 | Replacement Debit Card"), with one price on the line.
 */
export function priceFirstRow(line: string): boolean {
  if (!line.includes(" | ")) return false;
  const row = line.replace(/^[\s|*_`]+/, "");
  // v94 (#1827): a range price cell ("$5-$15 | Levy") opens its row as one price does.
  const range = row.match(LEADING_RANGE);
  const lead = range ?? row.match(LEADING_VALUE);
  if (!lead || /^(?:free|none|no charge|n\/c)$/i.test(lead[1]) || (row.match(/\$\s*\d/g) ?? []).length !== (range ? 2 : 1)) return false;
  const rest = row.slice(lead[0].length);
  return nameAfterPrice(rest.slice(rest.match(QUALIFIER)?.[0].length ?? 0)) != null;
}

/** "$5-$15", "$5 - $15": a price range that opens a row. */
const LEADING_RANGE = /^\(?\s*(\$\s*\d[\d,]*(?:\.\d{1,2})?\s*[-–]\s*\$\s*\d[\d,]*(?:\.\d{1,2})?)(?![\w])\)?/;
/** A bare price on its own line ("$7.00", "**$25.00 per item**"). */
const BARE_PRICE_LINE = /^[\s*_`]*\$\s*\d[\d,]*(?:\.\d{1,2})?[\s*_`]*(?:(?:per|each|a|an)\s+[a-z]+)?[\s*_`]*$/i;

/**
 * v94 (#1827): a list line with no cells that opens with its one price and names its fee after it
 * ("$14.00 Safe Deposit Box 3”x5”x22”/Year"). A dot-leader line ("$10.00 Outgoing Wire .....") is
 * not one: in a dot-leader page the price that opens a line is the line above's.
 */
export function priceFirstListLine(line: string): boolean {
  if (line.includes(" | ") || /(?:\.\s?){3,}|…/.test(line)) return false;
  const row = line.replace(/^[\s*_`]+/, "");
  const lead = row.match(LEADING_VALUE);
  if (!lead || /^(?:free|none|no charge|n\/c)$/i.test(lead[1]) || (row.match(/\$\s*\d/g) ?? []).length !== 1) return false;
  const rest = row.slice(lead[0].length);
  return nameAfterPrice(rest.slice(rest.match(QUALIFIER)?.[0].length ?? 0)) != null;
}

/**
 * #1827: a price-first row is read as one only in a run of them (the line above or below is one too),
 * or with no name line above it. A single "$35.00 | Stop Payment Fee" under "Overdraft Fee" is a
 * two-column page's right column beside the left name's price, or a description cell ("$35 |
 * Charged when an item is paid"), so the price stays with the name above.
 */
export function inPriceFirstRun(lines: readonly string[], index: number): boolean {
  return priceFirstRow(lines[index] ?? "") && (priceFirstRow(lines[index - 1] ?? "") || priceFirstRow(lines[index + 1] ?? ""));
}

/**
 * v94 (#1827): a cell-less price-first list ("$100.00 Safe Deposit Box Drilling/Per Box" / "$14.00 Safe
 * Deposit Box 3”x5”x22”/Year" / ...) is read one fee per line, so no box takes the next size's price.
 * It counts only as a run of two such lines or more that a bare price does not close: "Overdraft Fee"
 * / "$30.00 Stop Payment" / "$25.00 Returned Item" / "$5.00" is a stacked page, each price under the
 * name above it, and stays read that way.
 */
export function inPriceFirstListRun(lines: readonly string[], index: number): boolean {
  if (!priceFirstListLine(lines[index] ?? "")) return false;
  let start = index;
  let end = index;
  while (start > 0 && priceFirstListLine(lines[start - 1])) start -= 1;
  while (end + 1 < lines.length && priceFirstListLine(lines[end + 1])) end += 1;
  return end > start && !BARE_PRICE_LINE.test(lines[end + 1] ?? "");
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
  /^(?:\/\s*[a-z.]+|per\s+[\w/ -]{1,30}|each|ea\.?|monthly|annual(?:ly)?|fee|amount|charge|n\/c|n\/a|free|none|no charge|[^a-z]*|apy\b.*)$/i;
/** v57: a details cell after the name ("ATM Transaction | Fee applies to the use of an ATM or terminal not owned ..."). */
const DETAILS_CELL = /^(?:(?:fees?|charges?)\s+(?:applies|apply|is|are|will|may)\b|(?:if|when|unless|based on)\b)/i;
const MAX_DETAILS_FREE_WORDS = 10;
/** v57: a word that joins a sentence to the one before it ("Otherwise, a monthly service fee of $6.95"). */
// v60: "In addition to the Card Replacement Fee" is not a joined sentence ("To the Card Replacement Fee").
const LEADING_DISCOURSE = /^(?:otherwise|additionally|also|however|in addition(?!\s+to\b)|furthermore|further)\s*,?\s+/i;
/** v60: a section heading that is no fee's name ("SERVICE FEES"), so a details cell is not dropped down to it. */
const SECTION_HEADING = /^(?:[\w&'’-]+\s+){0,2}(?:fees|charges|services)$/i;
/** v60: a schedule's "Name" column label read onto the name ("Name Stop Payment | Fee $25.00", Maple FCU). */
const NAME_LABEL = /^Name:?\s+(?=[A-Z])(?!Changes?\b)/;
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
  // v93 (#1828): a cell that is a row priced in words ("Check Orders .. Prices Vary | Duplicate Lien
  // Release", "Reconveyance .. Actual Cost: Returned payment") is the row before this fee's, so the
  // name starts after it.
  const rawCells = raw.split(/\s*\|\s*|(?<=[A-Za-z])\s*:\s+/);
  const closedRow = rawCells.findLastIndex((cell, index) => index < rawCells.length - 1 && LEADER_PRICE_WORDS.test(cell));
  const after = closedRow >= 0 ? rawCells.slice(closedRow + 1).join(" | ") : raw;
  let cells = (/[a-z]{2,}/i.test(after) ? after : raw)
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
  // v57: a details column after the name is the row's description, not the name.
  const details = (cell: string) => DETAILS_CELL.test(cell) || PROSE.test(cell) || cell.split(" ").length > MAX_DETAILS_FREE_WORDS;
  while (cells.length > 1 && details(cells[cells.length - 1]) && !details(cells[0])) {
    if (cells.length === 2 && SECTION_HEADING.test(cells[0])) break;
    cells = cells.slice(0, -1);
  }
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
  name = name.replace(NAME_LABEL, "");
  const joined = LEADING_DISCOURSE.test(name);
  name = name.replace(LEADING_DISCOURSE, "");
  name = name.replace(joined ? /^(?:A|An|The)\s+(?=[a-z])([a-z])/i : /^(?:A|An|The)\s+(?=[a-z])([a-z])/, (_, first: string) => first.toUpperCase());
  if (joined) name = name.replace(/^[a-z]/, (first) => first.toUpperCase());
  // "(Money Order)" alone is the name in parentheses.
  const wrapped = name.match(/^\(([^()]+)\)$/);
  if (wrapped) name = wrapped[1].trim();
  name = withoutLeadingCondition(name);
  return usableName(name) ? name : raw.trim();
}

/** v98: a condition clause ("If the balance ...", "Waived for ...") opens on a lowercase word. */
const CONDITION_CLAUSE = /^(?:If|When|Unless|Waived|Except|Excluding)\s+[a-z]/;
/** v98: a duration minimum or maximum ("30 minute minimum") is the previous row's condition. */
const DURATION_LEAD = /^\d+\s*(?:minutes?|mins?|hours?|hrs?)\s+(?:minimum|maximum|min|max)\b\s+(?=[A-Z])/i;
/** v98: a lowercase connector and its words ("and minimum ") left from the previous row. */
const CONNECTOR_LEAD = /^(?:and|or|plus)\s+(?:[a-z][\w'’-]*\s+)*(?=[A-Z])/;
/**
 * The first lowercase word or figure before a capitalised one: where the glued name starts. The
 * first, not the last, so the name's own lowercase words ("Overdraft Fee per Item") stay in it.
 */
const LOWER_THEN_CAPITAL = /\s(?:[a-z][\w'’-]*|\$?\d[\d,.]*)\s+(?=[A-Z])/;
const MAX_TAIL_NAME_WORDS = 10;

/**
 * v98: the previous row's condition glued in front of this row's name in a long stored line
 * ("If the balance falls below on any day of the cycle Excess withdrawal", "30 minute minimum Wire
 * transfer outgoing", "and minimum Photocopies"). The name starts at its first capitalised word. A name
 * whose own words start with a condition word ("Waived Fee Reversal", "If Paid Overdraft Fee")
 * keeps them: a clause opens on a lowercase word.
 */
export function withoutLeadingCondition(name: string): string {
  const lead = name.match(DURATION_LEAD) ?? name.match(CONNECTOR_LEAD);
  if (lead) return name.slice(lead[0].length);
  if (!CONDITION_CLAUSE.test(name)) return name;
  const first = name.match(LOWER_THEN_CAPITAL);
  if (!first || first.index == null) return name;
  const tail = name.slice(first.index + first[0].length);
  return tail.split(/\s+/).length <= MAX_TAIL_NAME_WORDS ? tail : name;
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
  return amount > 0 && amount <= MAX_REASONABLE_FEE_AMOUNT && withinAmountEnvelope(canonicalKey, amount, feeName);
}
