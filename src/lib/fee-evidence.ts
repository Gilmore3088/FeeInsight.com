import { checkFeeAgainstSource, sourceLines } from "@/lib/custom-report/source-check";
import { accountHeading } from "@/lib/fee-account-heading";
import { ownCells } from "@/lib/agents/knox/own-cells";

/**
 * A live fee's evidence: the line of the bank's own stored schedule that prints its price, and
 * the account heading above that line when one sits in the fee's block ("NOW Checking" over
 * "Account Fees: The monthly service charge if the daily balance drops below $500.00 any day of
 * the statement cycle is $10.00."). A reader sees the exact amount, the account, the period and
 * the conditions in the bank's words, or nothing: a fee whose line can't be shown is unverified.
 * The heading search names the account a price belongs to even when other lines sit between the
 * name and the price (`headingAbove`), and `condition` quotes the waiver printed with it.
 *
 * Before this, public pages quoted the fee's stored name as its evidence ("Account Fees: The
 * monthly service charge"), which never prints the price: on Oct 16, 79,501 of 79,913 live
 * dollar fees showed no amount in what the page quoted (1NB Bank, #1652 review).
 *
 * The line comes from the one shared check, `checkFeeAgainstSource`, so it is the row Hamilton's
 * source check traces the fee to. A fee priced for a balance band ("if the daily balance drops
 * below $500.00 ... is $10.00") passes that check as `tiered_fee` without a line; its line is the
 * one schedule line that names the fee and prints the price. When neither gives a line, the line Knox stored
 * when it read the fee (`excerpt="..."` in its extraction note) is used, but only when it prints
 * the price; Knox cuts that line at 180 characters, and 940 stored lines on Oct 16 ended before
 * the price. Pure: the caller loads the row and its own document's text.
 */

export type EvidenceBasis = "traced" | "stored_line";

export interface FeeEvidence {
  /** The schedule's own line, whitespace and dot leaders tidied, cut around the price when long. */
  line: string;
  /** The account the line sits under, when the schedule prints one in the fee's block. */
  heading: string | null;
  /**
   * The waiver or condition the schedule prints with the price, quoted verbatim from the fee's own
   * line or the line just below it ("if the average daily balance drops below $300.00 during the
   * statement cycle"). Null when neither line states one by itself.
   */
  condition?: string | null;
  /** "traced": the shared source check's row. "stored_line": the line Knox read, re-checked here for the price. */
  basis: EvidenceBasis;
}

export interface EvidenceFee {
  fee_name: string | null;
  amount: number | string | null;
  fee_category: string | null;
  /** Knox's audit note (`raw_fee_observations.extraction_note`), holding `excerpt="..."`. */
  extraction_note?: string | null;
  /** Rows whose note has not moved yet keep it in `conditions`. */
  conditions?: string | null;
}

/** Longest line a reader is shown; a longer one is cut around its price. */
export const EVIDENCE_MAX_CHARS = 280;
const BEFORE_PRICE_CHARS = 200;
/** Lines a heading search looks up before giving up. */
const HEADING_LOOKBACK = 10;
const FREE_WORDS = /\b(?:free|no charge|no fee|n\/c|waived|none|no cost|not charged)\b/i;
/**
 * A waiver with its condition is not a $0 price: "Classic Checking | Service fee waived if either of
 * the following:" (Addition Financial FCU, catalog 24201) prices nothing; its $0 row is the Free
 * Checking line "Monthly Service Fee | $0". The shared check reads "waived" as free, so the $0 test
 * here drops the conditional waiver first.
 */
const CONDITIONAL_WAIVER = /\bwaived?\s+(?:if|when|with|for|by|upon|unless|after|once)\b.*$/i;
/** A line that prints another fee's price: the heading search stops there. */
const PRICED_FEE_LINE = /\b(?:fee|charge)s?\b[^$]*\$\s?\.?\d|\$\s?\.?\d[^.]*\b(?:fee|charge)s?\b/i;
const DOT_LEADER = /(?:\s?\.){3,}|…+/g;

/** The line Knox stored with the fee (`excerpt="..."` closing its note), if any. */
export function storedLineOf(fee: Pick<EvidenceFee, "extraction_note" | "conditions">): string | null {
  const note = fee.extraction_note ?? fee.conditions ?? null;
  const match = note?.match(/\bexcerpt="([\s\S]*)"\s*$/);
  return match ? match[1] : null;
}

/** Figures as a schedule prints them, read as numbers: "$29. 95", "$ 025 00", "$.25", "$1 ,000.00". */
function figures(line: string): number[] {
  const text = line
    .replace(DOT_LEADER, " ")
    .replace(/(\d)\s?,\s?(?=\d{3}\b)/g, "$1")
    .replace(/(\$\s*\d+)\.\s(\d{2})\b/g, "$1.$2")
    .replace(/\$\s*0*(\d+)\s(\d{2})\b(?![.\d])/g, "$$$1.$2");
  return Array.from(text.matchAll(/(?<![\d.])(\d+(?:\.\d+)?|\.\d+)/g), (match) => Number(match[1]));
}

/** Does this line print the fee's amount (a $0 fee: a zero or a word for free)? */
export function printsAmount(line: string, amount: number): boolean {
  if (!Number.isFinite(amount)) return false;
  if (amount === 0) {
    const unconditional = line.replace(CONDITIONAL_WAIVER, "");
    return FREE_WORDS.test(unconditional) || figures(unconditional).some((value) => value === 0);
  }
  return figures(line).some((value) => Math.abs(value - amount) < 0.005);
}

function tidy(line: string): string {
  return line.replace(DOT_LEADER, " … ").replace(/\s+/g, " ").replace(/(?:\s…)+/g, " …").trim();
}

/** Longest gap between the fee's own name and its price for the name to open the line. */
const NAME_TO_PRICE_CHARS = 80;
/**
 * Where a clause ends inside a flattened paragraph: a sentence stop, a semicolon or a table bar, or
 * a price with its lower-case unit ("$100 per levy order", "$35 each").
 */
const CLAUSE_END = /[.;|](?=\s)|\|\s*|\$\s?\d[\d,]*(?:\.\d+)?(?:\s+(?:each|per\s+(?:levy\s+)?[a-z]+|an?\s+[a-z]+))?/g;
/** Another fee priced the way a schedule prints one: "Levy Fee $100", "Stop Payment | $30". */
const PRICED_FEE = /\b(?:fee|charge)s?\s*[:|–-]?\s*\$\s?\.?\d|\|\s*\$\s?\.?\d/i;
/** Words of a waiver or condition, which belong to the fee that follows and are never cut. */
const CONDITION_WORDS = /\b(?:waive[ds]?|avoid|minimum|balance|unless|if|when|with|no\s+(?:fee|charge)|free)\b/i;
/** A clause that opens with "Fee"/"Charge" and runs this many words is a fee's description. */
const DESCRIPTION_WORDS = 4;
/** Capitalised words right before the name: its account or direction ("Student Checking"). */
const CAPITALISED_RUN = /(?:\b[A-Z][\w&'-]*\s+)+$/;

/** Words naming an account or a customer group, which scope the fees after them. */
const ACCOUNT_WORDS = /\b(?:checking|savings|accounts?|business|personal|consumer|students?|club|money\s+market|certificates?|cds?|iras?|members?|customers?|only)\b/i;

/**
 * Every sentence a cut would drop is another fee, priced the way a schedule prints one, with no
 * condition of this fee, no heading (a colon) and no account or customer group that could scope
 * the fee after it ("Basic Checking. Overdraft Fee $35 …" keeps the line whole).
 */
function anotherFeesClause(dropped: string): boolean {
  if (dropped.includes(":")) return false;
  const pieces = dropped.replace(/[\s.;|]+$/, "").split(/[.;](?=\s)/).map((piece) => piece.trim()).filter(Boolean);
  return pieces.length > 0 && pieces.every((piece) => PRICED_FEE.test(piece) && !CONDITION_WORDS.test(piece) && !ACCOUNT_WORDS.test(piece));
}

/**
 * A line that opens with another fee's words starts at this fee's own clause (#1902): a schedule
 * stored as one paragraph gave 1st Source Bank's dormant fee the line "Fee applied to process a
 * tax liability Dormant Account Fee $5 per month", the levy fee's description first. It reads
 * "… Dormant Account Fee $5 per month". It errs toward the whole line: a cut that drops this fee's
 * account or condition misleads more than another fee's words left in front.
 *
 * Nothing is cut unless the fee's own name prints its price within NAME_TO_PRICE_CHARS, the opening
 * neither prints this price nor ends on a price (catalog 30013's "$2.00 paper statement charge,
 * $5.00 early withdraw penalty"), and it holds no condition word. Then one of two cuts:
 * - after the last clause end, when every sentence before it is another priced fee
 *   (`anotherFeesClause`) and only capitalised words (an account or direction, kept) sit between
 *   it and the name: "… Basic Checking Monthly Service Fee $10";
 * - with no clause end, inside a clause that opens with "Fee" or "Charge" and runs past
 *   DESCRIPTION_WORDS words (another fee's description), at the capitalised words right before the
 *   name, else at the name.
 */
export function fromOwnName(line: string, feeName: string | null, amount: number): string {
  const name = (feeName ?? "").replace(/\s+/g, " ").trim();
  if (name.length < 8) return line;
  const found = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").exec(line);
  const at = found?.index ?? -1;
  if (at <= 0) return line;
  const opening = line.slice(0, at);
  if (!printsAmount(line.slice(at + name.length, at + name.length + NAME_TO_PRICE_CHARS), amount)) return line;
  if (printsAmount(opening, amount) || /\$\s?\d[\d,]*(?:\.\d+)?\s*$/.test(opening)) return line;
  let end = 0;
  for (const match of opening.matchAll(CLAUSE_END)) end = (match.index ?? 0) + match[0].length;
  const clause = opening.slice(end).replace(/^[.;,|]+/, "");
  const run = CAPITALISED_RUN.exec(clause)?.[0] ?? "";
  let cut = 0;
  if (end === 0) {
    const words = clause.trim().split(/\s+/).filter(Boolean);
    if (words.length > DESCRIPTION_WORDS && /^(?:fees?|charges?)$/i.test(words[0]) && !CONDITION_WORDS.test(clause)) cut = at - run.length;
  } else if (anotherFeesClause(opening.slice(0, end)) && clause.trim().length === run.trim().length) {
    cut = end;
  }
  if (cut <= 0) return line;
  return `… ${line.slice(cut).replace(/^[\s.;,|]+/, "")}`;
}

/** A long line cut to the part around its price, so the reader sees the price and what precedes it. */
function aroundPrice(line: string, amount: number): string {
  if (line.length <= EVIDENCE_MAX_CHARS) return line;
  const whole = Number.isInteger(amount) ? String(amount) : amount.toFixed(2).replace(/^0/, "");
  const at = line.search(new RegExp(`(?<![\\d])0*${whole.replace(".", "\\.?\\s?")}`));
  const end = at < 0 ? EVIDENCE_MAX_CHARS : Math.min(line.length, at + (EVIDENCE_MAX_CHARS - BEFORE_PRICE_CHARS));
  const start = Math.max(0, end - EVIDENCE_MAX_CHARS);
  return `${start > 0 ? "… " : ""}${line.slice(start, end).trim()}${end < line.length ? " …" : ""}`;
}

const ACCOUNT_KIND = /\b(?:checking|savings|money\s+market|share\s+draft|certificate|club|ira|cd|now\s+account)\b/i;
const ACCOUNT_KINDS = new RegExp(ACCOUNT_KIND.source, "gi");
/** "Diamond Secure Account": a name ending in "Account" names one account when its own words do. */
const NAMED_ACCOUNT = /^[A-Z0-9].*\sAccount$/;
/** What may follow the kind word in a name ("Money Market Plus", "Classic Checking Account"). */
const NAME_TAIL = /^(?:\s+(?:account|plus|\+|club|program|package))*$/i;
/** Words that make a line a section, a sentence, a fee or page furniture rather than one account's name. */
const NOT_ONE_ACCOUNT =
  /\b(?:accounts|compare|comparison|our|your|all|open(?:ing)?|learn|apply|get|started|about|includes?|features?|use|rates?|fees?|charges?|schedule|disclosures?|information|details?|requirements?|overview|why|how|what|which|choose|find|best|see|view|other|options?|products?|types?|minimum|balance|deposits?|statements?|waived?|avoid|transactions?|withdrawals?|services?|tips|faqs?|questions?|terms|conditions|agreement|truth|calculator|apy|annual|you|we|this|that|these|those|is|are|with|without|to|in|on|by|if|when|per|or|vs|has|have|earn|more|less|than|available|effective|page|continued|login|log|dormant|inactive|closing|closed|specific|custodial|joint|linked|primary|new|current|eligible|existing|individual|trust|estate|transfers?|maintenance|block|debit|credit|loan|online|mobile|digital|everyone|customers?|members?|bearing)\b/i;
/** Words that say only whose kind of account it is: "Personal Checking" heads a group, not one account. */
const GROUP_WORDS = new Set(["personal", "consumer", "a", "an", "the", "and", "for", "of"]);
const ANY_PRICE = /\$\s?\.?\d/;
/** A list or several accounts stated as one heading: never one account's name. */
const MANY = Symbol("many");
type HeadingRead = string | typeof MANY | null;

function capitalized(text: string): string {
  return text === text.toUpperCase() && /[A-Z]{4}/.test(text)
    ? text.replace(/\b([A-Z])([A-Z]{3,})\b/g, (_, head: string, tail: string) => head + tail.toLowerCase())
    : text;
}

/**
 * The shared reader writes long all-caps words in title case ("TVFCU" -> "Tvfcu"). In a name that
 * is not all caps, an all-caps word of two to five letters is an acronym and keeps its capitals.
 */
function keepAcronyms(original: string, tidied: string): string {
  if (original === original.toUpperCase()) return tidied;
  const acronyms = new Set(original.match(/\b[A-Z]{2,5}\b/g) ?? []);
  return tidied.replace(/\b[A-Za-z]{2,5}\b/g, (word) => (acronyms.has(word.toUpperCase()) && word !== word.toUpperCase() ? word.toUpperCase() : word));
}

/** The account kinds a name states, a club inside a checking name ("Premier Club Checking") not counted. */
function kindsIn(text: string): string[] {
  const kinds = (text.match(ACCOUNT_KINDS) ?? []).map((kind) => kind.toLowerCase().replace(/\s+/g, " "));
  return kinds.length > 1 ? kinds.filter((kind) => kind !== "club" && kind !== "share draft") : kinds;
}

/**
 * The one account a short title-like cell names ("Benefits Checking", "## Kasasa Cash Back
 * Checking", "Diamond Secure Account"), MANY when it names more than one ("Free Checking, Student
 * Checking"), else null. The kind word ends the name ("Free Checking Made Simple" is a tagline), a
 * name says more than whose account it is ("Personal Checking" heads a group), and a sentence,
 * a plural, a fee, page furniture or a line with a price is no name. The shared reader
 * (`accountHeading`) only tidies the name ("Chase Total CheckingSM 6" -> "Chase Total Checking").
 */
function oneAccountName(cell: string): HeadingRead {
  let text = cell
    .replace(/[*_`]+/g, " ")
    .replace(/^[#•\-–>\s]+/, "")
    .replace(/(?<=[a-z])(?:SM|TM)\b/g, "")
    .replace(/[®™℠†‡]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*[:\-–]\s*$/, "")
    .replace(/^(?:key\s+)?(?:features|benefits|details)\s+of\s+(?:an?\s+|the\s+|our\s+)?/i, "")
    .replace(/\s+(?:overview|at a glance)$/i, "")
    .replace(/(?<=[a-z])\d{1,2}$|\s+\d{1,2}$/, "")
    .replace(/\s+(?:account\s+)?(?:fees?\s+(?:and|&)\s+charges?|fees?|charges?|fee schedule)\s*$/i, "")
    .trim();
  if (!text || ANY_PRICE.test(text) || text.length > 60) return null;
  const kinds = kindsIn(text);
  if (kinds.length > 1) return MANY;
  if (/,|\s&\s|\band\b|\bor\b|\//i.test(text)) return null;
  text = keepAcronyms(text, accountHeading(text) ?? text);
  if (/^NOW Account$/i.test(text)) return "NOW Account";
  const kind = [...text.matchAll(ACCOUNT_KINDS)].pop();
  if (kind) {
    // The kind word, capitalized as a title prints it, ends the name: "Checking for everyone" and
    // "Simple straightforward checking account" are sentences.
    const at = kind.index ?? 0;
    if (at === 0 || !/^[A-Z]/.test(kind[0]) || !NAME_TAIL.test(text.slice(at + kind[0].length))) return null;
  } else if (!NAMED_ACCOUNT.test(text)) return null;
  if (/[.!?;:()"]/.test(text) || /\d{3,}/.test(text) || !/^[A-Z0-9]/.test(text) || /^(?:the|a|an)\s/i.test(text) || text.split(" ").length > 6) return null;
  if (NOT_ONE_ACCOUNT.test(text)) return null;
  const own = text
    .replace(ACCOUNT_KINDS, " ")
    .replace(/\baccount\b/gi, " ")
    .toLowerCase()
    .split(/[^a-z0-9+']+/)
    .filter((word) => word && !GROUP_WORDS.has(word));
  return own.length > 0 ? capitalized(text) : null;
}

/** The account a schedule line heads, MANY for a line naming several, null for any other line. */
function accountNameIn(row: string): HeadingRead {
  if (ANY_PRICE.test(row)) return null;
  const parts = row.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split(CELL_SPLIT).map((cell) => cell.trim()).filter((cell) => cell.length > 0);
  if (parts.length === 0) return null;
  if (parts.length === 1) return oneAccountName(parts[0]);
  // "Benefits Checking | Service fee waived if either of the following:": a heading cell opens the
  // row. A row naming accounts in several cells is a column header, which names no one account.
  // "Classic Free Checking Account | No monthly maintenance fees.": that account's own fee row.
  if (parts.slice(1).some((part) => NO_MONTHLY_FEE.test(part))) return MANY;
  // "Truist Marquee Checking | Truist Asset Management Account (AMA)": two columns' headings.
  if (parts.slice(1).some(titleNamingAccount)) return MANY;
  const names = parts.map(oneAccountName);
  if (names.some((name, index) => name !== null && (index > 0 || name === MANY))) return names.some((name) => name !== null) ? MANY : null;
  return names[0];
}

/** Lines, whitespace tidied, as the heading and condition readers walk them. */
function textLines(text: string): string[] {
  return text.split(/\r?\n/).map((row) => row.replace(/\s+/g, " ").trim());
}

/**
 * Every line of the text that holds `line`: the line itself, a line holding it whole, or (for a
 * row joined from lines printed one under another, "Maintenance Fee" over "$2.50 monthly") the
 * line holding its first cell with its other cells on the next lines.
 */
function linesHolding(lines: string[], line: string, amount: number | null): number[] {
  const whole = line.replace(/\s+/g, " ").trim();
  const exact = lines.flatMap((row, index) => (row === whole ? [index] : []));
  if (exact.length > 0) return exact;
  if (whole.length >= 12) {
    const holding = lines.flatMap((row, index) => (row.includes(whole) ? [index] : []));
    if (holding.length > 0) return holding;
  }
  const parts = cells(whole);
  const first = (parts[0] ?? "").slice(0, 60);
  if (first.length < 8) return [];
  return lines.flatMap((row, index) => {
    if (!row.includes(first)) return [];
    const block = [row];
    for (let next = index + 1; next < lines.length && block.length < 4; next += 1) if (lines[next]) block.push(lines[next]);
    const joined = block.join(" | ");
    const rest = parts.slice(1);
    const holds = rest.length > 0 ? rest.every((part) => joined.includes(part)) : true;
    return holds && (amount == null || printsAmount(rest.length > 0 ? joined : row, amount)) ? [index] : [];
  });
}

/** The account heading over line `index`: the nearest account name above it in its block. */
function headingOver(lines: string[], index: number, amount: number | null): string | null {
  const column = amount == null ? undefined : columnOf(lines, index, amount);
  if (column !== undefined) return column;
  // "Classic Checking Account | $3 Maintenance fee per monthly statement cycle.": the row names it.
  const own = cells(lines[index]);
  const named = own.length >= 2 && amount != null && printsAmount(own[1], amount) ? oneAccountName(own[0]) : null;
  if (named === MANY) return null;
  if (named) return named;
  // A price in a later column ("requirement and no monthly service charge. | ... monthly fee of
  // $10.00"): the headings opening the rows above are the first column's, not this fee's.
  if (own.length >= 2 && amount != null) {
    const at = own.findIndex((cell) => printsAmount(cell, amount));
    if (at > 1 || (at === 1 && !/^[A-Z0-9•*(]/.test(own[0])) || (at === 1 && /[.;]$/.test(own[0]))) return null;
  }
  let looked = 0;
  for (let i = index - 1; i >= 0 && looked < HEADING_LOOKBACK; i -= 1) {
    const row = lines[i];
    if (!row) continue;
    looked += 1;
    const name = accountNameIn(row);
    if (name === MANY) return null;
    if (name) return featureLine(lines, i) ? null : name;
    if (endsBlock(row, amount)) return null;
  }
  return null;
}

/**
 * A name printed as one item of a feature list repeated under several accounts: "Unlimited
 * Checking" follows "Free Mobile Banking" under both "Totally Free Checking" and "Traditional
 * Checking". The name and the feature line before it are printed together under two accounts.
 */
function featureLine(lines: string[], index: number): boolean {
  const before = (at: number): string | null => {
    for (let i = at - 1; i >= 0; i -= 1) if (lines[i]) return lines[i];
    return null;
  };
  const feature = before(index);
  if (!feature || accountNameIn(feature) !== null || ANY_PRICE.test(feature) || /^(?:learn|open|apply|view|see|get|start|enroll)\b/i.test(feature)) return false;
  // Printed under two different accounts, not one block printed twice.
  const blocks = new Set<string>();
  for (let at = 0; at < lines.length; at += 1) {
    if (lines[at] !== lines[index] || before(at) !== feature) continue;
    let looked = 0;
    for (let i = at - 1; i >= 0 && looked < HEADING_LOOKBACK; i -= 1) {
      if (!lines[i]) continue;
      looked += 1;
      const name = accountNameIn(lines[i]);
      if (name === MANY) break;
      if (name) {
        blocks.add(name);
        break;
      }
    }
  }
  return blocks.size >= 2;
}

/** A short title naming an account kind ("PERSONAL SAVINGS", "More About Gold Owl Checking"), named or not. */
function titleNamingAccount(row: string): boolean {
  if (ANY_PRICE.test(row) || /[.!?:]$/.test(row)) return false;
  const text = row.replace(/[*_`]+/g, " ").replace(/^[#•\-–>\s]+/, "").replace(/\s+/g, " ").trim();
  if (text.split(" ").length > 6 || !/^[A-Z0-9"“]/.test(text)) return false;
  // A button ("Open This Account", "Apply Now") ends nothing.
  if (/^(?:open|apply|enroll|start)\b/i.test(text) && text.split(" ").length <= 4) return false;
  return /\b(?:Checking|CHECKING|Savings|SAVINGS|Money Market|MONEY MARKET|Share Draft|SHARE DRAFT|Club|CLUB|Certificate|CERTIFICATE|IRA|CD)\b|\s(?:Account|ACCOUNT)$/.test(text);
}

/**
 * For a line printing several accounts' prices in columns ("Monthly Fee | $5.00 ... | No monthly
 * maintenance fee | $25.00 ..."), the account its price's column names in the header row above
 * ("Swipe Left to Right | Connect Five Account | Classic Five Checking | Club Five Checking"), as
 * `ownPart` names a comparison row's column; null when the column can't be named; undefined for a
 * line that prints one price.
 */
function columnOf(lines: string[], index: number, amount: number): string | null | undefined {
  const row = cells(lines[index]);
  // "No monthly maintenance fee" in an account's column is that account's price, $0.
  const prices = row.map((cell) => cellPrice(cell) ?? (NO_MONTHLY_FEE.test(cell) ? 0 : null));
  if (prices.filter((price) => price !== null).length < 2 || prices[0] !== null) return undefined;
  // "Monthly Maintenance Fee | $25.00 | Minimum to Open | $10.00": label and price pairs, no columns.
  if (row.length % 2 === 0 && prices.every((price, column) => (column % 2 === 1) === (price !== null))) return undefined;
  const at = prices.flatMap((price, column) => (column > 0 && price !== null && Math.abs(price - amount) < 0.005 ? [column] : []));
  if (at.length !== 1) return null;
  const tidied = lines.map((line) => line.replace(/(?<=[a-z])(?:SM|TM)\b/g, ""));
  // The header cell is the name when it is a name alone ("Club Five Checking"); else its opening
  // words up to the account word ("Business Checking for Ag Our interest-earning account ...").
  const cell = headerCell(tidied, index, row.length, at[0]);
  const whole = cell == null ? null : oneAccountName(cell);
  return typeof whole === "string" ? whole : namesOneAccount(columnHeader(tidied, index, row.length, at[0]));
}

/** A column's name when it says more than the kind of account ("Checking" alone names none). */
function namesOneAccount(name: string | null): string | null {
  if (!name) return null;
  const own = name
    .replace(ACCOUNT_KINDS, " ")
    .replace(/\baccount\b/gi, " ")
    .toLowerCase()
    .split(/[^a-z0-9+']+/)
    .filter((word) => word && !GROUP_WORDS.has(word));
  return own.length > 0 ? name : null;
}

const NO_MONTHLY_FEE = /\bno\s+(?:monthly\s+)?(?:maintenance|service)\s+(?:fee|charge)|\bno\s+monthly\s+(?:fee|charge)/i;
const MONTHLY_FEE_WORDS = /\b(?:monthly|maintenance|service)\s+(?:fee|charge)s?\b/i;

/**
 * A line the heading search never climbs past: one that heads an account the reader can't name
 * ("PERSONAL SAVINGS" heads a group; "More About Gold Owl Checking"), one that prints another
 * fee's price, or one stating another account's monthly fee ("No monthly maintenance fee" above
 * a $6.95 one). A line stating this fee's own waiver ("$500 Min. Daily Balance to Avoid Fee") is
 * part of its block.
 */
function endsBlock(row: string, amount: number | null): boolean {
  if (titleNamingAccount(row)) return true;
  if (MONTHLY_FEE_WORDS.test(row) && (ANY_PRICE.test(row) || (amount != null && amount > 0 && NO_MONTHLY_FEE.test(row)))) return true;
  return PRICED_FEE_LINE.test(row) && !READS_AS_WAIVER.test(row);
}

/** One answer from every place the line is printed, or null when they differ or none answers. */
function agreed(values: Array<string | null>): string | null {
  if (values.length === 0 || values.some((value) => value === null)) return null;
  return values.every((value) => value === values[0]) ? values[0] : null;
}

/**
 * The account heading above the schedule line that holds `line` ("NOW Checking" over its
 * "Account Fees: ..." line; "Classic Checking | Service fee waived if either of the following:"
 * over "Checking Monthly Service Fee | $5.00"): the nearest line above it, within ten lines,
 * that names one checking, savings, money market, club or certificate account. The search stops
 * at a line that prints another fee's price (the block above is another account's) and at a line
 * naming several accounts ("Free Checking, Student Checking"), which is no one account's heading.
 * A row printing several accounts' prices takes its price's column from the header row above it
 * (#1663's account-comparison reader); a row whose own first cell names the account takes that
 * ("Epic Premium Checking | $10.00/Month"). A line printed in several places gives a heading only
 * when every place gives the same one. Never a guess: when it isn't clear, null.
 */
export function headingAbove(text: string, line: string, amount: number | null = null): string | null {
  const lines = textLines(text);
  return agreed(linesHolding(lines, line, amount).map((index) => headingOver(lines, index, amount)));
}

/** A waiver or condition, in the words schedules use. */
const READS_AS_WAIVER =
  /\b(?:waived?|waives|avoid(?:ed)?|unless|exempt)\b|\b(?:if|when)\b[^|]{0,80}\b(?:balance|deposits?|e-?statements?|statement cycle|transactions?|purchases?|age|under|enroll(?:ed)?|below|falls?|drops?|less than)\b|\bdirect deposits?\b|\b(?:minimum|average|daily|combined)\b[^.|]{0,40}\bbalances?\b/i;
/** Where a condition clause starts. */
const CONDITION_START = /\b(?:waived?|avoid(?:ed)?|unless|exempt|if|when)\b/i;
/** A condition says what triggers or lifts the fee: a figure, a balance test, a deposit, statements, activity or age. */
const CONDITION_PREDICATE =
  /\$\s?\d|\b(?:falls?|drops?|below|under|over|above|less than|more than|between|maintain(?:ed|s)?|not met|is not|direct deposits?|enroll(?:ed)?|e-?statements?|paperless|years? old|age \d+|\d+ or older|receives?|posted|transactions?|purchases?)\b/i;
/** A waiver stated without "if" or "when": the line must say so. */
const WAIVER_WORD = /\b(?:waived?|waives|avoid(?:ed)?|unless|exempt)\b/i;
/** A list's opening ("waived with one of the following:"): its items are alternatives, none the condition alone. */
const LIST_INTRO = /\b(?:following|any one|any of|either|one of)\b/i;
/** A clause that stops mid-phrase ("Maintain an average daily balance of $1500 or"). */
const DANGLING = /\b(?:or|and|a|an|the|of|to|is|be|by|with|for|there is a|there will be a)$/i;
const CONDITION_MAX_CHARS = 200;

function tidyCondition(text: string): string | null {
  const clean = text
    .replace(/\[\d+\]\([^)]*\)?/g, "")
    .replace(DOT_LEADER, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s•*(\-–]+/, "")
    .replace(/[\s*,;:)\-–]+$/, "")
    .replace(/(?<=[a-z])\d$/, "")
    .replace(/\.$/, "")
    .trim();
  if (clean.length < 8 || clean.length > CONDITION_MAX_CHARS || LIST_INTRO.test(clean) || DANGLING.test(clean)) return null;
  return READS_AS_WAIVER.test(clean) && CONDITION_PREDICATE.test(clean) ? clean : null;
}

/** The clause of one cell or sentence that states the fee's condition, verbatim, or null. */
function conditionClause(segment: string, amount: number): string | null {
  // "($1,000 minimum balance to avoid monthly service charge)".
  const paren = segment.match(/\(([^()]{8,})\)/);
  if (paren && READS_AS_WAIVER.test(paren[1])) return tidyCondition(paren[1]);
  const start = segment.search(CONDITION_START);
  if (start < 0) return !printsAmount(segment, amount) && WAIVER_WORD.test(segment) ? tidyCondition(segment) : null;
  // "(waived with $5,000.00 average": a parenthesis the line never closes was cut mid-clause.
  if ((segment.slice(0, start).match(/\(/g) ?? []).length > (segment.match(/\)/g) ?? []).length) return null;
  let clause = segment.slice(start);
  // "if the average daily balance drops below $300.00 during the statement cycle is $5.95": the
  // clause ends before the fee's own price, and before the fee's own name ahead of it ("If the
  // account falls below the balance requirements, the monthly maintenance fee is $5.00").
  if (amount > 0 && printsAmount(clause, amount)) {
    const whole = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
    const at = clause.search(new RegExp(String.raw`[\s,]*(?:is|of|will be|=|:|[-–])?\s*\$\s?0*${whole.replace(".", String.raw`\.`)}(?:\.00)?(?!\d|,\d)`, "i"));
    if (at > 0) clause = clause.slice(0, at).replace(/,?\s+(?:(?:there\s+(?:is|will be)\s+)?(?:a|an|the)\s+)?[^,]*\b(?:fee|charge)s?\s*(?:of|is|will be)?$/i, "");
  }
  // "... on any day of the cycle Paid item fee: For each overdraft paid -$30": the clause ends
  // where another fee's label or price starts.
  const next = clause.search(OTHER_FEE_START);
  if (next > 0) clause = clause.slice(0, next);
  if (PRICED_FEE_LINE.test(clause) && !WAIVER_WORD.test(clause)) return null;
  return tidyCondition(clause);
}

/** Where another fee starts inside a run-on line: its label ("Paid item fee:") or its price ("$30 returned item fee"). */
const OTHER_FEE_START = /\s+[A-Z][\w ]{0,40}\b(?:[Ff]ee|[Cc]harge)s?\b\s*[:\-–]|\s+\$\s?\d[\d,.]*\s+(?:(?![Aa]void|[Ww]aive|to\b)[\w-]+\s+){0,3}(?:[Ff]ee|[Cc]harge)s?\b/;

/** Opens a line that only states the condition of the price above it ("Waived with $500 minimum balance"). */
const CONDITION_LINE = /^\(?\s*(?:waived?|avoid(?:ed)?|unless|if|when|no (?:monthly )?(?:service |maintenance )?(?:fee|charge)s? (?:if|when|with))\b/i;

/**
 * The waiver or condition printed with the price: a clause of the fee's own line ("if the
 * average daily balance drops below $300.00 during the statement cycle"), or the next line when
 * that line is the condition alone ("Waived with $1,500 minimum daily balance"). Quoted, never
 * reworded; null when neither line states one by itself. A list item ("• There is a $2,000
 * direct deposit monthly") or a list's opening ("waived with one of the following:") is no
 * condition by itself, and a clause beside another fee's price ("The fee is $4.95 if receiving
 * E-Statements") is that price's.
 */
function conditionFor(raw: string, amount: number, next: string | null, whole: string = raw): string | null {
  if (LIST_INTRO.test(raw)) return null;
  const found = conditionOnLine(raw, amount, next);
  // "unless you receive one ACH ... and receive an e-Statement; or have 25 debit card ...": the
  // waiver goes on with alternatives in the source, so the quoted part alone is not the condition.
  if (found && hasAlternatives(found, whole, next)) return null;
  return found;
}

function hasAlternatives(condition: string, whole: string, next: string | null): boolean {
  const tidied = whole.replace(/\s+/g, " ");
  const at = tidied.indexOf(condition);
  if (at < 0) return false;
  const after = tidied.slice(at + condition.length);
  return /^\W{0,3}(?:;|,)?\s*or\b/i.test(after) || (/^[\s.;,]*$/.test(after) && /[;,]\s*$/.test(tidied) && next != null && /^\s*or\b/i.test(next));
}

function conditionOnLine(raw: string, amount: number, next: string | null): string | null {
  const segments = raw
    .split(CELL_SPLIT)
    .flatMap((cell) => cell.split(/(?<=[.;])\s+(?=[A-Z($\d*])/))
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && !segment.startsWith("•"));
  for (const segment of segments) {
    if (!printsAmount(segment, amount) && PRICED_FEE_LINE.test(segment) && !WAIVER_WORD.test(segment)) continue;
    const clause = conditionClause(segment, amount);
    if (clause) return clause;
  }
  if (
    next &&
    CONDITION_LINE.test(next) &&
    !LIST_INTRO.test(next) &&
    !(PRICED_FEE_LINE.test(next) && !WAIVER_WORD.test(next)) &&
    accountNameIn(next) === null &&
    cells(next).length === 1
  )
    return tidyCondition(next);
  return null;
}

/** The condition from every place the line is printed, when they agree. */
function conditionIn(text: string | null | undefined, raw: string, own: string, amount: number): string | null {
  if (!text) return conditionFor(own, amount, null);
  const lines = textLines(text);
  const at = linesHolding(lines, raw, amount);
  if (at.length === 0) return conditionFor(own, amount, null);
  return agreed(
    at.map((index) => {
      let next = index + 1;
      while (next < lines.length && !lines[next]) next += 1;
      return conditionFor(own, amount, next < lines.length ? lines[next] : null, lines[index]);
    }),
  );
}

/** The one schedule line that holds the fee's name and prints its price, or null (none, or several). */
function namedPriceLine(text: string, feeName: string, amount: number): string | null {
  const name = feeName.replace(/\s+/g, " ").trim().toLowerCase();
  if (name.length < 4) return null;
  const found = [...new Set(sourceLines(text).filter((line) => line.toLowerCase().includes(name) && printsAmount(line, amount)))];
  return found.length === 1 ? found[0] : null;
}

const CELL_SPLIT = /\s*\|\s*/;
const CELL_PRICE = /\$\s*(\d[\d,]*(?:\.\d{1,2})?)|(?<![\d.])\$?\.(\d{2})\b|\b(free|no charge|no fee|none|n\/c)\b/i;
const NAME_WORD = /[a-z][a-z'&+]{2,}/g;
const NOT_NAME_WORDS = new Set(["fee", "fees", "charge", "charges", "per", "the", "and", "for", "each", "item", "items", "with", "only", "monthly", "month"]);
/** Header rows a column search looks up before giving up. */
const HEADER_LOOKBACK = 12;
/** An account column's name: its words up to the account word, plus a "for Ag"-style tail. */
const COLUMN_NAME = /^\s*((?:[A-Z0-9][\w&'’®+-]*\s+){0,5}?(?:checking|savings|money market|share draft|account|club|certificate|ira|cd)\b(?:\s+(?:checking|savings|account)\b)?(?:\s+for\s+[A-Z][\w&]*)?)/i;

function cells(line: string): string[] {
  return line.split(CELL_SPLIT).map((cell) => cell.trim()).filter((cell) => cell.length > 0);
}

/** A cell's price: the first figure it prints after "$", or 0 for a word for free; null for none. */
function cellPrice(cell: string): number | null {
  const match = cell.match(CELL_PRICE);
  if (!match) return null;
  if (match[3]) return 0;
  if (match[2]) return Number(match[2]) / 100;
  return Number(match[1].replace(/,/g, ""));
}

function nameWords(text: string): Set<string> {
  const words = text.toLowerCase().replace(/[‘’ʼ`]/g, "'").match(NAME_WORD) ?? [];
  return new Set(words.map((word) => word.replace(/'s?$/, "")).filter((word) => !NOT_NAME_WORDS.has(word)));
}

/** The index of the text line that is `line` (or, failing that, the one line holding its start). */
function lineIndex(lines: string[], line: string): number | null {
  const whole = line.replace(/\s+/g, " ").trim();
  const exact = lines.flatMap((row, index) => (row === whole ? [index] : []));
  if (exact.length === 1) return exact[0];
  const needle = whole.slice(0, 80);
  const holding = lines.flatMap((row, index) => (needle.length >= 8 && row.includes(needle) ? [index] : []));
  return holding.length === 1 ? holding[0] : null;
}

/**
 * The account an account-comparison column names, from the header row above a row of `width`
 * cells: a price-less row of the same width, or one cell narrower when the row opens with its
 * label ("Business Checking for Ag ... | Freebird Business Checking for Ag ... | ..." over
 * "Monthly Service Charge | $10 ... | $0 | $10 ... | $20"). Null when no header row is found or the
 * column's cell names no account.
 */
function columnHeader(lines: string[], rowIndex: number, width: number, column: number): string | null {
  const cell = headerCell(lines, rowIndex, width, column);
  const name = cell?.match(COLUMN_NAME)?.[1]?.trim();
  return name ? name.replace(/[®™℠*]/g, "").trim() : null;
}

/** The header row's cell over a column of a row of `width` cells, or null when no header row is found. */
function headerCell(lines: string[], rowIndex: number, width: number, column: number): string | null {
  let looked = 0;
  for (let i = rowIndex - 1; i >= 0 && looked < HEADER_LOOKBACK; i -= 1) {
    const row = lines[i];
    if (!row) continue;
    looked += 1;
    const header = cells(row);
    if (header.length < 2 || header.some((cell) => cellPrice(cell) !== null)) continue;
    const cell = header.length === width ? header[column] : header.length === width - 1 ? header[column - 1] : null;
    if (cell == null) continue;
    return cell;
  }
  return null;
}

/**
 * The fee's own part of a schedule line. A one-price line is kept, its fee's own cells only
 * (`ownCells`, #1394), less any leading price-less cell that shares no word with the fee's name
 * ("Non-customer | AB&T Bill Pay +PLUS | $10.00 ...": "Non-customer" is the next column's).
 * A row printing several prices must be cut to the fee's own price cell: by `ownCells`, or as an
 * account-comparison row, its label plus the one cell at the fee's price, under the column's
 * header ("Commercial Checking for Ag"). A row that can't be cut is null: a row whose first price
 * is another account's is never shown as this fee's evidence (Bank Iowa 141041's $20, Oct 16).
 */
function ownPart(
  raw: string,
  feeName: string,
  amount: number,
  text: string | null | undefined,
): { line: string; heading: string | null; condition: string | null } | null {
  const all = cells(raw);
  const own = ownCells(raw, feeName, amount);
  const isolated = own !== raw;
  const distinct = new Set(all.map(cellPrice).filter((price): price is number => price !== null).map((price) => price.toFixed(2)));
  if (all.length >= 2 && distinct.size > 1 && !isolated) {
    const at = all.flatMap((cell, index) => (index > 0 && cellPrice(cell) !== null && Math.abs((cellPrice(cell) as number) - amount) < 0.005 ? [index] : []));
    if (at.length !== 1 || !text) return null;
    const lines = text.split(/\r?\n/).map((row) => row.replace(/\s+/g, " ").trim());
    const rowIndex = lineIndex(lines, raw);
    if (rowIndex == null) return null;
    const header = columnHeader(lines, rowIndex, all.length, at[0]);
    if (!header) return null;
    const cut = `${all[0]} | ${all[at[0]]}`;
    // A header naming only the kind ("Checking") still places the column: the line stays, unnamed.
    return { line: cut, heading: namesOneAccount(header), condition: conditionFor(cut, amount, null) };
  }
  let kept = cells(own);
  if (kept.length >= 2 && kept.some((cell) => cellPrice(cell) !== null && Math.abs((cellPrice(cell) as number) - amount) < 0.005)) {
    const wanted = nameWords(feeName);
    while (kept.length > 1 && cellPrice(kept[0]) === null && ![...nameWords(kept[0])].some((word) => wanted.has(word))) kept = kept.slice(1);
  }
  const line = kept.length === cells(own).length ? own : kept.join(" | ");
  // Still several cells with the first price another fee's: not this fee's line.
  const first = cells(line).map(cellPrice).find((price) => price !== null);
  if (cells(line).length >= 2 && first != null && Math.abs(first - amount) >= 0.005) return null;
  return { line, heading: text ? headingAbove(text, raw, amount) : null, condition: conditionIn(text, raw, own, amount) };
}

/** The account a fee's own name opens with ("Simply Basic Checking Monthly service charge"), if any. */
function accountInFeeName(feeName: string | null): string | null {
  const head = (feeName ?? "").split(/\s+(?:monthly|maintenance|service|account maintenance|min(?:imum)?\s+balance|fees?|charges?)\b/i)[0];
  const name = head && head !== feeName ? oneAccountName(head) : null;
  return typeof name === "string" ? name : null;
}

function sameAccount(a: string, b: string): boolean {
  const key = (name: string) => name.toLowerCase().replace(/\baccount\b/g, "").replace(/[^a-z0-9]+/g, "");
  return key(a).includes(key(b)) || key(b).includes(key(a));
}

/** The fee's evidence from its own document's text, or null when no line shows its price. */
export function feeEvidence(fee: EvidenceFee, text: string | null | undefined): FeeEvidence | null {
  if (fee.amount == null || fee.amount === "") return null;
  const amount = Number(fee.amount);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const build = (raw: string, basis: EvidenceBasis): FeeEvidence | null => {
    const part = ownPart(raw, fee.fee_name ?? "", amount, text);
    if (!part) return null;
    // "Simply Basic Checking Monthly service charge" traced to a line under "E-Vantage Checking":
    // the fee's own name says another account, so the line's heading is not this fee's.
    const named = accountInFeeName(fee.fee_name);
    const heading = part.heading && named && !sameAccount(named, part.heading) ? null : part.heading;
    return { line: aroundPrice(fromOwnName(tidy(part.line), fee.fee_name, amount), amount), heading, condition: part.condition, basis };
  };
  if (text && fee.fee_name) {
    const traced = checkFeeAgainstSource(text, fee.fee_name, amount, ".", fee.fee_category);
    const tracedLine = traced.ok && printsAmount(traced.sourceLine, amount) ? build(traced.sourceLine, "traced") : null;
    if (tracedLine) return tracedLine;
    const banded = !traced.ok && traced.reason === "tiered_fee" ? namedPriceLine(text, fee.fee_name, amount) : null;
    const bandedLine = banded ? build(banded, "traced") : null;
    if (bandedLine) return bandedLine;
  }
  const stored = storedLineOf(fee);
  return stored && printsAmount(stored, amount) ? build(stored, "stored_line") : null;
}
