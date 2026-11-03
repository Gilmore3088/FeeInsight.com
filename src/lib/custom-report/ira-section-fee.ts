import { HEADING_BULLET, SECTION_HEADER_ROW, SECTION_ROW_PRICE, pricedNameLines, sectionWords } from "./card-program-section";
import { HEADING_SENTENCE_END, loanSectionRow } from "./loan-section-fee";

/**
 * Knox v177 (backlog dry run 8): an account closing charge printed in an IRA's own section of a fee schedule
 * is the IRA's closing fee (`ira_termination`), not a deposit account's early closure. Pure; one definition for
 * Knox (`iraSectionClosingRead` in `knox/rules.ts`, which files such a read as `ira_termination`) and Darwin's
 * live re-check (`darwin/section-misread-check.ts`).
 *
 * Mattel FCU (text 12602) prints "Individual Retirement Account (IRA) Fees | Elite" / "New Account Fee | FREE |
 * FREE | ..." / "Early Closure Fee (if <59 1/2 ) | $ 30 | FREE | ...": the $30 is the charge for closing the IRA
 * before 59 1/2, and Knox filed it early_closure by its own words. Progressions CU's "INDIVIDUAL RETIREMENT
 * ACCOUNT (IRA) FEES" / "Account Closure Fee $25.00" is live the same way (94053).
 *
 * The section is read upward from the fee's own line, as the loan section rule reads it
 * (`loan-section-fee.ts`): rows are price rows, a column header ("Service | Fee") and a cell row valued by a
 * price word ("Annual Fee | FREE"). The first other non-empty line is the heading. A heading line's first cell
 * is its title ("Individual Retirement Account (IRA) Fees | Elite", "IRA FEES | Annual Maintenance Fee |
 * $12.00/annually", "IRA Share Savings Account Fees | Wire-Outgoing International | $40.00 ea": the title opens
 * the section and the rest of the line is a label or the other column). The title must be an IRA's own
 * (`iraSectionTitle`): at most 60 characters and seven words, not bulleted, no sentence end, names an IRA or a
 * retirement account or plan, ends on a section word (fees, charges, services, account(s), IRA(s)), and lists
 * no other account ("Share Fees (Savings/Checking/IRAs)") and leaves none out ("(except IRA accounts)"). At most
 * `IRA_SECTION_REACH_LINES` non-empty lines are walked.
 *
 * The section ends (review of #2973) on a non-row line, on a row whose first cell is another section's title
 * (`opensOtherSection`: a title ending in fees, charges or services, or naming an account kind, "Checking
 * Accounts | Early Account Closure | $25.00", "Money Market | ...", "Share Certificates | ...", "Other Fees (All
 * Accounts) | Stop Payment | $25.00", followed by a label cell), and on the first general service row
 * (`GENERAL_ROW_WORDS`: a wire, copy, money order, stop payment, check, card or statement row; not the IRA's own
 * distribution, rollover, contribution or transfer-out row, nor a row naming an IRA, `IRA_OWN_ROW_WORDS`), so a closing
 * after general rows with no heading between is not the IRA's. Under a title line of two section titles ("IRA
 * FEES | CHECKING ACCOUNT FEES"), only the IRA's own column of each row is the IRA's: a row is split into its
 * name-and-price groups and only the group in the IRA's column counts; a row with another number of groups
 * counts for neither.
 *
 * Only an early_closure read is judged, and every line that prints its name at its price (at least one) must
 * sit in an IRA section.
 */
export const IRA_SECTION_REACH_LINES = 20;
export const IRA_HEADING_MAX_CHARS = 60;
export const IRA_HEADING_MAX_WORDS = 7;
export const IRA_SECTION_SOURCE_KEY = "early_closure";
export const IRA_SECTION_TARGET = "ira_termination";

const IRA_WORDS_RE = / (?:iras?|individual retirement|retirement (?:accounts?|plans?|savings)) /;
const IRA_END_RE = / (?:fees|charges|services|accounts?|iras?|plans?) $/;
/** On a line that carries a price, only a plural section word ends a title ("IRA FEES | Annual Maintenance Fee |
 * $12.00"); "IRA closed account | $10.00" and "Service Individual Retirement Accounts (IRAs) | Fee $12.00" are rows. */
const PRICED_TITLE_END_RE = / (?:fees|charges|services) $/;
/** Another section's title in a row's first cell ("Account Fees | Outgoing Wire Foreign (USD) - per wire | $50.00"). */
const OTHER_TITLE_END_RE = / (?:fees|charges|services) $/;
/** A first cell that names an account kind ("Checking Accounts", "Money Market", "Share Certificates", "Other Fees
 * (All Accounts)") is another section's title when a label cell follows it. */
export const ACCOUNT_KIND_WORDS = " (?:checking|savings|money market|certificates?|cds?|shares?|share drafts?|accounts|deposits) ";
const ACCOUNT_KIND_RE = new RegExp(ACCOUNT_KIND_WORDS);
/** A general service row ends the IRA's block of rows ("Wire Transfer - Outgoing | $25.00", "Copies | $2.00"). */
export const GENERAL_ROW_WORDS = " (?:wires?|copy|copies|photocop[a-z]*|money orders?|stop payments?|cashier s|cashiers|official checks?|checks?|check cashing|overdrafts?|nsf|non sufficient|insufficient|returned|atm|debit|cards?|research|garnishments?|levy|levies|legal|dormant|inactive|inactivity|notary|safe deposit|coin|fax|statements?|bill pay|ach|courtesy pay|gift|travelers?|chargebacks?) ";
const GENERAL_ROW_RE = new RegExp(GENERAL_ROW_WORDS);
/**
 * Knox v178 (review of #2973): the IRA's own rows that name a general service never end its block: a
 * distribution, rollover or contribution ("Distribution by check | $5.00", "Excess contribution removal"), a
 * transfer out to another institution, trustee or custodian ("Transfer to another institution by wire |
 * $25.00"), or a row whose first cell names an IRA ("IRA Statement Copy | $2.00").
 */
export const IRA_OWN_ROW_WORDS = " (?:distributions?|rollovers?|roll overs?|contributions?|trustees?|custodians?|transfers? (?:out|to (?:an?other|other|a new|a different) (?:financial )?(?:institution|trustee|custodian|bank|credit union|plan)))(?: |$)";
const IRA_OWN_ROW_RE = new RegExp(IRA_OWN_ROW_WORDS);
const ROW_PRICE_RE = new RegExp(SECTION_ROW_PRICE);
const HEADER_ROW_RE = new RegExp(SECTION_HEADER_ROW);
const PRICE_WORD_RE = /^\s*(?:no charge|free|none|varies|n\/a|not applicable)\b/i;
/** A title that lists other accounts with the IRA, or leaves the IRA out. */
const IRA_LIST_RE = /[/,&]|\band\b|\b(?:except|excluding|other than|not|non)\b/i;
const HEADING_BULLET_RE = new RegExp(HEADING_BULLET);
const SENTENCE_END_RE = new RegExp(HEADING_SENTENCE_END);

/** An IRA section's title (see the module note); `priced` when its line carries a price. */
export function iraSectionTitle(cell: string, priced = false): boolean {
  const trimmed = cell.trim();
  if (!trimmed || trimmed.length > IRA_HEADING_MAX_CHARS || HEADING_BULLET_RE.test(trimmed) || SENTENCE_END_RE.test(trimmed)) return false;
  if (IRA_LIST_RE.test(trimmed) || ROW_PRICE_RE.test(trimmed)) return false;
  const words = sectionWords(trimmed);
  if (words.trim().split(" ").length > IRA_HEADING_MAX_WORDS) return false;
  return IRA_WORDS_RE.test(words) && (priced ? PRICED_TITLE_END_RE : IRA_END_RE).test(words);
}

/** The line opens an IRA section: the line, or its first cell, is an IRA section's title. */
function opensIraSection(line: string): boolean {
  return iraSectionTitle(line.split("|")[0], ROW_PRICE_RE.test(line));
}

/** A cell priced or valued by a price word ("$25.00", "FREE"). */
function priceCell(cell: string): boolean {
  return ROW_PRICE_RE.test(cell) || PRICE_WORD_RE.test(cell);
}

/** Another section's title as a row's first cell (see the module note); no IRA, no price, at most seven words. */
function otherSectionTitle(cell: string): boolean {
  const words = sectionWords(cell);
  if (!cell.trim() || ROW_PRICE_RE.test(cell) || IRA_WORDS_RE.test(words)) return false;
  if (words.trim().split(" ").length > IRA_HEADING_MAX_WORDS) return false;
  return OTHER_TITLE_END_RE.test(words) || ACCOUNT_KIND_RE.test(words);
}

/**
 * A row whose first cell is another section's title and whose next cell names a fee, not a price ("Account Fees |
 * Outgoing Wire Foreign (USD) - per wire | $50.00", "Checking Accounts | Early Account Closure | $25.00"): the
 * section changes there.
 */
function opensOtherSection(line: string): boolean {
  if (!line.includes("|") || HEADER_ROW_RE.test(line.trim().toLowerCase())) return false;
  const [first, second = ""] = line.split("|");
  if (!otherSectionTitle(first)) return false;
  return /[a-z]{3,}/i.test(second) && !priceCell(second);
}

/**
 * The IRA's column on a title line of section titles only ("IRA FEES | CHECKING ACCOUNT FEES"): its index and
 * the number of columns; null on any other line.
 */
function iraTitleColumn(line: string): { column: number; columns: number } | null {
  const cells = line.split("|").map((cell) => cell.trim());
  if (cells.length < 2 || cells.some((cell) => !cell || priceCell(cell))) return null;
  const column = cells.findIndex((cell) => iraSectionTitle(cell));
  if (column < 0) return null;
  return cells.every((cell, index) => index === column || otherSectionTitle(cell)) ? { column, columns: cells.length } : null;
}

/** A row's name-and-price groups: cells up to and including each run of price cells. */
function rowGroups(line: string): string[] {
  const groups: string[][] = [];
  let current: string[] = [];
  let priced = false;
  for (const cell of line.split("|")) {
    if (priced && !priceCell(cell)) {
      groups.push(current);
      current = [];
      priced = false;
    }
    current.push(cell);
    if (priceCell(cell)) priced = true;
  }
  if (current.length > 0) groups.push(current);
  return groups.map((group) => group.join("|"));
}

/**
 * The rows printed in an IRA section, the title's own line included, by index into `text.split("\n")`. The value
 * is the IRA's own part of the row: the whole line, or, under a title line of two section titles, the row's
 * group in the IRA's column.
 */
export function iraSectionRowParts(text: string | null | undefined): Map<number, string> {
  const rows = new Map<number, string>();
  if (!text) return rows;
  let inIra = false;
  let since = Number.POSITIVE_INFINITY;
  let columns: { column: number; columns: number } | null = null;
  for (const [index, line] of text.split("\n").entries()) {
    if (!line.trim()) continue;
    if (opensIraSection(line)) {
      inIra = true;
      since = 0;
      columns = iraTitleColumn(line);
      rows.set(index, line);
      continue;
    }
    since += 1;
    if (!loanSectionRow(line) || opensOtherSection(line)) {
      inIra = false;
      continue;
    }
    if (!inIra || since > IRA_SECTION_REACH_LINES) continue;
    let part = line;
    if (columns) {
      const groups = rowGroups(line);
      if (groups.length !== columns.columns) continue;
      part = groups[columns.column];
    }
    const rowWords = sectionWords(part.split("|")[0]);
    if (GENERAL_ROW_RE.test(rowWords) && !IRA_WORDS_RE.test(rowWords) && !IRA_OWN_ROW_RE.test(rowWords)) {
      inIra = false;
      continue;
    }
    rows.set(index, part);
  }
  return rows;
}

/** Indexes (into `text.split("\n")`) of the rows printed in an IRA section, the title's own line included. */
export function iraSectionRows(text: string | null | undefined): Set<number> {
  return new Set(iraSectionRowParts(text).keys());
}

/**
 * True when `feeName` filed as early_closure at `amount` is printed only in an IRA section of `text` (every
 * line that prints the name at the price, at least one). False with no text, name or amount.
 */
export function iraSectionClosingFee(
  text: string | null | undefined,
  feeName: string | null | undefined,
  amount: number | null | undefined,
  canonicalFeeKey: string | null | undefined,
): boolean {
  if (!text || !feeName || amount == null || !Number.isFinite(amount) || canonicalFeeKey !== IRA_SECTION_SOURCE_KEY) return false;
  const found = pricedNameLines(text, feeName, amount);
  if (found.length === 0) return false;
  const rows = iraSectionRowParts(text);
  const lines = text.split("\n");
  return found.every((index) => {
    const part = rows.get(index);
    return part != null && (part === lines[index] || pricedNameLines(part, feeName, amount).length > 0);
  });
}
