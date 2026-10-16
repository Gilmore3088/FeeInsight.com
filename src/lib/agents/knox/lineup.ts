import { AMOUNT_PATTERN, amountsIn, BALANCE_BELOW_CLAUSE } from "@/lib/agents/knox/rules";
import { accountTableProduct } from "@/lib/custom-report/account-table";
import { namesNoAccount, withoutNonAccountWords } from "@/lib/account-name-exclusions";

/**
 * A checking account's lineup facts, read with its monthly maintenance fee: the product's
 * name, the balance that avoids the fee, the deposit needed to open it, and the waiver
 * wording. Pure.
 *
 * Every value is grounded in the source text the way amounts are: a dollar figure must
 * appear in the text, and the product name and waiver text must be found in the text once
 * case and whitespace are normalized. A value that is not there is stored as null, never
 * guessed.
 */
export interface AccountLineup {
  productName: string | null;
  minBalanceToAvoid: number | null;
  minOpeningDeposit: number | null;
  waiverText: string | null;
}

/** The only category that carries every lineup field. */
export const LINEUP_CATEGORY = "monthly_maintenance";
/**
 * v73 (#1100): the categories whose reads record the account they belong to (`product_name`, the
 * catalog's `account_product_type`). A minimum balance fee records only the account; its balance
 * and waiver fields stay monthly maintenance's.
 */
export const ACCOUNT_PRODUCT_CATEGORIES: ReadonlySet<string> = new Set([LINEUP_CATEGORY, "minimum_balance"]);
const MAX_PRODUCT_NAME_CHARS = 80;
const MAX_WAIVER_CHARS = 240;
const MAX_THRESHOLD = 10_000_000;

function squash(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function comparable(value: string): string {
  return squash(value.toLowerCase().replace(/[‘’ʼ`]/g, "'").replace(/[“”]/g, '"'));
}

function groundedPhrase(value: unknown, haystack: string, maxChars: number): string | null {
  if (typeof value !== "string") return null;
  const phrase = squash(value);
  if (phrase.length < 3 || phrase.length > maxChars) return null;
  return haystack.includes(comparable(phrase)) ? phrase : null;
}

function figureText(value: number): string[] {
  const fixed = value.toFixed(2);
  const whole = Number.isInteger(value) ? String(value) : fixed;
  const comma = (text: string) => text.replace(/\B(?=(\d{3})+(?!\d))/, ",");
  return Array.from(new Set([fixed, whole, comma(fixed), comma(whole)]));
}

function groundedFigure(value: unknown, text: string): number | null {
  if (value == null || value === "") return null;
  const figure = typeof value === "number" ? value : Number(String(value).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(figure) || figure < 0 || figure > MAX_THRESHOLD) return null;
  const rounded = Math.round(figure * 100) / 100;
  if (amountsIn(text).some((found) => found.value === rounded)) return rounded;
  // "a minimum daily balance of 1,500": the figure without its dollar sign.
  const bare = figureText(rounded).some((form) => new RegExp(`(^|[^\\d.,])${form.replace(".", "\\.")}(?![\\d]|[.,]\\d)`).test(text));
  return bare ? rounded : null;
}

/** Lineup values checked against the text; null when none of them is stated there. */
export function groundLineup(
  values: { productName?: unknown; minBalanceToAvoid?: unknown; minOpeningDeposit?: unknown; waiverText?: unknown },
  text: string,
): AccountLineup | null {
  const haystack = comparable(text);
  const lineup: AccountLineup = {
    productName: groundedPhrase(values.productName, haystack, MAX_PRODUCT_NAME_CHARS),
    minBalanceToAvoid: groundedFigure(values.minBalanceToAvoid, text),
    minOpeningDeposit: groundedFigure(values.minOpeningDeposit, text),
    waiverText: groundedPhrase(values.waiverText, haystack, MAX_WAIVER_CHARS),
  };
  return Object.values(lineup).some((value) => value !== null) ? lineup : null;
}

/**
 * v49: the account a monthly fee belongs to, when the read did not name one. Most schedules
 * name the account in the fee's own words ("No Boundaries Checking Account Monthly
 * Maintenance Fee", "Service charge fee (Checking + Interest Account)") or in a short
 * heading a few lines above the fee ("Exchange Advantage Checking"). Only 906 of 11,870
 * monthly fee rows had a product name on 2026-10-09; the rest were read from rows like these.
 */
const ACCOUNT_WORD = /\b(?:checking|savings|money market|share draft|share|club|account|statement savings)\b/i;
/** Words that say what kind of account it is, not which one. */
const GENERIC_ACCOUNT_WORDS = new Set([
  "monthly", "maintenance", "service", "services", "account", "accounts", "fee", "fees", "charge", "charges", "low",
  "balance", "minimum", "min", "min.", "the", "a", "an", "for", "per", "month", "all", "each", "if", "of", "and", "or",
  "checking", "savings", "share", "shares", "draft", "drafts", "money", "market", "club", "personal", "business",
  "consumer", "our", "your", "compare", "open", "banking", "deposit", "deposits", "products", "product", "other",
  "features", "feature", "benefits", "details", "schedule", "rates", "rate", "information", "options", "types",
  "commercial", "individual", "joint", "with", "to", "&", "+", "-", "–", "type",
  "description", "descriptions", "disclosure", "disclosures", "terms", "summary", "comparison",
]);
const FEE_NAME_TAIL =
  /\s*[-–:]?\s*(?:low balance\s+)?(?:monthly\s+)?(?:maintenance\s+|service\s+|account\s+)*(?:fee|charge|service charge|maintenance)s?(?:\s+of)?\s*$/i;
const HEADING_TAIL =
  /\s+(?:features|benefits|details|account details|overview|highlights|(?:interest\s+)?rates|descriptions?|disclosures?|terms|information|summary|maintenance)\s*$/i;
/** A fee's own heading, not an account ("Early (Share) Savings Account Closing"). */
/** A heading that is an account type on its own line ("Money Market"). */
const ACCOUNT_TYPE_HEADING = /^(?:money market(?: account| savings)?|share draft(?: account)?|statement savings|regular savings|share savings|passbook savings)$/i;
/**
 * v73 (#1100): a heading that names only the kind of account the lines under it belong to
 * ("Savings Accounts", "Business Checking Accounts", "Christmas Club"). It says which kind, not
 * which product, and that is what the account type needs. A kind is never assumed: a heading that
 * names none ("Personal Accounts", "Deposit Accounts") is no heading here.
 */
const ACCOUNT_KIND_HEADING =
  /^(?:(?:personal|consumer|business|commercial|small business|non-?profit|youth|student|senior)\s+)?(?:checking|savings|share savings|regular savings|share draft|money market(?:\s+(?:savings|checking))?|christmas club|holiday club|vacation club|club savings|certificates?(?:\s+of\s+deposit)?|cds|iras?|individual retirement|health savings)(?:\s+accounts?)?$/i;
const FEE_HEADING_END = /\b(?:closing|closed|closure|dormant|inactive|inactivity|overdraft|transfer|withdrawals?)\s*$/i;
const SENTENCE_WORDS = /\b(?:is|are|you|your|we|our|will|may|must|when|if|or|per|this|that)\b/i;
const HEADING_LOOKBACK_LINES = 12;
/**
 * Words around the name: "Open an Advantage Checking Account", "Details: Popular Prestige Checking",
 * "Learn more about Advantage Checking" (a link under the account, First International 260, 9 Oct).
 */
const LEAD_IN = /^(?:open\s+(?:an?\s+|your\s+)?|(?:features|details|benefits|highlights)\s*(?:of\s+|:\s*)|learn\s+more\s+about\s+(?:our\s+|the\s+)?)/i;
const ARTICLE_START = /^(?:an?|the)\s/i;

/** Two or more lower-case words: a description of an account, not its title-cased name. */
function describesAccount(words: string[]): boolean {
  return words.filter((word) => /^[a-z]/.test(word) && !/^(?:and|of|for|plus|with)$/.test(word)).length >= 2;
}

/** Page text, not a name: lower-case description, a sentence, an ellipsis, or a link's lead-in. */
function isPageSentence(name: string): boolean {
  return describesAccount(name.split(" ")) || /…|\.\.\./.test(name) || SENTENCE_WORDS.test(name) || LEAD_IN.test(name);
}

/** A name that says which account: an account word plus a word of its own, 2 to 6 words. */
function distinctAccountName(value: string): string | null {
  const name = squash(value).replace(/[\s\-–:|,.]+$/, "").replace(HEADING_TAIL, "").replace(LEAD_IN, "");
  if (name.length < 4 || name.length > MAX_PRODUCT_NAME_CHARS || FEE_HEADING_END.test(name)) return null;
  // "For all customers with savings needs…" is a tagline under the account (RNB 2558, 9 Oct).
  if (!/^[A-Z0-9]/.test(name) || /\$|\d{2,}|[;.!?,_…]/.test(name) || SENTENCE_WORDS.test(name)) return null;
  const words = name.split(" ");
  if (words.length < 2 || words.length > 6 || !ACCOUNT_WORD.test(name) || describesAccount(words)) return null;
  return words.some((word) => !GENERIC_ACCOUNT_WORDS.has(word.toLowerCase())) ? name : null;
}

/**
 * A stored product name as a reader should see it. Names stored before the v49 rules can
 * carry a heading's tail ("Signature Checking Rates"), footnote marks ("Fresh Start Checking
 * 6,11"), a blank to fill in, or a list of account types ("Money Market, or Savings").
 * Trims the tail and marks; null when what is left does not name one account.
 */
export function readableProductName(value: string | null | undefined): string | null {
  if (!value) return null;
  const name = squash(value)
    .replace(/[\s\d,_*†‡]+$/, "")
    .replace(HEADING_TAIL, "")
    .replace(/[\s\-–:|,.]+$/, "")
    .replace(LEAD_IN, "");
  if (name.length < 3 || /[,_]|\bor\b/i.test(name) || !/^[A-Z0-9]/.test(name) || ARTICLE_START.test(name)) return null;
  if (FEE_HEADING_END.test(name)) return null;
  const words = name.split(" ");
  // A product name is title-cased; a run of lower-case words is a description of it.
  if (words.length > 6 || describesAccount(words)) return null;
  return words.some((word) => !GENERIC_ACCOUNT_WORDS.has(word.toLowerCase())) ? name : null;
}

/**
 * A balance needed to earn interest or a dividend is a rate tier, not a way to avoid the fee
 * ("$25,000 minimum balance requirement to earn interest with tiers").
 */
export const INTEREST_TIER =
  /\b(?:earn(?:s|ing)?\s+(?:the\s+)?(?:interest|dividends?|apy)|apy|annual percentage yield|interest\s+(?:rate|tier)s?|dividend\s+rates?|rate\s+tiers?)\b/i;

/** A waiver says how to avoid the fee: a balance, deposit, age, activity or relationship. */
const WAIVER_CONDITION =
  /\b(?:balance|deposits?|e-?statements?|paperless|ages?|years?|younger|older|students?|seniors?|minors?|members?|transactions?|purchases?|debit card|enroll(?:ed|ment)?|relationship|direct)\b|\$\s?\d/i;
/** The fee's own amount: "$25.00 monthly maintenance fee", "service charge of $10.00". */
const FEE_AMOUNT =
  /\$\s?\d[\d,.]*\s+(?:monthly\s+)?(?:maintenance\s+|service\s+)?(?:fee|charge|service)|(?:fee|charge)s?\s+of\s+\$\s?\d[\d,.]*/gi;

/**
 * A waiver as a reader should see it: leader dots trimmed, and null when it names no
 * condition ("Waive Monthly Maintenance Fee", "waived, and all ATM surcharge").
 */
export function readableWaiver(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = squash(value.replace(/\s*\.{3,}.*$/, "")).replace(/[\s.;,)]+$/, "");
  // The fee's own amount is not a condition ("waive the $10 monthly fee").
  const conditions = text.replace(FEE_AMOUNT, "");
  if (FEE_TRIGGER_ONLY.test(text) && !/\b(?:waive|avoid|no (?:monthly )?(?:fee|charge)|free)/i.test(text)) return null;
  return text.length >= 8 && WAIVER_CONDITION.test(conditions) && !INTEREST_TIER.test(text) ? text : null;
}

/** "If min. balance not maintained" says when the fee applies, not how to avoid it. */
const FEE_TRIGGER_ONLY = /^\W*(?:if|when)\b.*\b(?:not maintained|falls? below|drops? below|less than|under)\b/i;

/**
 * A waiver as shown on screen: control characters out, and footnote marks the text kept glued
 * to a word or amount ("balances6", "direct deposit of $2507" for $250 plus footnote 7).
 * Display only; stored text stays as the source has it.
 */
export function waiverForDisplay(value: string | null | undefined): string | null {
  const readable = readableWaiver(value?.replace(/[\u0000-\u001f\u007f]+/g, " "));
  if (!readable) return null;
  return squash(
    readable
      .replace(/([a-z])\d{1,2}\b/gi, "$1")
      .replace(/\$(\d{3,4})(\d)(?![\d,.])/g, (whole, amount: string, mark: string) =>
        mark !== "0" && Number(amount) % 50 === 0 ? `$${amount}` : whole,
      ),
  );
}

/** "Freedom Checking Monthly Fee" -> "Freedom Checking";"Service charge (Checking + Interest Account)" -> the parenthetical. */
export function productNameFromFeeName(feeName: string): string | null {
  const parenthetical = feeName.match(/\(([^()]{4,80})\)/)?.[1];
  if (parenthetical) {
    const named = distinctAccountName(parenthetical);
    if (named) return named;
  }
  const prefix = feeName.replace(/\([^()]*\)/g, " ").replace(FEE_NAME_TAIL, "");
  return squash(prefix) === squash(feeName) ? null : distinctAccountName(prefix);
}

/** The account's lines around the fee: the fee's own line, a few above it up to its heading, two below. */
interface AccountBlock {
  heading: string | null;
  /**
   * v73: the nearest heading above the fee that names its account, or only the kind of account
   * ("Savings Accounts"), whichever is nearer. The account the read records; `heading` stays the
   * name the other lineup reads use.
   */
  accountHeading: string | null;
  feeLine: string;
  /** Lines of the same account, nearest the fee first, the fee's own line excluded. */
  nearby: string[];
  /** Every line a few above and below the fee, whatever account they belong to (v55 corrections). */
  around: string[];
}

const BLOCK_LINES_ABOVE = 4;
const BLOCK_LINES_BELOW = 2;

/** The index of the fee's own line in the text's lines, or -1 when it cannot be told. */
function feeLineIndex(lines: string[], excerpt: string): number {
  const probe = squash(excerpt).slice(0, 30);
  if (probe.length < 8) return -1;
  // v73: the line that holds the whole excerpt first; its first 30 characters can open an earlier
  // line too ("Call or see a Platte Valley Bank representative..." under CDs and again under HSAs).
  const whole = squash(excerpt).slice(0, 160);
  const exacts = lines.flatMap((line, index) => (line.includes(whole) ? [index] : []));
  // The same row printed under several accounts ("Monthly service charge | $10" in eight account
  // tables, inst 483864's schedule): which account's it is cannot be told, so none.
  if (exacts.length > 1) return -1;
  let at = exacts.length === 1 ? exacts[0] : -1;
  if (at < 0) {
    const opening = lines.flatMap((line, index) => (line.includes(probe) ? [index] : []));
    if (opening.length <= 1) at = opening[0] ?? -1;
    else {
      // A sentence wrapped over two lines whose opening words repeat on other accounts' lines (a Reg
      // DD disclosure's "Minimum balance to avoid imposition of fees - A service charge fee of $…"):
      // the line that, joined to the next, holds the excerpt. None, or more than one: no account.
      const joined = whole.slice(0, 120);
      const held = opening.filter((index) => `${lines[index]} ${lines[index + 1] ?? ""}`.includes(joined));
      at = held.length === 1 ? held[0] : -1;
    }
  }
  return at;
}

function accountBlock(text: string, excerpt: string): AccountBlock | null {
  const lines = text.split(/\n+/).map(squash).filter(Boolean);
  const at = feeLineIndex(lines, excerpt);
  if (at < 0) return null;
  let heading: string | null = null;
  let headingAt = -1;
  let accountHeading: string | null = null;
  // v73: a heading that speaks of checking but names no one account ("Checking Account Fees", "Our
  // Checking Accounts", "CHECKING & MONEY MARKET") ends the account lookback: the fees under it are
  // checking's or mixed, and an older heading above it belongs to other accounts.
  let accountStopped = false;
  const takeAccount = (name: string) => {
    if (!accountStopped && accountHeading === null && !namesNoAccount(name)) accountHeading = name;
  };
  for (let index = at - 1; index >= Math.max(0, at - HEADING_LOOKBACK_LINES); index -= 1) {
    const line = lines[index];
    if (line.includes("$") || line.includes("|")) continue;
    const kind = line.replace(/[\s:]+$/, "");
    if (!accountStopped && accountHeading === null && !namesNoAccount(kind)) {
      if (ACCOUNT_KIND_HEADING.test(kind)) accountHeading = kind;
      else if ((CHECKING_WORDS.test(kind) || PACKAGE_HEADING.test(kind)) && !ACCOUNT_TYPE_HEADING.test(line) && !distinctAccountName(line.replace(HEADING_TAIL, ""))) accountStopped = true;
    }
    // v55: "Money Market" alone heads its own fee; another fee's heading ("Early (Share)
    // Savings Account Closing") means the lines above belong to other fees.
    if (ACCOUNT_TYPE_HEADING.test(line)) {
      heading = line;
      headingAt = index;
      takeAccount(line);
      break;
    }
    if (FEE_HEADING_END.test(line)) break;
    const named = distinctAccountName(line.replace(HEADING_TAIL, ""));
    if (named) {
      heading = named;
      headingAt = index;
      takeAccount(named);
      break;
    }
  }
  const nearby: string[] = [];
  // Below the fee: stop at the next account's heading.
  for (let index = at + 1; index <= Math.min(lines.length - 1, at + BLOCK_LINES_BELOW); index += 1) {
    const line = lines[index];
    if (!line.includes("$") && (ACCOUNT_TYPE_HEADING.test(line) || distinctAccountName(line.replace(HEADING_TAIL, "")))) break;
    nearby.push(lines[index]);
  }
  // Above the fee: never past its own heading.
  for (let index = at - 1; index >= Math.max(0, at - BLOCK_LINES_ABOVE, headingAt + 1); index -= 1) nearby.push(lines[index]);
  const around = lines.slice(Math.max(0, at - BLOCK_LINES_ABOVE), at).concat(lines.slice(at + 1, at + 1 + BLOCK_LINES_BELOW));
  return { heading, accountHeading, feeLine: lines[at], nearby, around };
}

/**
 * v73: the account a table's header names over the column whose cell holds this price, any kind of
 * account ("ACCOUNT FEATURES | BUSINESS CHECKING" over "Monthly service charge | $10"). The
 * comparison-table reader (`accountTableProduct`) reads checking columns only; this one names the
 * column of any account, so a business or savings table's fee never takes a heading above the table.
 * Null when no price cell or no header row of the same width names an account there.
 */
export function tableColumnProduct(text: string, excerpt: string, amount: number): string | null {
  const lines = text.split(/\n+/).map(squash).filter(Boolean);
  const at = feeLineIndex(lines, excerpt);
  if (at < 0 || !lines[at].includes("|")) return null;
  const cells = lines[at].split("|").map(squash);
  const cents = Math.round(amount * 100);
  const columns = cells
    .map((cell, index) => ({ index, prices: amountsIn(cell).map((found) => Math.round(found.value * 100)) }))
    .filter((cell) => cell.index > 0 && cell.prices[0] === cents);
  if (columns.length !== 1) return null;
  for (let index = at - 1; index >= Math.max(0, at - 15); index -= 1) {
    // A line that is no table row ends the table: a header above it is another table's.
    if (!lines[index].includes("|")) break;
    const row = lines[index].split("|").map(squash);
    // A row of another width: a price row of the same table can be wider or narrower, but one with
    // no price is another table's header, stacked above with no line between ("Free | Gold").
    if (row.length !== cells.length) {
      if (!row.some((cell) => cell.includes("$"))) break;
      continue;
    }
    if (row.some((cell) => cell.includes("$"))) continue;
    // A header row opens on a label ("Account Type", "ACCOUNT FEATURES", "Product"). An unlabelled row
    // with no price ends the climb ("Maintaining One Or More Of The | LifeGreen Preferred Checking account").
    if (!TABLE_HEADER_LABEL.test(row[0])) break;
    const name = row[columns[0].index].replace(/[*†‡¹²³⁴⁵⁶⁷⁸⁹]+$/, "").trim();
    if (namesNoAccount(name)) return null;
    if (ACCOUNT_KIND_HEADING.test(name) || ACCOUNT_TYPE_HEADING.test(name) || distinctAccountName(name)) return name;
  }
  return null;
}

const TABLE_HEADER_LABEL = /^(?:accounts?|account\s+(?:types?|names?|features?|options?)|products?|features?|services?|compare|)\s*:?$/i;

/** The nearest short account heading in the lines just above the fee's own line. */
export function accountHeadingAbove(text: string, excerpt: string): string | null {
  return accountBlock(text, excerpt)?.heading ?? null;
}

const FIGURE = String.raw`\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d+(?:\.\d{2})?)`;
/** "minimum daily balance of $1,500 ... to avoid", "maintain a $500 average balance to avoid". */
const BALANCE_TO_AVOID = [
  new RegExp(String.raw`\b(?:minimum|min\.?|average|daily|monthly|ledger|collected)[^.$|]{0,40}\bbalances?\s+(?:of\s+|is\s+|:\s*|[-–]\s*)?${FIGURE}[^.|]{0,80}\b(?:avoid|waive)`, "i"),
  new RegExp(String.raw`${FIGURE}\s+(?:minimum\s+|average\s+|daily\s+){1,3}balance[^.|]{0,80}\b(?:avoid|waive)`, "i"),
  new RegExp(String.raw`\b(?:avoid|waive)[^.|]{0,80}\b(?:minimum|average|daily)\s+(?:(?:daily|average|monthly|collected|ledger)\s+){0,2}balance\s+(?:of\s+)?${FIGURE}`, "i"),
];
/** "$100 minimum opening deposit", "Minimum deposit to open: $25.00". */
const OPENING_DEPOSIT = [
  new RegExp(String.raw`${FIGURE}\s+(?:minimum\s+)?(?:opening\s+(?:deposit|balance)|to open)`, "i"),
  new RegExp(String.raw`\b(?:minimum\s+)?(?:opening\s+(?:deposit|balance)|(?:deposit|balance)\s+(?:required\s+)?to\s+open(?:\s+(?:this|an|the)\s+account)?)\s*(?:is|of|:|[-–])?\s*(?:you must deposit\s+)?${FIGURE}`, "i"),
];
const WAIVER_START = /\b(?:waived?|avoid(?:ed)?|unless|none with|no (?:monthly )?(?:fee|charge) (?:with|if|when))\b/i;
const FEE_WORD = /\b(?:fee|charge)s?\b/i;
/** "...23 years of age.; Freedom Checking: ..." starts the next account's clause in a footnote. */
const NEXT_ACCOUNT_CLAUSE = /;\s+(?=[A-Z][\w+&'’ -]{2,60}:\s)/;

/**
 * The clause of one line that holds the fee. A footnote can list every account on one line
 * ("Student Checking: ... $5.00 monthly fee ...; Freedom Plus Checking: $25,000 ... to avoid"),
 * and only the fee's own clause speaks for it.
 */
function accountClause(line: string, excerpt: string): string {
  const clauses = line.split(NEXT_ACCOUNT_CLAUSE);
  if (clauses.length === 1) return line;
  const probe = squash(excerpt).slice(0, 30);
  return clauses.find((clause) => squash(clause).includes(probe)) ?? clauses[0];
}
const OWN_FEE_STATED = /\$\s?\d[\d,.]*\s+(?:per\s+month\s+|monthly\s+)?(?:maintenance\s+|service\s+)?(?:fee|charge)\b/i;

function figureOf(match: RegExpMatchArray | null): number | null {
  const value = match ? Number(match[1].replace(/,/g, "")) : NaN;
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** The balance that avoids the fee, stated in one line: the fee's own condition or an "avoid" sentence. */
export function minBalanceFromExcerpt(line: string): number | null {
  if (INTEREST_TIER.test(line)) return null;
  const clause = line.match(BALANCE_BELOW_CLAUSE)?.[0];
  if (clause) {
    const figure = [...clause.matchAll(AMOUNT_PATTERN)].at(-1)?.[1];
    const value = figure ? Number(figure.replace(/,/g, "")) : NaN;
    if (Number.isFinite(value) && value > 0) return value;
  }
  for (const pattern of BALANCE_TO_AVOID) {
    const value = figureOf(line.match(pattern));
    if (value !== null) return value;
  }
  return null;
}

/** The words that say how the fee is waived ("waived if a Direct Deposit ..."), from one line's own cell. */
export function waiverFromExcerpt(line: string): string | null {
  const start = line.search(WAIVER_START);
  if (start < 0) return null;
  const text = line.slice(start).split("|")[0].split(/(?<=[a-z0-9)])\.\s/i)[0].replace(/[\s.;,)]+$/, "").trim();
  const readable = readableWaiver(text);
  return readable ? readable.slice(0, MAX_WAIVER_CHARS) : null;
}

function openingDepositIn(line: string): number | null {
  for (const pattern of OPENING_DEPOSIT) {
    const value = figureOf(line.match(pattern));
    if (value !== null) return value;
  }
  return null;
}

/** The lines a fee's lineup is read from: its own clause, and its account's lines that talk about the fee. */
function lineupSources(excerpt: string, text: string) {
  const block = accountBlock(text, excerpt);
  const own = [accountClause(excerpt, excerpt), ...(block ? [accountClause(block.feeLine, excerpt)] : [])];
  // A nearby line that states its own monthly fee ("$10.00 monthly maintenance fee (Maintain a
  // daily balance of $500...)") is another account's row, so its balance and waiver are not ours.
  const aboutTheFee = (block?.nearby ?? []).filter((line) => FEE_WORD.test(line) && !OWN_FEE_STATED.test(line));
  return { block, own, aboutTheFee };
}

/**
 * v49: a monthly fee with no account name takes it from its own name or the heading above it.
 * v51: the balance that avoids the fee, the waiver and the opening deposit are read the same
 * way: the fee's own line first, then the account's lines around it (never past its heading or
 * into the next account's). A balance or waiver read from a nearby line needs the line to talk
 * about the fee ("avoid the monthly fee", "service charge waived"). Every value is grounded
 * against the text before it is written (`groundLineup`).
 */
/**
 * v73 (#1100): the account a monthly maintenance or minimum balance read belongs to, from the first
 * source that states one: the account lineup's product (the read's own row label, or a model read),
 * the account table's column header (#1438), the nearest account heading above the fee, then the
 * fee's own name. Null when none states one: an account is never assumed to be checking.
 */
export function accountProductFor(
  candidate: { feeName: string; excerpt: string; amount?: number | null; lineup?: AccountLineup | null },
  text: string,
  heading: string | null,
  institutionName?: string | null,
): string | null {
  // A disclosure title ("Truth in Savings"), a perk ("Health Savings Card") or a bank's own name
  // ("Bangor Savings Bank") is never the account (`account-name-exclusions.ts`, shared with #1566).
  const usable = (name: string | null | undefined) => (name && !namesNoAccount(name, institutionName) ? name : null);
  const fee = withoutNonAccountWords(candidate.feeName, institutionName);
  const own =
    usable(candidate.lineup?.productName) ??
    usable(candidate.amount == null ? null : accountTableProduct(text, candidate.excerpt, candidate.amount)) ??
    usable(candidate.amount == null ? null : tableColumnProduct(text, candidate.excerpt, candidate.amount));
  const named = usable(productNameFromFeeName(fee));
  // A fee whose own name says checking is a checking account's, even when its name gives no product
  // ("Enjoy! Rewards Checking monthly service fee" under a "SAVINGS" heading, #1598 review).
  if (CHECKING_WORDS.test(fee)) {
    if (own && (accountKind(own) ?? "checking") === "checking") return own;
    const head = usable(heading);
    return named ?? (head && accountKind(head) === "checking" ? head : null);
  }
  if (own) return own;
  // A fee for every account, or one price printed across several columns, belongs to no one account.
  if (ALL_ACCOUNTS.test(fee) || samePriceAcrossColumns(candidate.excerpt)) return null;
  const head = usable(heading);
  // A fee whose own name names another kind of account than the heading above it is that account's
  // ("Star Checking Monthly Fee" listed under a "Savings / Money Market" heading).
  if (head && named && accountKind(named) && accountKind(head) && accountKind(named) !== accountKind(head)) return named;
  return head ?? named;
}

/** "CONSUMER BANKING PACKAGES": a relationship package is a checking account's (inst 1310, prod). */
const PACKAGE_HEADING = /\b(?:banking|relationship|account)\s+packages?\b/i;
/** Checking, glued to a name too ("eChecking", "MyChecking"). */
const CHECKING_WORDS = /checking\b|\bshare\s*drafts?\b/i;
/** "Monthly Service Fee - all accounts", "per account, every account". */
const ALL_ACCOUNTS = /\b(?:all|every|each|any)\s+(?:of\s+(?:our|your|the)\s+)?(?:deposit\s+|share\s+)?accounts?\b/i;

/** A row that prints one price in several columns ("Monthly maintenance fee $0 $0 $0", "Fee | $5 | $5"). */
function samePriceAcrossColumns(excerpt: string): boolean {
  const prices = [...excerpt.matchAll(/\$\s?(\d[\d,]*(?:\.\d{2})?)/g)].map((match) => Number(match[1].replace(/,/g, "")));
  if (prices.length < 2 || new Set(prices).size !== 1) return false;
  return excerpt.includes("|") || /\$\s?[\d,.]+\s+\$\s?[\d,.]+/.test(excerpt);
}

/** The kind of account a name says, for telling a heading's account from the fee's own; null when it says none. */
function accountKind(name: string): string | null {
  if (/\b(?:business|commercial|non-?profit|corporate)\b/i.test(name)) return "business";
  if (/\bmoney\s*market\b|\bmmda\b/i.test(name)) return "money_market";
  if (/\b(?:ira|hsa|health savings|certificates?|cds?)\b/i.test(name)) return "ira_hsa_cd";
  if (CHECKING_WORDS.test(name)) return "checking";
  if (/\b(?:christmas|holiday|vacation)\b/i.test(name)) return "club";
  // A kids' club is a kids' savings account ("Money Tree Kids Club", 643669); checking is checked above.
  if (/\b(?:savings?|savers?|share|passbook)\b|\bkids?'?s?\s+club\b/i.test(name)) return "savings";
  return null;
}

export function withLineupFromText<T extends { canonicalHint: string; feeName: string; excerpt: string; amount?: number | null; lineup?: AccountLineup | null }>(
  candidate: T,
  text: string,
  /** v73's account order; false reads the name as v55 did (`lineupCorrections`, LINEUP_CORRECT_STRATEGY v2). */
  options: { accountProduct?: boolean; institutionName?: string | null } = {},
): T {
  if (!ACCOUNT_PRODUCT_CATEGORIES.has(candidate.canonicalHint)) return candidate;
  const read = candidate.lineup ?? { productName: null, minBalanceToAvoid: null, minOpeningDeposit: null, waiverText: null };
  // A model-read waiver that is a rate tier carries the tier's balance with it; neither is the fee's.
  const current: AccountLineup =
    read.waiverText && INTEREST_TIER.test(read.waiverText) ? { ...read, minBalanceToAvoid: null, waiverText: null } : read;
  const { block, own, aboutTheFee } = lineupSources(candidate.excerpt, text);
  const first = <V>(lines: string[], read: (line: string) => V | null): V | null => {
    for (const line of lines) {
      const value = read(line);
      if (value !== null) return value;
    }
    return null;
  };
  const productName = options.accountProduct === false
    ? (current.productName ?? productNameFromFeeName(candidate.feeName) ?? block?.heading ?? null)
    : accountProductFor({ ...candidate, lineup: current }, text, block?.accountHeading ?? null, options.institutionName);
  if (candidate.canonicalHint !== LINEUP_CATEGORY) {
    // A minimum balance fee records its account only.
    if (!productName || productName === read.productName) return candidate;
    return { ...candidate, lineup: { productName, minBalanceToAvoid: null, minOpeningDeposit: null, waiverText: null } };
  }
  const filled: AccountLineup = {
    productName,
    minBalanceToAvoid: current.minBalanceToAvoid ?? first([...own, ...aboutTheFee], minBalanceFromExcerpt),
    minOpeningDeposit: current.minOpeningDeposit ?? first([...own, ...(block?.nearby ?? [])], openingDepositIn),
    waiverText: current.waiverText ?? first([...own, ...aboutTheFee], waiverFromExcerpt),
  };
  const changed = (Object.keys(filled) as (keyof AccountLineup)[]).some((key) => filled[key] !== read[key]);
  return changed ? { ...candidate, lineup: filled } : candidate;
}

export interface LineupCorrection {
  field: keyof AccountLineup;
  old: string | number;
  new: string | number | null;
}

function mentionsFigure(line: string, value: number): boolean {
  return amountsIn(line).some((found) => found.value === value) || figureText(value).some((form) => line.includes(form));
}

/**
 * v55: a stored lineup value that came from a neighbour, and what the v55 rules read instead
 * (null when they read nothing). Pure and deterministic: no model call.
 *
 * A balance, waiver or opening deposit is corrected only when the v55 read differs, the stored
 * value is stated on a line around the fee that v55 no longer reads for it (another account's
 * fee line, or another account's clause of a one-line footnote), and the fee's own clause does
 * not state it. A name is corrected only when v55 would never store it (a fee heading such as
 * "Early (Share) Savings Account Closing", or no account name at all) and v55 reads a name.
 * Anything else stays as stored: a value v55 cannot explain may be a model read it cannot redo.
 */
export function lineupCorrections(
  candidate: { feeName: string; excerpt: string },
  stored: AccountLineup,
  text: string,
): LineupCorrection[] {
  const { block, own, aboutTheFee } = lineupSources(candidate.excerpt, text);
  if (!block) return [];
  const fresh = withLineupFromText({ canonicalHint: LINEUP_CATEGORY, feeName: candidate.feeName, excerpt: candidate.excerpt, lineup: null }, text, { accountProduct: false }).lineup;
  const v55: AccountLineup = (fresh && groundLineup(fresh, text)) ?? { productName: null, minBalanceToAvoid: null, minOpeningDeposit: null, waiverText: null };
  // Lines around the fee that v55 does not read for it: other accounts' lines and footnote clauses.
  const ownLines = [candidate.excerpt, block.feeLine];
  const otherClauses = ownLines.flatMap((line) => line.split(NEXT_ACCOUNT_CLAUSE)).filter((clause) => !own.includes(clause));
  const neighbours = (used: string[]) => [...otherClauses, ...block.around.filter((line) => !used.includes(line))];
  const corrections: LineupCorrection[] = [];

  const figureLeaked = (value: number, used: string[]) =>
    !own.some((line) => mentionsFigure(line, value)) && neighbours(used).some((line) => mentionsFigure(line, value));
  const balance = stored.minBalanceToAvoid == null ? null : Number(stored.minBalanceToAvoid);
  if (balance !== null && v55.minBalanceToAvoid !== balance && figureLeaked(balance, aboutTheFee)) {
    corrections.push({ field: "minBalanceToAvoid", old: balance, new: v55.minBalanceToAvoid });
  }
  const opening = stored.minOpeningDeposit == null ? null : Number(stored.minOpeningDeposit);
  if (opening !== null && v55.minOpeningDeposit !== opening && figureLeaked(opening, block.nearby)) {
    corrections.push({ field: "minOpeningDeposit", old: opening, new: v55.minOpeningDeposit });
  }
  if (stored.waiverText && v55.waiverText !== stored.waiverText) {
    const waiver = comparable(stored.waiverText);
    const leaked =
      !own.some((line) => comparable(line).includes(waiver)) && neighbours(aboutTheFee).some((line) => comparable(line).includes(waiver));
    if (leaked) corrections.push({ field: "waiverText", old: stored.waiverText, new: v55.waiverText });
  }
  if (stored.productName && v55.productName && v55.productName !== stored.productName) {
    const name = squash(stored.productName);
    // A stored name with a link's lead-in ("Learn more about Advantage Checking") is corrected too.
    if (FEE_HEADING_END.test(name) || readableProductName(name) === null || LEAD_IN.test(name)) {
      corrections.push({ field: "productName", old: stored.productName, new: v55.productName });
    }
  } else if (stored.productName && !v55.productName && block.heading === null && isPageSentence(squash(stored.productName))) {
    // A sentence or tagline stored as the name ("For all customers with savings needs…") is
    // cleared when the current rules read no account for the fee either: a blank, never a sentence.
    corrections.push({ field: "productName", old: stored.productName, new: null });
  }
  return corrections;
}
