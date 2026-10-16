import { withAccountName } from "@/lib/fee-account-heading";

/**
 * #1100 gap 3: an account comparison table, one column per product, with a monthly fee row.
 * Pure, and shared: Knox reads each priced cell with it (`knox/account-table.ts`) and the source
 * check traces those reads with it, so a read is stated by the same rule that made it.
 *
 *   Account               | Great Checking | Better Checking | Best Checking
 *   Minimum to open       | $25            | $100            | $500
 *   Monthly Service Fees  | $0             | $5              | $10
 *
 * Each priced cell of the fee row is that column's monthly fee, named as Hamilton names a generic
 * monthly fee by its account ("Better Checking Monthly Service Fees"). Only the fee row is read,
 * never the opening deposit or balance rows, and only when:
 * - a header row above names one product per price column, with every row in between the same
 *   width (a two-column PDF page whose right half lists other fees is no table);
 * - every cell of the fee row is a value: a price, a free cell, or "N/A", "No", "—";
 * - the product is a checking account: savings, share, money market, club, IRA, HSA and
 *   certificate columns are left alone (James decides the guard's exclusions, #1100).
 *
 * A cell is the fee when it opens with its price ("$10 ($6 if enrolled in eStatements)" is $10),
 * "$0/$25" is $25 (free when qualified, $25 otherwise), and a cell that is only "None", "Free" or
 * "No charge" is $0.
 */

const SEPARATOR = " | ";
/** How far above the fee row its header row may sit. */
const HEADER_REACH = 15;

/** The fee row's own label: the account's monthly fee and nothing else. */
export const ACCOUNT_FEE_ROW_LABEL =
  /^(?:monthly\s+(?:service|maintenance|account)\s+(?:fees?|charges?)|monthly\s+fees?|(?:account\s+)?maintenance\s+fees?|service\s+(?:fees?|charges?))\s*\*?\s*:?$/i;

const MONEY = /\$\s?\d/;
const NOT_A_PRODUCT = /^(?:yes|no|n\/?a|none|free|varies|included|unlimited|[-–—]+|\d.*)\s*\d?$/i;
const PRODUCT_NOISE = /\s*\(?\s*(?:apply now|open now|learn more|open an account|view more|view details|see details|most popular)\s*\)?\s*:?\s*/gi;
/** A product code in parentheses ("Rewards Checking (CK06)"). */
const PRODUCT_CODE = /\(\s*[A-Z]{1,4}-?\d{1,4}\s*\)/g;
/** Footnote marks: daggers, superscript digits, and a digit glued to a word's last letter ("Checking1"). */
const FOOTNOTE_MARKS = /[†‡§¶*¹²³⁴⁵⁶⁷⁸⁹⁰]+|(?<=(?:checking|account|banking|draft))\d{1,2}(?:,\d{1,2})*\b/gi;
/**
 * Words that say who an account is for or which variant it is. A name that carries one keeps it:
 * no rule strips it, and the business ones keep the column out (`BUSINESS_PRODUCT`).
 */
const AUDIENCE_WORDS = /\b(?:business|commercial|ag|agri\w*|farm\w*|ranch\w*|non-?profit|npo|sole\s+prop\w*|corporate|organizations?|senior\w*|student\w*|youth|teens?|kids?|minors?|college|military|employees?|older|younger|age\s+\d+|over\s+\d+|\d+\s*\+)\b/i;
/** A business column, which the guard's exclusions leave out (#1100): business, commercial, ag, nonprofit. */
const BUSINESS_PRODUCT = /\b(?:business|small\s*biz|biz|commercial|ag|agri\w*|farm\w*|ranch\w*|non-?profit|npo|sole\s+prop\w*|corporate|organizations?|church\w*|ministr\w*|trust|public\s+funds?|municipal\w*|government\w*|escrow|iolta)\b/i;
/** A tagline or button the bank prints after the product's name, by its exact words. */
const TAGLINE_TAIL = /^(?:most popular|view more|view details|see details|learn more|details?|open in minutes|open now|apply now|open an account|best for\b.*)$/i;
/** Prose after the name: a sentence mark, or three or more words with a lowercase connective. */
const PROSE_WORD = /^(?:that|this|you|your|our|to|with|and|of|the|an?|pays?|helps?|gives?|includes?|offers?|earn|get|enjoy|find|celebrate|designed|built|ready)$/i;
function isProseTail(tail: string): boolean {
  if (/[.!?]/.test(tail) || /,\s/.test(tail)) return true;
  const words = tail.split(/\s+/);
  return words.length >= 3 && words.some((word) => PROSE_WORD.test(word));
}
/**
 * How many words of a prose tail belong to the name: one capitalised variant word before the prose
 * starts ("Checking Plus with Overdraft Line" keeps "Plus"), otherwise none.
 */
function variantWords(tail: string): number {
  const words = tail.split(/\s+/);
  const prose = words.findIndex((word) => PROSE_WORD.test(word) || /[.!?,]/.test(word));
  return prose === 1 && /^[A-Z][A-Za-z+]*$/.test(words[0]) ? 1 : 0;
}
/**
 * The name without a tagline after its account word ("CLASSIC CHECKING Most Popular", "Diamond
 * Checking An Account that Fits All", "Inspire Checking Find your inspiration."). Conservative
 * (#1438 review): only an exact tagline or prose comes off, never a tail that names an audience or
 * variant ("Interest Checking for Ag", "Basic Checking - Senior") and never a "for …" tail.
 */
function withoutTagline(name: string): string {
  const match = /\b(?:checking|account|banking)\b/i.exec(name);
  if (!match) return name;
  const cut = match.index + match[0].length;
  const tail = name.slice(cut).trim();
  if (!tail || AUDIENCE_WORDS.test(tail) || /^for\b/i.test(tail)) return name;
  if (/^best for\b/i.test(tail) || TAGLINE_TAIL.test(tail)) return name.slice(0, cut).trim();
  if (isProseTail(tail)) {
    const keep = variantWords(tail);
    return [name.slice(0, cut).trim(), ...tail.split(/\s+/).slice(0, keep)].join(" ");
  }
  return name;
}
/** A cell that reads as a sentence or a feature, not a product's name. */
const SENTENCE_CELL = /[?!;]|\.\s|,\s+\w+\s+\w+\s+\w+|\b(?:fees|charges?|refunds?|nsf|overdraft\w*|need|needs|those|who|is|are|without)\b/i;
/** A cell that labels the header row rather than naming a product ("Features", "Compare", "Account Type"). */
const LABEL_CELL = /^(?:features?|compare|comparison|accounts?|account\s+(?:types?|features|name)|products?|product\s+(?:features|name)|types?|fees?|details|overview|benefits|(?:our|your|personal|consumer|all)\s+(?:checking\s+)?accounts|(?:our|your)\s+checking|checking\s+accounts)(?:\s*\/\s*(?:fees|features))?\s*:?$/i;
/** Action words a row of buttons carries ("Open Online | Open Account | Open Account"). */
const ACTION_CELL = /^(?:open|apply|learn|enroll|compare|get started|sign up|view|see|select|choose|which)\b(?!.*\bchecking\b)/i;
/** A button's words before the product ("Open a Basic Account", "Apply for Free Kasasa Cash Checking"). */
const ACTION_PREFIX = /^(?:click here to\s+)?(?:sign up for|open an?|apply for(?:\s+an?)?)\s+(?=\S+\s+\S)/i;
/** A cell that opens like a sentence or a tagline ("A smart, flexible checking", "Our highest interest checking"). */
const TAGLINE_CELL = /^(?:[Aa]n?|[Tt]he|[Oo]ur|[Yy]our|[Ff]or|[Bb]uilt|[Dd]esigned|[Pp]erfect|[Ii]deal|[Gg]reat|[Cc]lick|[Tt]his)\s+[a-z]|,\s*[a-z]/;
/** A cell that opens as a sentence to the reader ("You want a straightforward account …", "Enjoy free checking that pays"). */
const SENTENCE_START = /^(?:[Yy]ou|[Yy]ou[’']re|[Ww]e|[Ii]f|[Ww]hen|[Ee]njoy|[Cc]hoose)\b/;
/**
 * A column that names another bank's account: a page comparing itself with the big banks ("Our
 * Checking | US Bank Smartly Checking | Chase Premier Plus Checking") prices their accounts, not its own.
 */
const OTHER_BANK = /\b(?:chase|u\.?\s?s\.?\s+bank|wells\s+fargo|bank\s+of\s+america|bofa|citi(?:bank)?|pnc|truist|capital\s+one|td\s+bank|regions|fifth\s+third|huntington|keybank|m&t|citizens\s+bank|santander|bmo)\b/i;
/** A header that sets big banks' accounts beside others: some column names a big bank, and not every column the same one. */
function comparesOtherBanks(products: string[]): boolean {
  const banks = products.map((name) => OTHER_BANK.exec(name)?.[0].toLowerCase().replace(/[\s.]+/g, "") ?? null);
  if (banks.every((bank) => bank == null)) return false;
  return banks.some((bank) => bank == null) || new Set(banks).size > 1;
}
/** A fee-change notice's column ("fee through 12/31", "as of 1/1"): a date, not a product. */
const DATED_CELL = /\b(?:through|thru|as of|effective|until|beginning|starting)\b|\d{1,2}\/\d{1,2}/i;
/** A header's first cell that labels descriptions, not product names ("Checking Description"). */
const NOT_A_HEADER_LABEL = /\b(?:description|overview|perks|about)\b/i;
/** Columns the reader leaves alone: savings-type and tax-advantaged accounts. */
const NOT_CHECKING = /\b(?:shares?(?!\s*drafts?)|savings?|savers?|money\s*market|mmda|club|ira|hsa|health savings|cds?|certificates?)\b/i;
/** A column a checking product heads: its name says checking, account, banking or draft, or carries a brand mark. */
const CHECKING_WORD = /checking|\baccounts?\b|\bbanking\b|\bdrafts?\b|®|™/i;
/** Text after a cell's price that names another fee ("$2 00 Account reconciliation/research, per hour"). */
const OTHER_FEE_AFTER = /\b(?:research|reconcil\w*|card|transfers?|stop|checks\b|statements?|wires?|atm|notary|cop(?:y|ies)|photocop\w*|returned|nsf|overdraft|item fee|garnish\w*|levy)\b/i;
const FREE_CELL = /^(?:none|free|no charge|no fee|n\/c|\$\s?0(?:\.00)?)\s*[*†‡\d]?\s*$/i;
const NO_VALUE_CELL = /^(?:n\/?a|no|[-–—]+)\s*[*†‡\d]?\s*$/i;

export interface AccountTableCell {
  label: string;
  product: string;
  /** The read's name: the product before the fee row's label. */
  feeName: string;
  amount: number;
  cell: string;
  row: string;
}

function squash(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cellsOf(line: string): string[] {
  return line.split(SEPARATOR).map(squash);
}

/** The product a header cell names, cleaned of footnote marks, quotes and codes; null when it names none. */
export function productName(cell: string): string | null {
  const cleaned = squash(
    cell
      .replace(PRODUCT_NOISE, " ")
      .trim()
      .replace(ACTION_PREFIX, "")
      .replace(PRODUCT_CODE, " ")
      .replace(FOOTNOTE_MARKS, "")
      .replace(/["“”]/g, "")
      .replace(/\(\s*\)/g, " ")
      .replace(/(?:\s*[-–—>»→]+\s*)+$/, "")
      .replace(/[*:]+\s*$/, "")
      // A long parenthetical is a note, unless it says who the account is for ("(age 65 or older)").
      .replace(/\s*\((?:[^()\s]+\s+){2,}[^()]*\)/g, (note) => (AUDIENCE_WORDS.test(note) ? note : "")),
  );
  // A name printed twice in one cell ("Flourish Checking Flourish Checking") is one name.
  const doubled = /^(.{3,}?)\s+\1$/i.exec(cleaned);
  const name = withoutTagline(doubled ? doubled[1] : cleaned);
  if (name.length < 3 || name.length > 60 || MONEY.test(name) || NOT_A_PRODUCT.test(name) || !/[a-z]{3}/i.test(name) || /[=•]|^[-–—]/.test(name)) return null;
  if (ACTION_CELL.test(name) || DATED_CELL.test(name) || LABEL_CELL.test(name)) return null;
  if (name.split(/\s+/).length > 10 || SENTENCE_CELL.test(name) || TAGLINE_CELL.test(name) || SENTENCE_START.test(cleaned)) return null;
  return name;
}

/** Words after a figure that make it a balance, deposit or opening requirement, not the fee. */
const BALANCE_AFTER = /^\s*\+?\s*(?:(?!(?:if|when|unless|waived|otherwise|or|and|per)\b)[a-z]+\s+){0,2}?(?:minimum|min\.|average|avg\.?|daily|combined|ledger|collected|balances?|deposits?|loans?|to open|opening)\b/i;
/** ... unless the words name the fee itself ("$5.00 Minimum Balance Fee"). */
const BALANCE_FEE_AFTER = /^\s*(?:(?:minimum|min\.?|low|average|daily)\s+)*balance\s+(?:fee|charge)/i;
/** Words before a figure that make it a balance ("balance of $100", "falls below $1,500", "< $5,000"). */
const BALANCE_BEFORE = /(?:\b(?:balances?(?:\s+of)?|minimum(?:\s+of)?|with|maintain(?:ing)?|keep(?:ing)?|at least|over|above|below|under|less than|more than|exceeds?|totaling|deposits?)(?:\s+(?:an?|of))?|[<>≥≤])\s*$/i;
/** Words after a figure that make it a discount or reward, not a price ("$3 discount with direct deposit"). */
const REWARD_AFTER = /^\s*(?:[a-z]+\s+)?(?:discount|off|credit|rebate|refund|reimburse\w*|cash\s*back|bonus)\b/i;
/** Words after a $0 that make it the price only when a condition is met ("$0 with ...", "$0* *When ..."). */
const CONDITIONAL_FREE_AFTER = /^\s*(?:with|if|when|after|w\/)\b/i;
/**
 * A price in a cell. A footnote digit printed after the cents ("$3.951") or after a lone zero
 * ("$01") is not part of the price.
 */
const CELL_PRICE = /\$\s?(\d{1,3}(?:,\d{3})+|0(?=\d)|\d+)(\.\d{2})?\d?(?![\d,])/g;

/** A cell that states a value: a price, a free cell, or "N/A", "No", "—". */
function isValueCell(cell: string): boolean {
  const value = squash(cell);
  return /^(?:only\s+)?\$\s?\d/i.test(value) || FREE_CELL.test(value) || NO_VALUE_CELL.test(value);
}

/**
 * The fee a cell states, or null when it states none or does not say which figure is the fee.
 * A figure that is a balance or opening requirement is skipped ("$25 minimum daily balance or $8"
 * is $8), and so are a discount and a $0 that holds only when a condition is met ("$0 with $500
 * balance / $12" is $12). A parenthetical is the price's own note and is never read. Two fee
 * figures left ("$7 + $0.40 per debit", "$0 to $8") is no read.
 */
export function accountCellPrice(cell: string): number | null {
  const value = squash(cell);
  const plain = squash(value.replace(/\([^()]*\)?/g, " "));
  // The price's own words may follow it, never another fee's ("($6 if enrolled in eStatements)" may).
  const rest = plain.replace(/^[^\d]*\d[\d,]*(?:\.\d{2})?/, "");
  if (OTHER_FEE_AFTER.test(rest)) return null;
  const qualified = /^\$\s?0(?:\.00)?\s*\/\s*\$\s?(\d[\d,]*(?:\.\d{2})?)(?![\d,])/.exec(value);
  if (qualified) return Number(qualified[1].replace(/,/g, ""));
  if (FREE_CELL.test(value)) return 0;
  if (!/^(?:only\s+)?\$\s?\d/i.test(plain)) return null;
  const fees = new Set<number>();
  for (const match of plain.matchAll(CELL_PRICE)) {
    const at = match.index ?? 0;
    const before = plain.slice(0, at);
    const after = plain.slice(at + match[0].length).replace(/^[\s*†‡]+/, " ");
    const amount = Number(`${match[1].replace(/,/g, "")}${match[2] ?? ""}`);
    if (BALANCE_BEFORE.test(before) || REWARD_AFTER.test(after)) continue;
    if (BALANCE_AFTER.test(after) && !BALANCE_FEE_AFTER.test(after)) continue;
    if (amount === 0 && CONDITIONAL_FREE_AFTER.test(after)) continue;
    fees.add(amount);
  }
  return fees.size === 1 ? [...fees][0] : null;
}

/** The products a fee row's header names, by column, or null when no header stands above it. */
/** A row's products when it is a product header for a fee row this wide, or null. */
function productHeader(header: string[], width: number): Array<string | null> | null {
  // A header with no first cell ("Free Kasasa Cash® | Free Kasasa Cash Back®" over "Monthly Fee |
  // FREE | FREE") names the price columns alone, so its first cell must itself be a product: a label
  // there ("Features", "Select an account", "Which is right for you?") would give each price to the
  // product before it, and `productName` refuses those.
  const short = header.length === width - 1;
  const named = short ? [null, ...header.map(productName)] : header.map(productName);
  const products = named.slice(1);
  // A row whose cells repeat ("Open Account | Open Account") is buttons or notes, not products.
  const distinct = new Set(products.map((name) => (name ?? "").toLowerCase())).size === products.length;
  const isHeader = products.every((name) => name != null) && distinct && products.some((name) => CHECKING_WORD.test(name ?? "")) &&
    !(!short && NOT_A_HEADER_LABEL.test(header[0]));
  if (!isHeader) return null;
  // A header that names a business account ("LOW-VOLUME CHECKING | BUSINESS CHECKING | ANALYSIS
  // CHECKING") is a business comparison: its other columns are business accounts too, under names
  // the guard cannot tell apart, so the table is not read (#1438 review, B6).
  if (products.some((name) => BUSINESS_PRODUCT.test(name ?? ""))) return null;
  return comparesOtherBanks(products as string[]) ? null : named;
}

/**
 * The products a fee row's header names, by column, or null when no header stands above it.
 * #1438 review (B4): the header is the topmost product header in the run of rows above the fee
 * row, never the nearest row that happens to name an account ("Key Features | ... | No NSF Fees for
 * overdrawing Account", "Best For | Basic Checking Needs | ..."). The run is the rows of the table's
 * width above the fee row; a row one cell short ends it as its top. A "Best For" row above the
 * real header ("Best For | Cash Back on Purchases" over "Account | Kasasa Cash® Checking") is part
 * of the run but names no product, so the header below it is taken.
 */
function headerFor(lines: string[], index: number, width: number): Array<string | null> | null {
  const run: number[] = [];
  for (let above = index - 1; above >= Math.max(0, index - HEADER_REACH); above -= 1) {
    const cells = cellsOf(lines[above]);
    const length = cells.length;
    // An earlier fee row belongs to the table above (#1438 review, B5): the run ends below it.
    if (ACCOUNT_FEE_ROW_LABEL.test(cells[0])) break;
    if (length === width) {
      run.push(above);
      continue;
    }
    if (length === width - 1) run.push(above);
    break;
  }
  const headers = run.reverse().map((row) => productHeader(cellsOf(lines[row]), width)).filter((named) => named != null);
  if (headers.length === 0) return null;
  // Two product headers that name different columns: two tables stacked, or a header and a row
  // of other products. Which one the fee row belongs to is unclear, so the table is not read.
  const columns = (named: Array<string | null>) => named.slice(1).map((name) => (name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "")).join("|");
  if (headers.some((named) => columns(named) !== columns(headers[0]))) return null;
  return headers[0];
}

/** Every priced cell of every account comparison table's monthly fee row in a text. */
export function accountTableCells(text: string): AccountTableCell[] {
  const lines = text.split(/\n+/).map(squash).filter(Boolean);
  const found: AccountTableCell[] = [];
  lines.forEach((line, index) => {
    const cells = cellsOf(line);
    if (cells.length < 3 || !ACCOUNT_FEE_ROW_LABEL.test(cells[0])) return;
    // A cell whose fee figure is unclear is left out; the row's other columns are still read.
    if (!cells.slice(1).every(isValueCell)) return;
    const products = headerFor(lines, index, cells.length);
    if (!products) return;
    for (let column = 1; column < cells.length; column += 1) {
      const product = products[column];
      const amount = accountCellPrice(cells[column]);
      if (!product || amount == null || NOT_CHECKING.test(product) || BUSINESS_PRODUCT.test(product) || !CHECKING_WORD.test(product)) continue;
      found.push({ label: cells[0], product, feeName: withAccountName(cells[0], product), amount, cell: cells[column], row: line });
    }
  });
  return found;
}

function comparable(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** The row an account table states this product's monthly fee at this price on, or null. */
export function accountTableRow(text: string, feeName: string, amount: number): string | null {
  const name = comparable(feeName);
  const cents = Math.round(amount * 100);
  const cell = accountTableCells(text).find((entry) => comparable(entry.feeName) === name && Math.round(entry.amount * 100) === cents);
  return cell?.row ?? null;
}
